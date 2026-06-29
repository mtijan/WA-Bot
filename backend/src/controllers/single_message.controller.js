import whatsappService from '../services/whatsapp.service.js';
import { dbGet, dbRun } from '../database.js';
import { isOptedOut } from '../services/opt_out.service.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

export const getGroups = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess || sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    const response = isSessionManagerClientEnabled()
      ? await sessionManagerClient.getGroups(sessionId)
      : { data: await whatsappService.getGroups(sessionId) };
    const groups = response.data || [];
    return sendSuccess(res, groups);
  } catch (err) {
    logError('getGroups', err, { params: req.params });
    return sendError(res, 500, 'GET_GROUPS_ERROR', err.message || 'Gagal memuat grup WhatsApp.');
  }
};

export const sendMessage = async (req, res) => {
  const { sessionId, target, messageType, text, attachmentUrl, attachmentType, attachmentName, templateId, allowOptedOut } = req.body;

  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess || sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (!allowOptedOut && await isOptedOut(target, req.auth.userId)) {
      return sendError(res, 409, 'RECIPIENT_OPTED_OUT', 'Penerima berada dalam suppression list. Gunakan override eksplisit hanya untuk pesan yang sah dan diperlukan.');
    }

    const payload = {
      messageType,
      text,
      attachmentUrl,
      attachmentType,
      attachmentName,
      templateId
    };

    if (isSessionManagerClientEnabled()) {
      await sessionManagerClient.sendSingleMessage(sessionId, target, payload);
    } else {
      await whatsappService.sendSingleMessage(sessionId, target, payload);
    }

    // Catat log pengiriman pesan sebagai single message (campaign_id = NULL)
    await dbRun(
      "INSERT INTO delivery_logs (campaign_id, target_number, status, user_id) VALUES (NULL, ?, 'SENT', ?)",
      [target, req.auth.userId]
    );

    return sendSuccess(res, null, 200, { message: 'Pesan tunggal berhasil dikirim.' });
  } catch (err) {
    logError('sendMessage', err, { body: req.body });
    return sendError(res, 500, 'SEND_MESSAGE_ERROR', err.message || 'Gagal mengirim pesan tunggal.');
  }
};
