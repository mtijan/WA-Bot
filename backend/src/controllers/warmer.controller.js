import { dbRun, dbAll, dbGet } from '../database.js';
import warmerService from '../services/warmer.service.js';
import { config } from '../config.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

const shouldRunInlineWorkers = () => {
  return config.runtime.role === 'all';
};

// ==========================================
// TEMPLATES CONTROLLER
// ==========================================

export const getTemplates = async (req, res) => {
  try {
    const sql = req.auth.role === 'admin'
      ? "SELECT * FROM warmer_templates ORDER BY created_at DESC"
      : "SELECT * FROM warmer_templates WHERE user_id = ? ORDER BY created_at DESC";
    const templates = await dbAll(sql, req.auth.role === 'admin' ? [] : [req.auth.userId]);
    return sendSuccess(res, templates);
  } catch (error) {
    logError('getTemplatesWarmer', error);
    return sendError(res, 500, 'GET_WARMER_TEMPLATES_ERROR', 'Gagal memuat template warmer.');
  }
};

export const createTemplate = async (req, res) => {
  const { name, description, messages } = req.body;

  try {
    const result = await dbRun(
      "INSERT INTO warmer_templates (name, description, messages, user_id) VALUES (?, ?, ?, ?)",
      [name, description || null, messages, req.auth.userId]
    );
    return sendSuccess(res, { id: result.id, name, description, messages }, 201, { message: 'Template berhasil disimpan.' });
  } catch (error) {
    logError('createTemplateWarmer', error, { body: req.body });
    return sendError(res, 500, 'CREATE_WARMER_TEMPLATE_ERROR', 'Gagal menyimpan template warmer.');
  }
};

export const deleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_templates WHERE id = ?", [id]);
    if (!existing) {
      return sendError(res, 404, 'WARMER_TEMPLATE_NOT_FOUND', 'Template tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke template warmer ini.');
    }

    await dbRun("DELETE FROM warmer_templates WHERE id = ?", [id]);
    return sendSuccess(res, null, 200, { message: 'Template berhasil dihapus.' });
  } catch (error) {
    logError('deleteTemplateWarmer', error, { params: req.params });
    return sendError(res, 500, 'DELETE_WARMER_TEMPLATE_ERROR', 'Gagal menghapus template warmer.');
  }
};

// ==========================================
// CAMPAIGNS CONTROLLER
// ==========================================

export const getCampaigns = async (req, res) => {
  try {
    const sql = req.auth.role === 'admin'
      ? "SELECT * FROM warmer_campaigns ORDER BY created_at DESC"
      : "SELECT * FROM warmer_campaigns WHERE user_id = ? ORDER BY created_at DESC";
    const campaigns = await dbAll(sql, req.auth.role === 'admin' ? [] : [req.auth.userId]);
    return sendSuccess(res, campaigns);
  } catch (error) {
    logError('getCampaignsWarmer', error);
    return sendError(res, 500, 'GET_WARMER_CAMPAIGNS_ERROR', 'Gagal memuat kampanye warmer.');
  }
};

export const createCampaign = async (req, res) => {
  const { name, description, device_ids, template_id, messages, min_delay, max_delay, duration } = req.body;

  const deviceCount = device_ids.split(',').filter(Boolean).length;
  if (deviceCount < 2) {
    return sendError(res, 400, 'MINIMUM_DEVICES_REQUIRED', 'Minimal harus memilih 2 perangkat untuk pemanasan.');
  }

  try {
    if (req.auth.role !== 'admin') {
      if (template_id) {
        const temp = await dbGet("SELECT user_id FROM warmer_templates WHERE id = ?", [template_id]);
        if (!temp || temp.user_id !== req.auth.userId) {
          return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Template warmer tidak valid.');
        }
      }
      const devices = device_ids.split(',').filter(Boolean);
      for (const dev of devices) {
        const sess = await dbGet("SELECT user_id FROM sessions WHERE session_id = ?", [dev]);
        if (!sess || sess.user_id !== req.auth.userId) {
          return sendError(res, 403, 'FORBIDDEN_ACCESS', `Anda tidak memiliki akses ke perangkat ${dev}.`);
        }
      }
    }

    const result = await dbRun(
      `INSERT INTO warmer_campaigns 
      (name, description, device_ids, template_id, messages, min_delay, max_delay, duration, status, started_at, user_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        device_ids,
        template_id || null,
        messages,
        Number.parseInt(min_delay, 10),
        Number.parseInt(max_delay, 10),
        Number.parseInt(duration, 10),
        'RUNNING',
        new Date().toISOString(),
        req.auth.userId
      ]
    );

    const campaignId = result.id;

    // Catat log inisialisasi awal
    await dbRun(
      "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status) VALUES (?, ?, ?, ?, ?)",
      [campaignId, 'SYSTEM', 'SYSTEM', 'Kampanye warmer berhasil dibuat dan dimulai.', 'SUCCESS']
    );

    if (shouldRunInlineWorkers()) {
      // Jalankan mesin warmer di background pada mode monolith lokal.
      warmerService.startCampaign(campaignId);
    } else if (isSessionManagerClientEnabled()) {
      sessionManagerClient.startWarmerCampaign(campaignId).catch((err) => {
        logError('delegateWarmerCampaign', err, { campaignId });
      });
    }

    return sendSuccess(res, { id: campaignId, name, status: 'RUNNING' }, 201, { message: 'Kampanye warmer berhasil dimulai.' });
  } catch (error) {
    logError('createCampaignWarmer', error, { body: req.body });
    return sendError(res, 500, 'CREATE_WARMER_CAMPAIGN_ERROR', 'Gagal memulai kampanye warmer.');
  }
};

export const stopCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!existing) {
      return sendError(res, 404, 'WARMER_CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kampanye warmer ini.');
    }

    if (isSessionManagerClientEnabled()) {
      await sessionManagerClient.stopWarmerCampaign(id);
    } else {
      await warmerService.stopCampaign(id);
    }
    return sendSuccess(res, null, 200, { message: 'Kampanye warmer berhasil dihentikan.' });
  } catch (error) {
    logError('stopCampaignWarmer', error, { params: req.params });
    return sendError(res, 500, 'STOP_WARMER_CAMPAIGN_ERROR', 'Gagal menghentikan kampanye warmer.');
  }
};

export const getCampaignLogs = async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!campaign) {
      return sendError(res, 404, 'WARMER_CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && campaign.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kampanye warmer ini.');
    }

    const logs = await dbAll(
      "SELECT * FROM warmer_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT 100",
      [id]
    );

    return sendSuccess(res, {
      campaign_id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent_count: campaign.sent_count,
      duration: campaign.duration,
      started_at: campaign.started_at,
      logs: logs
    });
  } catch (error) {
    logError('getCampaignLogsWarmer', error, { params: req.params });
    return sendError(res, 500, 'GET_WARMER_LOGS_ERROR', 'Gagal memuat log kampanye warmer.');
  }
};

export const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!existing) {
      return sendError(res, 404, 'WARMER_CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kampanye warmer ini.');
    }

    // Pastikan mematikan loop aktif jika sedang berjalan
    if (isSessionManagerClientEnabled()) {
      await sessionManagerClient.clearWarmerCampaign(id);
    } else {
      warmerService.clearTimer(id);
    }

    // Hapus kampanye (log juga terhapus otomatis karena ON DELETE CASCADE)
    await dbRun("DELETE FROM warmer_campaigns WHERE id = ?", [id]);
    return sendSuccess(res, null, 200, { message: 'Kampanye warmer berhasil dihapus.' });
  } catch (error) {
    logError('deleteCampaignWarmer', error, { params: req.params });
    return sendError(res, 500, 'DELETE_WARMER_CAMPAIGN_ERROR', 'Gagal menghapus kampanye warmer.');
  }
};
