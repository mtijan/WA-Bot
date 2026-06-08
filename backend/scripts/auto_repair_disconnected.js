import sqlite3 from 'sqlite3';
import fs from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.WA_BOT_DB_PATH || join(__dirname, '..', 'database.sqlite');
const internalToken = process.env.WA_BOT_INTERNAL_TOKEN || '';
const rawSessionManagerUrl = process.env.WA_BOT_SESSION_MANAGER_URL || 'http://127.0.0.1:3002/internal';
const sessionManagerUrl = rawSessionManagerUrl.replace(/\/+$/, '');

const telegramBotToken = process.env.WA_BOT_ALERT_TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.WA_BOT_ALERT_TELEGRAM_CHAT_ID || '';

const stateDir = join(__dirname, '..', 'data');
const stateFilePath = join(stateDir, 'auto_repair_state.json');

const MAX_REPAIRS_PER_24H = 5;
const REPAIR_COOLDOWN_MS = 5 * 60 * 1000; // 5 menit jeda antar repair per sesi

const nowIso = () => new Date().toISOString();

// Muat state dari berkas eksternal
function loadState() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  if (!fs.existsSync(stateFilePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (err) {
    console.error('[Auto Repair] Gagal membaca berkas state:', err.message);
    return {};
  }
}

// Simpan state ke berkas eksternal
function saveState(state) {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[Auto Repair] Gagal menyimpan berkas state:', err.message);
  }
}

// Bersihkan repair lawas (> 24 jam)
function pruneState(state) {
  const now = Date.now();
  const updated = {};
  for (const [sessionId, info] of Object.entries(state)) {
    const freshAttempts = (info.attempts || []).filter(timestamp => {
      return (now - timestamp) < 24 * 60 * 60 * 1000;
    });
    if (freshAttempts.length > 0) {
      updated[sessionId] = {
        attempts: freshAttempts,
        alertedLimitReached: info.alertedLimitReached || false
      };
      // Reset status alert jika jumlah attempts sudah di bawah limit
      if (freshAttempts.length < MAX_REPAIRS_PER_24H) {
        updated[sessionId].alertedLimitReached = false;
      }
    }
  }
  return updated;
}

// Kirim notifikasi Telegram jika dikonfigurasi
async function sendTelegramNotification(message) {
  if (!telegramBotToken || !telegramChatId) return;
  const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  try {
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        disable_web_page_preview: true
      })
    });
    if (!response.ok) {
      console.error(`[Auto Repair] Telegram API merespons HTTP ${response.status}`);
    }
  } catch (err) {
    console.error('[Auto Repair] Gagal mengirim notifikasi Telegram:', err.message);
  }
}

// Panggil REST API internal untuk melakukan perbaikan sesi
async function triggerInternalRepair(sessionId) {
  const repairUrl = `${sessionManagerUrl}/sessions/${encodeURIComponent(sessionId)}/repair`;
  console.log(`[Auto Repair] Memanggil endpoint repair: ${repairUrl}`);

  const headers = {};
  if (internalToken) {
    headers['X-Internal-Token'] = internalToken;
  }

  const response = await fetch(repairUrl, {
    method: 'POST',
    headers
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }

  return payload;
}

async function main() {
  console.log(`[Auto Repair] Memulai pemeriksaan sesi terputus pada: ${nowIso()}`);
  const db = new sqlite3.Database(dbPath);

  // Ambil semua sesi yang berstatus DISCONNECTED
  const getDisconnectedSessions = () => {
    return new Promise((resolvePromise, rejectPromise) => {
      db.all(
        "SELECT session_id, phone_number, status FROM sessions WHERE status = 'DISCONNECTED'",
        [],
        (err, rows) => {
          if (err) rejectPromise(err);
          else resolvePromise(rows || []);
        }
      );
    });
  };

  try {
    const disconnected = await getDisconnectedSessions();
    console.log(`[Auto Repair] Ditemukan ${disconnected.length} sesi berstatus DISCONNECTED`);

    if (disconnected.length === 0) {
      return;
    }

    let state = loadState();
    state = pruneState(state);
    const now = Date.now();
    let hasChanges = false;

    for (const session of disconnected) {
      const sessionId = session.session_id;
      const sessionInfo = state[sessionId] || { attempts: [], alertedLimitReached: false };
      const attemptsCount = sessionInfo.attempts.length;

      // Cek apakah sudah melewati batas maksimal perbaikan dalam 24 jam
      if (attemptsCount >= MAX_REPAIRS_PER_24H) {
        console.warn(`[Auto Repair] Sesi ${sessionId} dilewati karena sudah mencapai batas maksimum perbaikan (${MAX_REPAIRS_PER_24H} kali dalam 24 jam).`);
        
        // Kirim alert ke Telegram hanya SEKALI ketika batas terlampaui
        if (!sessionInfo.alertedLimitReached) {
          const phoneDisplay = session.phone_number ? `(+${session.phone_number})` : '(belum tertaut)';
          const limitMsg = `WA-Bot Auto Repair Warning\nSesi ${sessionId} ${phoneDisplay} telah mencapai batas maksimum perbaikan otomatis (${MAX_REPAIRS_PER_24H} kali dalam 24 jam).\nPerbaikan otomatis untuk sesi ini akan dinonaktifkan sementara hingga batas waktu reset 24 jam terlewati. Silakan periksa nomor Anda secara manual (kemungkinan terputus permanen atau diblokir).`;
          
          await sendTelegramNotification(limitMsg);
          
          sessionInfo.alertedLimitReached = true;
          state[sessionId] = sessionInfo;
          hasChanges = true;
        }
        continue;
      }

      // Cek cooldown (agar tidak langsung repair ulang berturut-turut dalam waktu singkat jika baru saja di-repair)
      if (attemptsCount > 0) {
        const lastAttempt = sessionInfo.attempts[attemptsCount - 1];
        if ((now - lastAttempt) < REPAIR_COOLDOWN_MS) {
          const waitMinutes = Math.ceil((REPAIR_COOLDOWN_MS - (now - lastAttempt)) / (60 * 1000));
          console.log(`[Auto Repair] Sesi ${sessionId} dalam masa cooldown. Menunggu ${waitMinutes} menit.`);
          continue;
        }
      }

      // Jalankan perbaikan
      console.log(`[Auto Repair] Menjalankan perbaikan otomatis ke-${attemptsCount + 1} untuk sesi: ${sessionId}`);
      try {
        await triggerInternalRepair(sessionId);
        
        // Catat keberhasilan upaya perbaikan
        sessionInfo.attempts.push(now);
        state[sessionId] = sessionInfo;
        hasChanges = true;

        const phoneDisplay = session.phone_number ? `(+${session.phone_number})` : '(belum tertaut)';
        const successMsg = `WA-Bot Auto Repair\nSesi ${sessionId} ${phoneDisplay} terdeteksi terputus dan telah berhasil dipicu perbaikan otomatis.\nUpaya ke-${sessionInfo.attempts.length} dalam 24 jam terakhir.`;
        
        console.log(`[Auto Repair] Berhasil memicu perbaikan untuk sesi ${sessionId}`);
        await sendTelegramNotification(successMsg);
      } catch (repairErr) {
        console.error(`[Auto Repair] Gagal memicu perbaikan untuk sesi ${sessionId}:`, repairErr.message);
        
        // Log kegagalan ke database
        try {
          await new Promise((resolveQuery, rejectQuery) => {
            db.run(
              `INSERT INTO session_repair_logs (session_id, status, error_message, downtime_seconds, trigger_type)
               VALUES (?, ?, ?, NULL, 'AUTO')`,
              [sessionId, 'FAILED', repairErr.message || String(repairErr)],
              (dbErr) => {
                if (dbErr) rejectQuery(dbErr);
                else resolveQuery();
              }
            );
          });
        } catch (dbErr) {
          console.error('[Auto Repair] Gagal mencatat logs error repair ke DB:', dbErr.message);
        }

        // Tetap catat upaya agar tidak melooping tanpa henti jika port internal error/down
        sessionInfo.attempts.push(now);
        state[sessionId] = sessionInfo;
        hasChanges = true;

        const phoneDisplay = session.phone_number ? `(+${session.phone_number})` : '(belum tertaut)';
        const failMsg = `WA-Bot Auto Repair Gagal\nGagal memicu perbaikan otomatis untuk sesi ${sessionId} ${phoneDisplay}.\nError: ${repairErr.message}\nUpaya ke-${sessionInfo.attempts.length} dalam 24 jam terakhir.`;
        await sendTelegramNotification(failMsg);
      }
    }

    if (hasChanges) {
      saveState(state);
    }
  } catch (err) {
    console.error('[Auto Repair] Terjadi kesalahan dalam pemeriksaan sesi:', err.message);
  } finally {
    db.close();
    console.log('[Auto Repair] Pemeriksaan selesai.');
  }
}

main().catch(err => {
  console.error('[Auto Repair] Fatal error:', err.message);
});
