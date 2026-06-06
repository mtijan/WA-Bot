import campaignService from '../services/campaign.service.js';
import { dbAll, dbRun } from '../database.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

export const getCampaigns = async (req, res) => {
  try {
    const sql = `
      SELECT 
        c.id, c.name, c.session_id, c.message, c.status, c.created_at,
        COUNT(dl.id) as total_targets,
        SUM(CASE WHEN dl.status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN dl.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN dl.status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM campaigns c
      LEFT JOIN delivery_logs dl ON c.id = dl.campaign_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `;
    const campaigns = await dbAll(sql);
    res.json({ status: 'success', data: campaigns });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createCampaign = async (req, res) => {
  const { session_id, name, message, targets, delay_ms_min, delay_ms_max } = req.body;

  if (!session_id || !message || !targets || !Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter session_id, message, dan targets (Array tidak boleh kosong) wajib diisi.'
    });
  }

  try {
    const campaignId = await campaignService.createCampaign(
      session_id,
      message,
      targets,
      delay_ms_min || 3000,
      delay_ms_max || 8000,
      name
    );

    if (isSessionManagerClientEnabled()) {
      sessionManagerClient.processCampaign(campaignId).catch((err) => {
        console.error(`[Campaign Controller] Gagal mendelegasikan kampanye #${campaignId} ke worker:`, err.message);
      });
    }

    res.status(202).json({
      status: 'success',
      message: 'Kampanye berhasil dimasukkan ke antrean.',
      data: {
        campaign_id: campaignId,
        total_targets: targets.length
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const getCampaignProgress = async (req, res) => {
  const { id } = req.params;
  try {
    const progress = await campaignService.getCampaignProgress(parseInt(id));
    if (!progress) {
      return res.status(404).json({ status: 'error', message: 'Kampanye tidak ditemukan.' });
    }
    res.json({ status: 'success', data: progress });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM delivery_logs WHERE campaign_id = ?', [id]);
    await dbRun('DELETE FROM campaigns WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Kampanye berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
