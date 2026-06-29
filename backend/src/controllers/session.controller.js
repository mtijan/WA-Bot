import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { maskProxyUrl } from '../utils/secret_masking.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError, logger } from '../logger.js';
import { auditLog } from '../services/audit.service.js';

const maskSessionProxy = (session) => ({
  ...session,
  proxy_url: maskProxyUrl(session.proxy_url),
  resolved_proxy_url: maskProxyUrl(session.resolved_proxy_url)
});

async function getPlanSessionLimit(userId) {
  const data = await dbGet(`
    SELECT COALESCE(p.max_sessions, 1) as max_sessions
    FROM users u
    LEFT JOIN subscription_plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `, [userId]);
  return Number(data?.max_sessions || 1);
}

export async function reserveSessionSlot(sessionId, auth) {
  const existing = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (existing) {
    if (existing.user_id !== auth.userId) {
      return { ok: false, status: 403, code: 'FORBIDDEN_ACCESS', message: 'ID Sesi sudah digunakan oleh pengguna lain.' };
    }

    await dbRun('UPDATE sessions SET proxy_id = NULL WHERE session_id = ?', [sessionId]);
    return { ok: true, existing: true };
  }

  if (auth.userId === 1) {
    await dbRun(
      'INSERT INTO sessions (session_id, status, proxy_id, user_id) VALUES (?, ?, NULL, ?)',
      [sessionId, 'DISCONNECTED', auth.userId]
    );
    return { ok: true, existing: false };
  }

  try {
    const result = await dbRun(
      `INSERT INTO sessions (session_id, status, proxy_id, user_id)
       SELECT ?, 'DISCONNECTED', NULL, ?
       WHERE (
         SELECT COUNT(*) FROM sessions WHERE user_id = ?
       ) < (
         SELECT COALESCE(p.max_sessions, 1)
         FROM users u
         LEFT JOIN subscription_plans p ON u.plan_id = p.id
         WHERE u.id = ?
       )`,
      [sessionId, auth.userId, auth.userId, auth.userId]
    );

    if (result.changes > 0) {
      return { ok: true, existing: false };
    }
  } catch (error) {
    if (error?.code !== 'SQLITE_CONSTRAINT') {
      throw error;
    }

    const racedExisting = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
    if (racedExisting?.user_id === auth.userId) {
      await dbRun('UPDATE sessions SET proxy_id = NULL WHERE session_id = ?', [sessionId]);
      return { ok: true, existing: true };
    }
    if (racedExisting) {
      return { ok: false, status: 403, code: 'FORBIDDEN_ACCESS', message: 'ID Sesi sudah digunakan oleh pengguna lain.' };
    }
    throw error;
  }

  const maxSessions = await getPlanSessionLimit(auth.userId);
  return {
    ok: false,
    status: 403,
    code: 'QUOTA_EXCEEDED',
    message: `Kuota perangkat (session) telah tercapai (${maxSessions}). Silakan upgrade paket Anda.`
  };
}

export const getSessions = async (req, res) => {
  try {
    let sessionsToReturn = [];

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.listSessions();
      if (Array.isArray(payload?.data)) {
        sessionsToReturn = payload.data.map(maskSessionProxy);
        const userSessionRows = await dbAll('SELECT session_id FROM sessions WHERE user_id = ?', [req.auth.userId]);
        const userSessionIds = new Set(userSessionRows.map(r => r.session_id));
        sessionsToReturn = sessionsToReturn.filter(s => userSessionIds.has(s.session_id));
      }
      return sendSuccess(res, sessionsToReturn);
    }

    const query = `SELECT s.*, p.name as proxy_name, p.proxy_url as resolved_proxy_url 
         FROM sessions s 
         LEFT JOIN proxies p ON s.proxy_id = p.id
         WHERE s.user_id = ?`;
    const dbSessions = await dbAll(query, [req.auth.userId]);
    const result = [];
    
    for (const session of dbSessions) {
      const liveData = await whatsappService.getSessionStatus(session.session_id);
      result.push(liveData ? maskSessionProxy(liveData) : {
        session_id: session.session_id,
        phone_number: session.phone_number,
        status: session.status,
        proxy_id: session.proxy_id,
        proxy_name: session.proxy_name,
        proxy_url: maskProxyUrl(session.resolved_proxy_url || session.proxy_url),
        qr_code: null
      });
    }
    
    return sendSuccess(res, result);
  } catch (err) {
    logError('getSessions', err);
    return sendError(res, 500, 'GET_SESSIONS_ERROR', 'Gagal memuat sesi.');
  }
};

export const createSession = async (req, res) => {
  const { session_id } = req.body;

  try {
    const reservation = await reserveSessionSlot(session_id, req.auth);
    if (!reservation.ok) {
      return sendError(res, reservation.status, reservation.code, reservation.message);
    }

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.initSession(session_id);
      return res.status(201).json(payload);
    }

    // Inisialisasi sesi di background
    await whatsappService.initSession(session_id);

    // Polling kecil untuk mendapatkan status pertama (CONNECTED atau QR Code)
    let checkCount = 0;
    const checkState = async () => {
      const statusObj = await whatsappService.getSessionStatus(session_id);
      if (statusObj && (statusObj.status === 'CONNECTED' || statusObj.qr_code)) {
        return statusObj;
      }
      if (checkCount < 10) { // Menunggu maksimal 5 detik
        checkCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
        return checkState();
      }
      return statusObj;
    };

    const finalStatus = await checkState();
    auditLog(req, 'SESSION_CREATE', 'session', session_id, 'success', { user_id: req.auth.userId });
    return sendSuccess(res, finalStatus ? maskSessionProxy(finalStatus) : finalStatus, 201, { message: 'Sesi diinisialisasi.' });
  } catch (err) {
    logError('createSession', err, { body: req.body });
    return sendError(res, 500, 'CREATE_SESSION_ERROR', err.message || 'Gagal menginisialisasi sesi.');
  }
};

export const deleteSession = async (req, res) => {
  const { id } = req.params;
  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.deleteSession(id);
      return res.json(payload);
    }

    await whatsappService.deleteSession(id);
    auditLog(req, 'SESSION_DELETE', 'session', id, 'success');
    return sendSuccess(res, null, 200, { message: `Sesi ${id} berhasil dihapus.` });
  } catch (err) {
    logError('deleteSession', err, { params: req.params });
    return sendError(res, 500, 'DELETE_SESSION_ERROR', err.message || 'Gagal menghapus sesi.');
  }
};

export const updateSessionProxy = async (req, res) => {
  const { id } = req.params;
  const { proxy_id } = req.body;

  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.updateSessionProxy(id, proxy_id);
      return res.json(payload);
    }

    // 1. Update database
    await dbRun('UPDATE sessions SET proxy_id = ? WHERE session_id = ?', [proxy_id || null, id]);

    // 2. Cek apakah socket sesi ini sedang berjalan aktif
    const activeSock = whatsappService.sockets[id];
    if (activeSock) {
      logger.info({ scope: 'updateSessionProxy', sessionId: id }, `Proxy untuk sesi ${id} diperbarui menjadi proxy_id: ${proxy_id || 'null'}. Memutuskan koneksi soket aktif...`);
      // Panggil .end() untuk memutuskan soket secara bersih, Baileys akan otomatis reconnect
      try {
        activeSock.end(new Error('Proxy changed'));
      } catch (err) {
        logError('disconnectSocketOnProxyUpdate', err, { sessionId: id });
      }
    }

    return sendSuccess(res, null, 200, { message: 'Proxy sesi berhasil diperbarui.' });
  } catch (err) {
    logError('updateSessionProxy', err, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_SESSION_PROXY_ERROR', err.message || 'Gagal memperbarui proxy sesi.');
  }
};

export const repairSession = async (req, res) => {
  const { id } = req.params;
  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.repairSession(id, 'MANUAL');
      return res.json(payload);
    }

    await whatsappService.repairSession(id, 'MANUAL');
    auditLog(req, 'SESSION_REPAIR', 'session', id, 'success', { trigger: 'MANUAL' });
    return sendSuccess(res, null, 200, { message: `Sesi ${id} berhasil diperbaiki.` });
  } catch (err) {
    logError('repairSession', err, { params: req.params });
    auditLog(req, 'SESSION_REPAIR', 'session', id, 'failure', { trigger: 'MANUAL', error: err.message });
    try {
      await dbRun(
        `INSERT INTO session_repair_logs (session_id, status, error_message, downtime_seconds, trigger_type)
         VALUES (?, ?, ?, NULL, ?)`,
        [id, 'FAILED', err.message || String(err), 'MANUAL']
      );
    } catch (dbErr) {
      logError('repairSessionDbLog', dbErr);
    }
    return sendError(res, 500, 'REPAIR_SESSION_ERROR', err.message || 'Gagal memperbaiki sesi.');
  }
};

export const reconnectSession = async (req, res) => {
  const { id } = req.params;
  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.reconnectSession(id);
      return res.json(payload);
    }

    await whatsappService.reconnectSession(id);
    auditLog(req, 'SESSION_RECONNECT', 'session', id, 'success');
    return sendSuccess(res, null, 200, { message: `Sesi ${id} berhasil dihubungkan kembali.` });
  } catch (err) {
    logError('reconnectSession', err, { params: req.params });
    return sendError(res, 500, 'RECONNECT_SESSION_ERROR', err.message || 'Gagal menghubungkan kembali sesi.');
  }
};
