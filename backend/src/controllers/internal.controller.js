import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { getReadiness } from '../services/readiness.service.js';
import { maskProxyUrl } from '../utils/secret_masking.js';
import campaignService from '../services/campaign.service.js';
import warmerService from '../services/warmer.service.js';

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

  res.json({ status: 'success', data });
};

export const getSession = async (req, res) => {
  const data = await whatsappService.getSessionStatus(req.params.id);
  if (!data) {
    return res.status(404).json({ status: 'error', message: 'Sesi tidak ditemukan.' });
  }
  return res.json({ status: 'success', data: maskSessionProxy(data) });
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
    data: data ? maskSessionProxy(data) : data
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

export const getDetailedGroupsInternal = async (req, res) => {
  try {
    const data = await whatsappService.getDetailedGroups(req.params.id);
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const getGroupInviteLinkInternal = async (req, res) => {
  const { sessionId, groupId } = req.body;
  if (!sessionId || !groupId) {
    return res.status(400).json({ status: 'error', message: 'Parameter sessionId dan groupId wajib diisi.' });
  }

  try {
    const inviteLink = await whatsappService.getGroupInviteLink(sessionId, groupId);
    res.json({ status: 'success', data: { inviteLink } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const getGroupsMetadataInternal = async (req, res) => {
  const { sessionId, groupIds } = req.body;
  if (!sessionId || !Array.isArray(groupIds)) {
    return res.status(400).json({ status: 'error', message: 'Parameter sessionId dan groupIds (array) wajib diisi.' });
  }

  try {
    const data = await whatsappService.getGroupsMetadata(sessionId, groupIds);
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const forceSyncContactsInternal = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ status: 'error', message: 'sessionId wajib diisi.' });
  }

  try {
    const data = await whatsappService.forceSyncContacts(sessionId);
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const getGroupsInternal = async (req, res) => {
  try {
    const data = await whatsappService.getGroups(req.params.id);
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const sendSingleMessageInternal = async (req, res) => {
  const { sessionId, target, payload } = req.body;
  if (!sessionId || !target) {
    return res.status(400).json({ status: 'error', message: 'Parameter sessionId dan target wajib diisi.' });
  }

  try {
    await whatsappService.sendSingleMessage(sessionId, target, payload || {});
    res.json({ status: 'success', message: 'Pesan tunggal berhasil dikirim oleh session manager.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const verifyGroupContactsInternal = async (req, res) => {
  const { groupId, sessionId } = req.body;
  if (!groupId || !sessionId) {
    return res.status(400).json({ status: 'error', message: 'Parameter groupId dan sessionId wajib diisi.' });
  }

  const sock = whatsappService.sockets[sessionId];
  if (!sock) {
    return res.status(404).json({ status: 'error', message: `WhatsApp session "${sessionId}" is disconnected or not found.` });
  }

  try {
    const contacts = await dbAll('SELECT * FROM contacts WHERE group_id = ? AND status = "UNVERIFIED"', [groupId]);
    if (contacts.length === 0) {
      return res.json({ status: 'success', message: 'No unverified contacts found in this group' });
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
        console.error(`Verification failed for number ${contact.phone_number}:`, err.message);
      }
    }

    res.json({
      status: 'success',
      message: `Verification complete. Verified: ${verifiedCount}, Invalid: ${invalidCount}`
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const processCampaignInternal = async (req, res) => {
  try {
    await campaignService.processCampaign(parseInt(req.params.id, 10));
    res.json({ status: 'success', message: 'Campaign processing delegated to worker.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const startWarmerCampaignInternal = async (req, res) => {
  try {
    await warmerService.startCampaign(parseInt(req.params.id, 10));
    res.json({ status: 'success', message: 'Warmer campaign start delegated to worker.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const stopWarmerCampaignInternal = async (req, res) => {
  try {
    await warmerService.stopCampaign(parseInt(req.params.id, 10));
    res.json({ status: 'success', message: 'Warmer campaign stop delegated to worker.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const clearWarmerCampaignInternal = async (req, res) => {
  try {
    warmerService.clearTimer(parseInt(req.params.id, 10));
    res.json({ status: 'success', message: 'Warmer campaign timer cleared on worker.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
