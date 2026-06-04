import whatsappService from '../services/whatsapp.service.js';
import { dbRun } from '../database.js';
import { isOptedOut } from '../services/opt_out.service.js';

export const getGroups = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const groups = await whatsappService.getGroups(sessionId);
    res.json({
      status: 'success',
      data: groups
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

export const sendMessage = async (req, res) => {
  const { sessionId, target, messageType, text, attachmentUrl, attachmentType, attachmentName, templateId, allowOptedOut } = req.body;

  if (!sessionId || !target) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter sessionId dan target wajib diisi.'
    });
  }

  try {
    if (!allowOptedOut && await isOptedOut(target)) {
      return res.status(409).json({
        status: 'error',
        error_code: 'RECIPIENT_OPTED_OUT',
        message: 'Penerima berada dalam suppression list. Gunakan override eksplisit hanya untuk pesan yang sah dan diperlukan.'
      });
    }

    await whatsappService.sendSingleMessage(sessionId, target, {
      messageType,
      text,
      attachmentUrl,
      attachmentType,
      attachmentName,
      templateId
    });

    // Catat log pengiriman pesan sebagai single message (campaign_id = NULL)
    await dbRun(
      "INSERT INTO delivery_logs (campaign_id, target_number, status) VALUES (NULL, ?, 'SENT')",
      [target]
    );

    res.json({
      status: 'success',
      message: 'Pesan tunggal berhasil dikirim.'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};
