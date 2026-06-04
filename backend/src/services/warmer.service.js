import { dbRun, dbGet, dbAll } from '../database.js';
import whatsappService from './whatsapp.service.js';
import { config } from '../config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WarmerService {
  constructor() {
    this.campaignTimers = {};
    this.activeCampaigns = new Set();
    this.pollingTimer = null;
  }

  // Pulihkan semua kampanye warmer yang berstatus RUNNING saat server dinyalakan
  async initWarmerEngine() {
    try {
      console.log('[Warmer Worker] Menginisialisasi mesin warmer...');
      const runningCampaigns = await dbAll("SELECT * FROM warmer_campaigns WHERE status = 'RUNNING'");
      
      const now = new Date();
      for (const campaign of runningCampaigns) {
        const startedAt = new Date(campaign.started_at);
        const elapsedMinutes = (now - startedAt) / 60000;
        
        if (elapsedMinutes >= campaign.duration) {
          // Durasi sudah kedaluwarsa sewaktu server mati, tandai selesai
          await dbRun(
            "UPDATE warmer_campaigns SET status = 'COMPLETED', completed_at = ? WHERE id = ?",
            [new Date().toISOString(), campaign.id]
          );
          console.log(`[Warmer Worker] Kampanye warmer #${campaign.id} ditandai selesai karena melewati durasi.`);
        } else {
          // Lanjutkan kampanye
          if (this.campaignTimers[campaign.id] || this.activeCampaigns.has(campaign.id)) {
            continue;
          }

          console.log(`[Warmer Worker] Memulihkan kampanye warmer #${campaign.id}`);
          this.startCampaignLoop(campaign.id).catch(err => {
            console.error(`Gagal memulihkan loop warmer #${campaign.id}:`, err);
          });
        }
      }
    } catch (err) {
      console.error('Gagal menginisialisasi warmer engine:', err);
    }
  }

  async startPollingWorker(intervalMs = config.runtime.warmerWorkerPollMs) {
    if (this.pollingTimer) return;

    await this.initWarmerEngine();

    const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30000;
    this.pollingTimer = setInterval(() => {
      this.initWarmerEngine().catch((err) => {
        console.error('[Warmer Worker] Gagal polling kampanye warmer:', err);
      });
    }, safeInterval);

    console.log(`[Warmer Worker] Polling aktif setiap ${safeInterval}ms.`);
  }

  // Memulai loop kampanye warmer secara asinkron
  async startCampaign(campaignId) {
    // Pastikan tidak ada timer ganda
    if (this.campaignTimers[campaignId]) {
      clearTimeout(this.campaignTimers[campaignId]);
      delete this.campaignTimers[campaignId];
    }

    await dbRun(
      "UPDATE warmer_campaigns SET status = 'RUNNING', started_at = ?, completed_at = NULL WHERE id = ?",
      [new Date().toISOString(), campaignId]
    );

    this.startCampaignLoop(campaignId).catch(err => {
      console.error(`Error pada loop awal kampanye warmer #${campaignId}:`, err);
    });
  }

  // Fungsi internal untuk eksekusi loop berkala
  async startCampaignLoop(campaignId) {
    if (this.activeCampaigns.has(campaignId)) return;
    this.activeCampaigns.add(campaignId);

    const runCycle = async () => {
      try {
        const campaign = await dbGet("SELECT * FROM warmer_campaigns WHERE id = ?", [campaignId]);
        if (!campaign || campaign.status !== 'RUNNING') {
          this.clearTimer(campaignId);
          return;
        }

        // 1. Cek Durasi Kampanye
        const now = new Date();
        const startedAt = new Date(campaign.started_at);
        const elapsedMinutes = (now - startedAt) / 60000;

        if (elapsedMinutes >= campaign.duration) {
          await dbRun(
            "UPDATE warmer_campaigns SET status = 'COMPLETED', completed_at = ? WHERE id = ?",
            [new Date().toISOString(), campaignId]
          );
          console.log(`[Warmer Worker] Kampanye #${campaignId} selesai karena mencapai batas durasi (${campaign.duration} menit).`);
          
          await dbRun(
            "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status, error_message) VALUES (?, ?, ?, ?, ?, ?)",
            [campaignId, 'SYSTEM', 'SYSTEM', 'Kampanye warmer selesai otomatis sesuai batas durasi.', 'SUCCESS', null]
          );

          this.clearTimer(campaignId);
          return;
        }

        // 2. Cek Koneksi & Validasi Perangkat
        const devices = campaign.device_ids.split(',').map(id => id.trim()).filter(Boolean);
        if (devices.length < 2) {
          await this.pauseCampaign(campaignId, 'Sistem mendeteksi jumlah perangkat kurang dari 2.');
          return;
        }

        // Cek status koneksi masing-masing perangkat
        const connectedDevices = [];
        for (const devId of devices) {
          const session = await whatsappService.getSessionStatus(devId);
          if (session && session.status === 'CONNECTED' && whatsappService.sockets[devId]) {
            connectedDevices.push(devId);
          }
        }

        if (connectedDevices.length < 2) {
          await this.pauseCampaign(campaignId, `Kurang dari 2 perangkat aktif yang terhubung. Terdeteksi hanya ${connectedDevices.length} perangkat online.`);
          
          // Jadwalkan pengecekan ulang setelah 1 menit secara otomatis tanpa mematikan loop sepenuhnya jika ingin auto-resume,
          // namun sesuai desain premium, kita ubah status jadi PAUSED agar pengguna menyalakan kembali perangkatnya.
          return;
        }

        // 3. Rotasi Perangkat Simetris
        // Menggunakan sent_count modulo N untuk menentukan pengirim dan penerima berantai
        const N = connectedDevices.length;
        const senderIndex = campaign.sent_count % N;
        const receiverIndex = (senderIndex + 1) % N;

        const senderId = connectedDevices[senderIndex];
        const receiverId = connectedDevices[receiverIndex];

        // Ambil data nomor tujuan
        const senderSession = await dbGet("SELECT phone_number FROM sessions WHERE session_id = ?", [senderId]);
        const receiverSession = await dbGet("SELECT phone_number FROM sessions WHERE session_id = ?", [receiverId]);

        if (!senderSession?.phone_number || !receiverSession?.phone_number) {
          console.warn(`[Warmer Worker] Informasi nomor telepon untuk sesi ${senderId} atau ${receiverId} tidak ditemukan.`);
          // Jadwalkan ulang pengulangan cepat jika terjadi kendala metadata
          this.scheduleNext(campaignId, 10, 15);
          return;
        }

        // 4. Pilih Pesan Acak dari Daftar
        const msgs = campaign.messages.split('\n').map(m => m.trim()).filter(Boolean);
        if (msgs.length === 0) {
          await this.pauseCampaign(campaignId, 'Daftar kalimat pesan kosong.');
          return;
        }
        const selectedMessage = msgs[Math.floor(Math.random() * msgs.length)];

        // 5. Eksekusi Pengiriman Dengan Emulasi Typing
        try {
          const senderSock = whatsappService.sockets[senderId];
          let cleanNumber = receiverSession.phone_number.replace(/\D/g, '');
          if (cleanNumber.startsWith('0')) {
            cleanNumber = '62' + cleanNumber.slice(1);
          }
          const receiverJid = `${cleanNumber}@s.whatsapp.net`;

          // Emulasi Typing (Human-like)
          try {
            await senderSock.presenceSubscribe(receiverJid);
            await senderSock.sendPresenceUpdate('composing', receiverJid);
            await sleep(3500); // Ketik selama 3.5 detik
            await senderSock.sendPresenceUpdate('paused', receiverJid);
          } catch (typeErr) {
            // Jika emulasi typing gagal karena kendala socket, abaikan dan lanjut kirim pesan
          }

          // Kirim pesan aktual
          await whatsappService.sendMessage(senderId, receiverSession.phone_number, selectedMessage);

          // Catat log kesuksesan
          await dbRun(
            "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status) VALUES (?, ?, ?, ?, ?)",
            [campaignId, senderId, receiverId, selectedMessage, 'SUCCESS']
          );

          // Tambahkan jumlah terkirim
          await dbRun("UPDATE warmer_campaigns SET sent_count = sent_count + 1 WHERE id = ?", [campaignId]);
          console.log(`[Warmer Worker] Kampanye #${campaignId}: ${senderId} -> ${receiverId} berhasil mengirim.`);
        } catch (sendErr) {
          console.error(`[Warmer Worker] Gagal mengirim pesan warmer dari ${senderId} ke ${receiverId}:`, sendErr.message);
          
          await dbRun(
            "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status, error_message) VALUES (?, ?, ?, ?, ?, ?)",
            [campaignId, senderId, receiverId, selectedMessage, 'FAILED', sendErr.message]
          );
        }

        // 6. Jadwalkan Siklus Berikutnya dengan Delay Acak
        this.scheduleNext(campaignId, campaign.min_delay, campaign.max_delay);
      } catch (err) {
        console.error(`[Warmer Worker] Kesalahan kritis pada siklus kampanye warmer #${campaignId}:`, err);
        this.scheduleNext(campaignId, 30, 60); // Coba lagi nanti
      } finally {
        this.activeCampaigns.delete(campaignId);
      }
    };

    // Pemicu awal siklus
    runCycle();
  }

  // Menjadwalkan eksekusi berikutnya secara rekursif
  scheduleNext(campaignId, minDelay, maxDelay) {
    this.clearTimer(campaignId);

    const delaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    this.campaignTimers[campaignId] = setTimeout(() => {
      this.startCampaignLoop(campaignId).catch(err => {
        console.error(`Gagal menjalankan loop berkala warmer #${campaignId}:`, err);
      });
    }, delaySeconds * 1000);
  }

  // Menghentikan kampanye warmer secara paksa (COMPLETED)
  async stopCampaign(campaignId) {
    this.clearTimer(campaignId);
    await dbRun(
      "UPDATE warmer_campaigns SET status = 'COMPLETED', completed_at = ? WHERE id = ?",
      [new Date().toISOString(), campaignId]
    );
    await dbRun(
      "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status) VALUES (?, ?, ?, ?, ?)",
      [campaignId, 'SYSTEM', 'SYSTEM', 'Kampanye warmer dihentikan secara manual oleh pengguna.', 'SUCCESS']
    );
  }

  // Menghentikan sementara kampanye warmer (PAUSED) akibat masalah koneksi
  async pauseCampaign(campaignId, reason) {
    this.clearTimer(campaignId);
    await dbRun(
      "UPDATE warmer_campaigns SET status = 'PAUSED' WHERE id = ?",
      [campaignId]
    );
    await dbRun(
      "INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status, error_message) VALUES (?, ?, ?, ?, ?, ?)",
      [campaignId, 'SYSTEM', 'SYSTEM', `Kampanye ditangguhkan (PAUSED). Alasan: ${reason}`, 'FAILED', reason]
    );
    console.warn(`[Warmer Worker] Kampanye warmer #${campaignId} ditangguhkan. Alasan: ${reason}`);
  }

  // Pembersihan timer lokal
  clearTimer(campaignId) {
    if (this.campaignTimers[campaignId]) {
      clearTimeout(this.campaignTimers[campaignId]);
      delete this.campaignTimers[campaignId];
    }
  }
}

const warmerService = new WarmerService();
export default warmerService;
