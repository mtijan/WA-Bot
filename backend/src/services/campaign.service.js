import { dbRun, dbGet, dbAll } from '../database.js';
import whatsappService from './whatsapp.service.js';
import { isOptedOut } from './opt_out.service.js';
import { config } from '../config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldRunInlineWorkers = () => {
  return config.runtime.role === 'all';
};

class CampaignService {
  constructor() {
    this.activeCampaigns = new Set();
    this.pollingTimer = null;
  }

  // Pulihkan kampanye yang terputus (misal server crash saat RUNNING)
  async initCampaignEngine({ resetRunning = true } = {}) {
    try {
      if (resetRunning) {
        await dbRun("UPDATE campaigns SET status = 'PENDING' WHERE status = 'RUNNING'");
        console.log('[Campaign Worker] Mengatur ulang kampanye macet ke status PENDING.');
      }

      await this.processPendingCampaigns();
    } catch (err) {
      console.error('Gagal menginisialisasi campaign engine:', err);
    }
  }

  async processPendingCampaigns() {
    const pendingCampaigns = await dbAll("SELECT id FROM campaigns WHERE status = 'PENDING'");
    for (const row of pendingCampaigns) {
      this.processCampaign(row.id).catch(err => {
        console.error(`Gagal memproses kampanye tertunda ${row.id}:`, err);
      });
    }
  }

  async startPollingWorker(intervalMs = config.runtime.campaignWorkerPollMs) {
    if (this.pollingTimer) return;

    await this.initCampaignEngine({ resetRunning: true });

    const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 15000;
    this.pollingTimer = setInterval(() => {
      this.processPendingCampaigns().catch((err) => {
        console.error('[Campaign Worker] Gagal polling kampanye pending:', err);
      });
    }, safeInterval);

    console.log(`[Campaign Worker] Polling aktif setiap ${safeInterval}ms.`);
  }

  async createCampaign(sessionId, message, targets, delayMin = 3000, delayMax = 8000, name = '', attachmentUrl = null, attachmentType = null, attachmentName = null) {
    // Pastikan nomor target unik untuk menghindari pengiriman dobel
    const uniqueTargets = [...new Set(targets.map(num => num.trim()).filter(Boolean))];

    const sessionRow = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sessionRow) {
      throw new Error(`Sesi ${sessionId} tidak ditemukan. Kampanye tidak dapat dibuat tanpa pemilik tenant.`);
    }
    const userId = sessionRow.user_id;

    // Buat kampanye utama
    const campaignResult = await dbRun(
      'INSERT INTO campaigns (session_id, name, message, status, attachment_url, attachment_type, attachment_name, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [sessionId, name || null, message, 'PENDING', attachmentUrl, attachmentType, attachmentName, userId]
    );
    const campaignId = campaignResult.id;

    // Jika nama kosong, isi otomatis dengan format Campaign #ID
    if (!name) {
      await dbRun('UPDATE campaigns SET name = ? WHERE id = ?', [`Campaign #${campaignId}`, campaignId]);
    }

    // Buat logs untuk masing-masing target
    for (const target of uniqueTargets) {
      await dbRun(
        'INSERT INTO delivery_logs (campaign_id, target_number, status, user_id) VALUES (?, ?, ?, ?)',
        [campaignId, target, 'PENDING', userId]
      );
    }

    if (shouldRunInlineWorkers()) {
      // Eksekusi antrean di background secara asinkron pada mode monolith lokal.
      this.processCampaign(campaignId, delayMin, delayMax).catch(err => {
        console.error(`Error pada kampanye ID ${campaignId}:`, err);
      });
    }

    return campaignId;
  }

  async processCampaign(campaignId, delayMin = 3000, delayMax = 8000) {
    if (this.activeCampaigns.has(campaignId)) return;
    this.activeCampaigns.add(campaignId);

    try {
      const campaign = await dbGet('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      if (!campaign || campaign.status !== 'PENDING') {
        this.activeCampaigns.delete(campaignId);
        return;
      }

      const sessionOwner = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [campaign.session_id]);
      if (!sessionOwner) {
        await dbRun(
          'UPDATE campaigns SET status = ? WHERE id = ?',
          ['FAILED', campaignId]
        );
        await dbRun(
          `UPDATE delivery_logs
           SET status = ?, error_message = ?
           WHERE campaign_id = ? AND status = 'PENDING'`,
          ['FAILED', 'Sesi kampanye tidak ditemukan. Kampanye dihentikan untuk mencegah salah tenant.', campaignId]
        );
        console.warn(`[Campaign Worker] Kampanye #${campaignId} dihentikan: sesi ${campaign.session_id} tidak ditemukan.`);
        this.activeCampaigns.delete(campaignId);
        return;
      }
      const userId = sessionOwner.user_id;

      // Tandai sedang berjalan
      await dbRun('UPDATE campaigns SET status = ? WHERE id = ?', ['RUNNING', campaignId]);
      console.log(`[Campaign Worker] Mulai memproses kampanye #${campaignId} dengan akun: ${campaign.session_id} (User ID: ${userId})`);

      // Ambil daftar target tersisa
      const pendingLogs = await dbAll(
        "SELECT * FROM delivery_logs WHERE campaign_id = ? AND status = 'PENDING'",
        [campaignId]
      );

      for (const log of pendingLogs) {
        if (await isOptedOut(log.target_number, userId)) {
          await dbRun(
            'UPDATE delivery_logs SET status = ?, error_message = ? WHERE id = ?',
            ['SKIPPED_OPT_OUT', 'Penerima berada dalam suppression list.', log.id]
          );
          console.log(`[Campaign Worker] Kampanye #${campaignId} melewati satu penerima yang telah opt-out.`);
          continue;
        }

        // Cek kembali status sesi saat ini sebelum kirim
        const session = await whatsappService.getSessionStatus(campaign.session_id);
        if (!session || session.status !== 'CONNECTED') {
          console.warn(`[Campaign Worker] Sesi ${campaign.session_id} terputus. Menunda kampanye #${campaignId}.`);
          await dbRun('UPDATE campaigns SET status = ? WHERE id = ?', ['PENDING', campaignId]);
          this.activeCampaigns.delete(campaignId);
          return; // Hentikan antrean agar tidak fail massal
        }

        // Terapkan jeda waktu acak (Anti-Spam Meta)
        const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
        await sleep(delay);

        let targetName = '';
        try {
          let cleanNum = log.target_number.replace(/\D/g, '');
          let altNum = cleanNum;
          if (cleanNum.startsWith('62')) {
            altNum = '0' + cleanNum.slice(2);
          } else if (cleanNum.startsWith('0')) {
            altNum = '62' + cleanNum.slice(1);
          }
          
          const contactRow = await dbGet(
            `SELECT c.name
             FROM contacts c
             INNER JOIN contact_groups cg ON c.group_id = cg.id
             WHERE cg.user_id = ?
               AND (c.phone_number = ? OR c.phone_number = ? OR c.phone_number = ?)
             LIMIT 1`,
            [userId, log.target_number, cleanNum, altNum]
          );
          if (contactRow && contactRow.name) {
            targetName = contactRow.name;
          }
        } catch (err) {
          console.error('Error fetching contact name for personalization:', err);
        }

        let personalizedMessage = campaign.message;
        let displayName = targetName;
        if (!displayName || displayName.startsWith('Contact-')) {
          displayName = '';
        }
        
        personalizedMessage = personalizedMessage
          .replace(/\{\{name\}\}/gi, displayName)
          .replace(/\[name\]/gi, displayName)
          .replace(/\{\{nama\}\}/gi, displayName)
          .replace(/\[nama\]/gi, displayName);

        try {
          if (campaign.attachment_url) {
            const payload = {
              messageType: 'media',
              text: personalizedMessage,
              attachmentUrl: campaign.attachment_url,
              attachmentType: campaign.attachment_type,
              attachmentName: campaign.attachment_name
            };
            await whatsappService.sendSingleMessage(campaign.session_id, log.target_number, payload);
          } else {
            await whatsappService.sendMessage(campaign.session_id, log.target_number, personalizedMessage);
          }
          
          // Sukses kirim
          await dbRun('UPDATE delivery_logs SET status = ? WHERE id = ?', ['SENT', log.id]);
          console.log(`[Campaign Worker] Kampanye #${campaignId} berhasil mengirim satu pesan.`);
        } catch (err) {
          // Gagal kirim
          console.error(`[Campaign Worker] Kampanye #${campaignId} gagal mengirim satu pesan:`, err.message);
          await dbRun(
            'UPDATE delivery_logs SET status = ?, error_message = ? WHERE id = ?',
            ['FAILED', err.message, log.id]
          );
        }
      }

      // Tandai kampanye selesai
      await dbRun('UPDATE campaigns SET status = ? WHERE id = ?', ['COMPLETED', campaignId]);
      console.log(`[Campaign Worker] Kampanye #${campaignId} selesai dengan sukses.`);
    } catch (err) {
      console.error(`[Campaign Worker] Galat kritis pada kampanye #${campaignId}:`, err);
      await dbRun('UPDATE campaigns SET status = ? WHERE id = ?', ['PENDING', campaignId]);
    } finally {
      this.activeCampaigns.delete(campaignId);
    }
  }

  async getCampaignProgress(campaignId) {
    const campaign = await dbGet('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) return null;

    const stats = await dbAll(
      'SELECT status, COUNT(*) as count FROM delivery_logs WHERE campaign_id = ? GROUP BY status',
      [campaignId]
    );

    const metrics = { sent: 0, failed: 0, pending: 0, skippedOptOut: 0 };
    stats.forEach(row => {
      if (row.status === 'SENT') metrics.sent = row.count;
      if (row.status === 'FAILED') metrics.failed = row.count;
      if (row.status === 'PENDING') metrics.pending = row.count;
      if (row.status === 'SKIPPED_OPT_OUT') metrics.skippedOptOut = row.count;
    });

    const logs = await dbAll(
      'SELECT id, target_number, status, error_message FROM delivery_logs WHERE campaign_id = ? ORDER BY id DESC',
      [campaignId]
    );

    return {
      campaign_id: campaign.id,
      name: campaign.name,
      session_id: campaign.session_id,
      campaign_status: campaign.status,
      attachment_url: campaign.attachment_url,
      attachment_type: campaign.attachment_type,
      attachment_name: campaign.attachment_name,
      metrics,
      logs
    };
  }
}

const campaignService = new CampaignService();
export default campaignService;
