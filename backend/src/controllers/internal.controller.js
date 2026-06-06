import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { getReadiness } from '../services/readiness.service.js';
import { maskProxyUrl } from '../utils/secret_masking.js';
import campaignService from '../services/campaign.service.js';
import warmerService from '../services/warmer.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError, logger } from '../logger.js';

const maskSessionProxy = (session) => ({
  ...session,
  proxy_url: maskProxyUrl(session.proxy_url),
  resolved_proxy_url: maskProxyUrl(session.resolved_proxy_url)
});

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
  return sendSuccess(res, {
    role: req.app.locals.runtimeRole,
    timestamp: new Date().toISOString()
  }, 200, { status: 'alive' });
};

export const ready = async (req, res) => {
  try {
    const result = await getReadiness(req.app.locals.runtimeRole);
    return res.status(result.status === 'ready' ? 200 : 503).json(result);
  } catch (error) {
    logError('internalReadiness', error);
    return res.status(503).json({ status: 'not-ready', error: error.message });
  }
};

export const listSessions = async (req, res) => {
  try {
    const dbSessions = await dbAll(
      `SELECT s.*, p.name as proxy_name, p.proxy_url as resolved_proxy_url
       FROM sessions s
       LEFT JOIN proxies p ON s.proxy_id = p.id`
    );

    const data = [];
    for (const session of dbSessions) {
      const liveData = await whatsappService.getSessionStatus(session.session_id);
      data.push(liveData ? maskSessionProxy(liveData) : {
        session_id: session.session_id,
        phone_number: session.phone_number,
        status: session.status,
        proxy_id: session.proxy_id,
        proxy_name: session.proxy_name,
        proxy_url: maskProxyUrl(session.resolved_proxy_url || session.proxy_url),
        qr_code: null
      });
    }

    return sendSuccess(res, data);
  } catch (err) {
    logError('listSessionsInternal', err);
    return sendError(res, 500, 'GET_SESSIONS_ERROR', 'Gagal memuat sesi.');
  }
};

export const getSession = async (req, res) => {
  try {
    const data = await whatsappService.getSessionStatus(req.params.id);
    if (!data) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    return sendSuccess(res, maskSessionProxy(data));
  } catch (err) {
    logError('getSessionInternal', err, { params: req.params });
    return sendError(res, 500, 'GET_SESSION_ERROR', 'Gagal memuat sesi.');
  }
};

export const initSession = async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [id]);
    if (existing) {
      await dbRun('UPDATE sessions SET proxy_id = NULL WHERE session_id = ?', [id]);
    } else {
      await dbRun('INSERT INTO sessions (session_id, status, proxy_id) VALUES (?, ?, NULL)', [id, 'DISCONNECTED']);
    }

    await whatsappService.initSession(id);
    const data = await waitForSessionState(id);

    return sendSuccess(res, data ? maskSessionProxy(data) : data, 201, { message: 'Sesi diinisialisasi oleh session manager.' });
  } catch (err) {
    logError('initSessionInternal', err, { params: req.params });
    return sendError(res, 500, 'INIT_SESSION_ERROR', 'Gagal menginisialisasi sesi.');
  }
};

export const deleteSession = async (req, res) => {
  const { id } = req.params;
  try {
    await whatsappService.deleteSession(id);
    return sendSuccess(res, null, 200, { message: `Sesi ${id} berhasil dihapus oleh session manager.` });
  } catch (err) {
    logError('deleteSessionInternal', err, { params: req.params });
    return sendError(res, 500, 'DELETE_SESSION_ERROR', 'Gagal menghapus sesi.');
  }
};

export const updateSessionProxy = async (req, res) => {
  const { id } = req.params;
  const { proxy_id } = req.body;

  try {
    await dbRun('UPDATE sessions SET proxy_id = ? WHERE session_id = ?', [proxy_id || null, id]);

    const activeSock = whatsappService.sockets[id];
    if (activeSock) {
      try {
        activeSock.end(new Error('Proxy changed'));
      } catch (err) {
        logError('disconnectSocketOnProxyUpdateInternal', err, { sessionId: id });
      }
    }

    return sendSuccess(res, null, 200, { message: 'Proxy sesi berhasil diperbarui oleh session manager.' });
  } catch (err) {
    logError('updateSessionProxyInternal', err, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_PROXY_ERROR', 'Gagal memperbarui proxy sesi.');
  }
};

export const getDetailedGroupsInternal = async (req, res) => {
  try {
    const data = await whatsappService.getDetailedGroups(req.params.id);
    return sendSuccess(res, data);
  } catch (err) {
    logError('getDetailedGroupsInternal', err, { params: req.params });
    return sendError(res, 500, 'GET_DETAILED_GROUPS_ERROR', err.message || 'Gagal memuat detail grup.');
  }
};

export const getGroupInviteLinkInternal = async (req, res) => {
  const { sessionId, groupId } = req.body;

  try {
    const inviteLink = await whatsappService.getGroupInviteLink(sessionId, groupId);
    return sendSuccess(res, { inviteLink });
  } catch (err) {
    logError('getGroupInviteLinkInternal', err, { body: req.body });
    return sendError(res, 500, 'GET_INVITE_LINK_ERROR', err.message || 'Gagal memuat tautan undangan grup.');
  }
};

export const getGroupsMetadataInternal = async (req, res) => {
  const { sessionId, groupIds } = req.body;

  try {
    const data = await whatsappService.getGroupsMetadata(sessionId, groupIds);
    return sendSuccess(res, data);
  } catch (err) {
    logError('getGroupsMetadataInternal', err, { body: req.body });
    return sendError(res, 500, 'GET_GROUPS_METADATA_ERROR', err.message || 'Gagal memuat metadata grup.');
  }
};

export const forceSyncContactsInternal = async (req, res) => {
  const { sessionId } = req.body;

  try {
    const data = await whatsappService.forceSyncContacts(sessionId);
    return sendSuccess(res, data);
  } catch (err) {
    logError('forceSyncContactsInternal', err, { body: req.body });
    return sendError(res, 500, 'FORCE_SYNC_CONTACTS_ERROR', err.message || 'Gagal sinkronisasi kontak.');
  }
};

export const getGroupsInternal = async (req, res) => {
  try {
    const data = await whatsappService.getGroups(req.params.id);
    return sendSuccess(res, data);
  } catch (err) {
    logError('getGroupsInternal', err, { params: req.params });
    return sendError(res, 500, 'GET_GROUPS_ERROR', err.message || 'Gagal memuat daftar grup.');
  }
};

export const sendSingleMessageInternal = async (req, res) => {
  const { sessionId, target, ...payload } = req.body;

  try {
    await whatsappService.sendSingleMessage(sessionId, target, payload);
    return sendSuccess(res, null, 200, { message: 'Pesan tunggal berhasil dikirim oleh session manager.' });
  } catch (err) {
    logError('sendSingleMessageInternal', err, { body: req.body });
    return sendError(res, 500, 'SEND_MESSAGE_ERROR', err.message || 'Gagal mengirim pesan tunggal.');
  }
};

export const verifyGroupContactsInternal = async (req, res) => {
  const { groupId, sessionId } = req.body;

  const sock = whatsappService.sockets[sessionId];
  if (!sock) {
    return sendError(res, 404, 'SESSION_NOT_ACTIVE', `Sesi WhatsApp "${sessionId}" tidak aktif atau tidak ditemukan.`);
  }

  try {
    const contacts = await dbAll('SELECT * FROM contacts WHERE group_id = ? AND status = "UNVERIFIED"', [groupId]);
    if (contacts.length === 0) {
      return sendSuccess(res, null, 200, { message: 'Tidak ada kontak belum terverifikasi dalam grup ini.' });
    }

    let verifiedCount = 0;
    let invalidCount = 0;

    for (const contact of contacts) {
      let phone = contact.phone_number.toString().trim();
      if (phone.startsWith('0')) {
        phone = '62' + phone.slice(1);
      }
      if (!phone.endsWith('@s.whatsapp.net')) {
        phone = `${phone}@s.whatsapp.net`;
      }

      try {
        const [result] = await sock.onWhatsApp(phone);
        let newStatus = 'INVALID';
        if (result && result.exists) {
          newStatus = 'VERIFIED';
          verifiedCount++;
        } else {
          invalidCount++;
        }

        await dbRun('UPDATE contacts SET status = ? WHERE id = ?', [newStatus, contact.id]);
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        logError('verifySingleContactInternal', err, { phoneNumber: contact.phone_number });
      }
    }

    return sendSuccess(res, null, 200, { message: `Verifikasi selesai. Terverifikasi: ${verifiedCount}, Tidak Valid: ${invalidCount}` });
  } catch (error) {
    logError('verifyGroupContactsInternal', error, { body: req.body });
    return sendError(res, 500, 'VERIFY_GROUP_CONTACTS_ERROR', error.message || 'Gagal memproses verifikasi kontak.');
  }
};

export const processCampaignInternal = async (req, res) => {
  const { id } = req.params;
  try {
    await campaignService.processCampaign(Number.parseInt(id, 10));
    return sendSuccess(res, null, 200, { message: 'Campaign processing delegated to worker.' });
  } catch (error) {
    logError('processCampaignInternal', error, { params: req.params });
    return sendError(res, 500, 'PROCESS_CAMPAIGN_ERROR', error.message || 'Gagal memproses kampanye.');
  }
};

export const startWarmerCampaignInternal = async (req, res) => {
  const { id } = req.params;
  try {
    await warmerService.startCampaign(Number.parseInt(id, 10));
    return sendSuccess(res, null, 200, { message: 'Warmer campaign start delegated to worker.' });
  } catch (error) {
    logError('startWarmerCampaignInternal', error, { params: req.params });
    return sendError(res, 500, 'START_WARMER_CAMPAIGN_ERROR', error.message || 'Gagal memulai kampanye warmer.');
  }
};

export const stopWarmerCampaignInternal = async (req, res) => {
  const { id } = req.params;
  try {
    await warmerService.stopCampaign(Number.parseInt(id, 10));
    return sendSuccess(res, null, 200, { message: 'Warmer campaign stop delegated to worker.' });
  } catch (error) {
    logError('stopWarmerCampaignInternal', error, { params: req.params });
    return sendError(res, 500, 'STOP_WARMER_CAMPAIGN_ERROR', error.message || 'Gagal menghentikan kampanye warmer.');
  }
};

export const clearWarmerCampaignInternal = async (req, res) => {
  const { id } = req.params;
  try {
    warmerService.clearTimer(Number.parseInt(id, 10));
    return sendSuccess(res, null, 200, { message: 'Warmer campaign timer cleared on worker.' });
  } catch (error) {
    logError('clearWarmerCampaignInternal', error, { params: req.params });
    return sendError(res, 500, 'CLEAR_WARMER_CAMPAIGN_ERROR', error.message || 'Gagal menghapus timer kampanye warmer.');
  }
};
