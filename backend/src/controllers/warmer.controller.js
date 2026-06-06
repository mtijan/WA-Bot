import { dbRun, dbAll, dbGet } from '../database.js';
import warmerService from '../services/warmer.service.js';
import { config } from '../config.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

const shouldRunInlineWorkers = () => {
  return config.runtime.role === 'all';
};

// ==========================================
// TEMPLATES CONTROLLER
// ==========================================

export const getTemplates = async (req, res) => {
  try {
    const templates = await dbAll("SELECT * FROM warmer_templates ORDER BY created_at DESC");
    res.json({ status: 'success', data: templates });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createTemplate = async (req, res) => {
  const { name, description, messages } = req.body;
  if (!name || !messages) {
    return res.status(400).json({ status: 'error', message: 'Nama template dan daftar pesan wajib diisi.' });
  }

  try {
    const result = await dbRun(
      "INSERT INTO warmer_templates (name, description, messages) VALUES (?, ?, ?)",
      [name, description || null, messages]
    );
    res.status(201).json({
      status: 'success',
      message: 'Template berhasil disimpan.',
      data: { id: result.id, name, description, messages }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_templates WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Template tidak ditemukan.' });
    }

    await dbRun("DELETE FROM warmer_templates WHERE id = ?", [id]);
    res.json({ status: 'success', message: 'Template berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// CAMPAIGNS CONTROLLER
// ==========================================

export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await dbAll("SELECT * FROM warmer_campaigns ORDER BY created_at DESC");
    res.json({ status: 'success', data: campaigns });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createCampaign = async (req, res) => {
  const { name, description, device_ids, template_id, messages, min_delay, max_delay, duration } = req.body;

  if (!name || !device_ids || !messages || !min_delay || !max_delay || !duration) {
    return res.status(400).json({ status: 'error', message: 'Semua kolom bertanda bintang wajib diisi.' });
  }

  const deviceCount = device_ids.split(',').filter(Boolean).length;
  if (deviceCount < 2) {
    return res.status(400).json({ status: 'error', message: 'Minimal harus memilih 2 perangkat untuk pemanasan.' });
  }

  try {
    const result = await dbRun(
      `INSERT INTO warmer_campaigns 
      (name, description, device_ids, template_id, messages, min_delay, max_delay, duration, status, started_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        device_ids,
        template_id || null,
        messages,
        parseInt(min_delay),
        parseInt(max_delay),
        parseInt(duration),
        'RUNNING',
        new Date().toISOString()
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
        console.error(`[Warmer Controller] Gagal mendelegasikan warmer #${campaignId} ke worker:`, err.message);
      });
    }

    res.status(201).json({
      status: 'success',
      message: 'Kampanye warmer berhasil dimulai.',
      data: { id: campaignId, name, status: 'RUNNING' }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const stopCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Kampanye tidak ditemukan.' });
    }

    if (isSessionManagerClientEnabled()) {
      await sessionManagerClient.stopWarmerCampaign(id);
    } else {
      await warmerService.stopCampaign(id);
    }
    res.json({ status: 'success', message: 'Kampanye warmer berhasil dihentikan.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getCampaignLogs = async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!campaign) {
      return res.status(404).json({ status: 'error', message: 'Kampanye tidak ditemukan.' });
    }

    const logs = await dbAll(
      "SELECT * FROM warmer_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT 100",
      [id]
    );

    res.json({
      status: 'success',
      data: {
        campaign_id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        sent_count: campaign.sent_count,
        duration: campaign.duration,
        started_at: campaign.started_at,
        logs: logs
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Kampanye tidak ditemukan.' });
    }

    // Pastikan mematikan loop aktif jika sedang berjalan
    if (isSessionManagerClientEnabled()) {
      await sessionManagerClient.clearWarmerCampaign(id);
    } else {
      warmerService.clearTimer(id);
    }

    // Hapus kampanye (log juga terhapus otomatis karena ON DELETE CASCADE)
    await dbRun("DELETE FROM warmer_campaigns WHERE id = ?", [id]);
    res.json({ status: 'success', message: 'Kampanye warmer berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
