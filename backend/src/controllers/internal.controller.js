import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { getReadiness } from '../services/readiness.service.js';

const waitForSessionState = async (sessionId, maxAttempts = 10) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusObj = await whatsappService.getSessionStatus(sessionId);
    if (statusObj && (statusObj.status === 'CONNECTED' || statusObj.qr_code)) {
      return statusObj;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return whatsappService.getSessionStatus(sessionId);
};

export const live = async (req, res) => {
  res.json({
    status: 'alive',
    role: req.app.locals.runtimeRole,
    timestamp: new Date().toISOString()
  });
};

export const ready = async (req, res) => {
  const result = await getReadiness(req.app.locals.runtimeRole);
  res.status(result.status === 'ready' ? 200 : 503).json(result);
};

export const listSessions = async (req, res) => {
  const dbSessions = await dbAll(
    `SELECT s.*, p.name as proxy_name, p.proxy_url as resolved_proxy_url
     FROM sessions s
     LEFT JOIN proxies p ON s.proxy_id = p.id`
  );

  const data = [];
  for (const session of dbSessions) {
    const liveData = await whatsappService.getSessionStatus(session.session_id);
    data.push(liveData || {
      session_id: session.session_id,
      phone_number: session.phone_number,
      status: session.status,
      proxy_id: session.proxy_id,
      proxy_name: session.proxy_name,
      proxy_url: session.resolved_proxy_url || session.proxy_url,
      qr_code: null
    });
  }

  res.json({ status: 'success', data });
};

export const getSession = async (req, res) => {
  const data = await whatsappService.getSessionStatus(req.params.id);
  if (!data) {
    return res.status(404).json({ status: 'error', message: 'Sesi tidak ditemukan.' });
  }
  return res.json({ status: 'success', data });
};

export const initSession = async (req, res) => {
  const { id } = req.params;

  const existing = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [id]);
  if (existing) {
    await dbRun('UPDATE sessions SET proxy_id = NULL WHERE session_id = ?', [id]);
  } else {
    await dbRun('INSERT INTO sessions (session_id, status, proxy_id) VALUES (?, ?, NULL)', [id, 'DISCONNECTED']);
  }

  await whatsappService.initSession(id);
  const data = await waitForSessionState(id);

  return res.status(201).json({
    status: 'success',
    message: 'Sesi diinisialisasi oleh session manager.',
    data
  });
};

export const deleteSession = async (req, res) => {
  await whatsappService.deleteSession(req.params.id);
  res.json({ status: 'success', message: `Sesi ${req.params.id} berhasil dihapus oleh session manager.` });
};

export const updateSessionProxy = async (req, res) => {
  const { id } = req.params;
  const { proxy_id } = req.body;

  await dbRun('UPDATE sessions SET proxy_id = ? WHERE session_id = ?', [proxy_id || null, id]);

  const activeSock = whatsappService.sockets[id];
  if (activeSock) {
    try {
      activeSock.end(new Error('Proxy changed'));
    } catch (err) {
      console.warn(`[Internal Session Manager] Gagal memutuskan soket sesi ${id}:`, err.message);
    }
  }

  res.json({ status: 'success', message: 'Proxy sesi berhasil diperbarui oleh session manager.' });
};
