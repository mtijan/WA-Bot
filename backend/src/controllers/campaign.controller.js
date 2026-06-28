import campaignService from '../services/campaign.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { auditLog } from '../services/audit.service.js';

export const getCampaigns = async (req, res) => {
  try {
    const sql = `SELECT 
          c.id, c.name, c.session_id, c.message, c.status, c.created_at,
          c.attachment_url, c.attachment_type, c.attachment_name,
          COUNT(dl.id) as total_targets,
          SUM(CASE WHEN dl.status = 'SENT' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN dl.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN dl.status = 'PENDING' THEN 1 ELSE 0 END) as pending
        FROM campaigns c
        INNER JOIN sessions s ON c.session_id = s.session_id
        LEFT JOIN delivery_logs dl ON c.id = dl.campaign_id
        WHERE s.user_id = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC`;
    
    const campaigns = await dbAll(sql, [req.auth.userId]);
    return sendSuccess(res, campaigns);
  } catch (error) {
    logError('getCampaigns', error);
    return sendError(res, 500, 'GET_CAMPAIGNS_ERROR', 'Gagal memuat daftar kampanye.');
  }
};

export const createCampaign = async (req, res) => {
  const { session_id, name, message, targets, delay_ms_min, delay_ms_max, attachment_url, attachment_type, attachment_name } = req.body;

  try {
    const session = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [session_id]);
    if (!session || session.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    const campaignId = await campaignService.createCampaign(
      session_id,
      message,
      targets,
      delay_ms_min || 3000,
      delay_ms_max || 8000,
      name,
      attachment_url || null,
      attachment_type || null,
      attachment_name || null
    );

    if (isSessionManagerClientEnabled()) {
      sessionManagerClient.processCampaign(campaignId).catch((err) => {
        logError('delegateCampaign', err, { campaignId });
      });
    }

    auditLog(req, 'CAMPAIGN_CREATE', 'campaign', String(campaignId), 'success', {
      session_id,
      name,
      total_targets: targets.length,
    });
    return sendSuccess(res, {
      campaign_id: campaignId,
      total_targets: targets.length
    }, 202, { message: 'Kampanye berhasil dimasukkan ke antrean.' });
  } catch (err) {
    logError('createCampaign', err, { body: req.body });
    return sendError(res, 500, 'CREATE_CAMPAIGN_ERROR', err.message || 'Gagal membuat kampanye.');
  }
};

export const getCampaignProgress = async (req, res) => {
  const { id } = req.params;
  try {
    const camp = await dbGet(
      `SELECT s.user_id FROM campaigns c
       INNER JOIN sessions s ON c.session_id = s.session_id
       WHERE c.id = ?`,
      [id]
    );
    if (!camp) {
      return sendError(res, 404, 'CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }
    if (camp.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kampanye ini.');
    }

    const progress = await campaignService.getCampaignProgress(Number.parseInt(id, 10));
    if (!progress) {
      return sendError(res, 404, 'CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }
    return sendSuccess(res, progress);
  } catch (err) {
    logError('getCampaignProgress', err, { params: req.params });
    return sendError(res, 500, 'GET_CAMPAIGN_PROGRESS_ERROR', err.message || 'Gagal memuat progress kampanye.');
  }
};

export const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const camp = await dbGet(
      `SELECT s.user_id FROM campaigns c
       INNER JOIN sessions s ON c.session_id = s.session_id
       WHERE c.id = ?`,
      [id]
    );
    if (!camp) {
      return sendError(res, 404, 'CAMPAIGN_NOT_FOUND', 'Kampanye tidak ditemukan.');
    }
    if (camp.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kampanye ini.');
    }

    await dbRun('DELETE FROM delivery_logs WHERE campaign_id = ?', [id]);
    await dbRun('DELETE FROM campaigns WHERE id = ?', [id]);
    auditLog(req, 'CAMPAIGN_DELETE', 'campaign', String(id), 'success');
    return sendSuccess(res, null, 200, { message: 'Kampanye berhasil dihapus.' });
  } catch (err) {
    logError('deleteCampaign', err, { params: req.params });
    return sendError(res, 500, 'DELETE_CAMPAIGN_ERROR', err.message || 'Gagal menghapus kampanye.');
  }
};
