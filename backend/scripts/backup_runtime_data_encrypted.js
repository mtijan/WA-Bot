import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  collectRuntimeFiles,
  deriveBackupKey,
  encryptFile,
  getEncryptedBackupRoot,
  timestampForPath
} from './encrypted_backup_lib.js';

const startedAt = new Date();
const backupRoot = getEncryptedBackupRoot();
const backupId = timestampForPath();
const backupDir = join(backupRoot, backupId);
const filesDir = join(backupDir, 'files');

fs.mkdirSync(filesDir, { recursive: true });

const salt = crypto.randomBytes(16);
const key = deriveBackupKey(salt);
const runtimeFiles = collectRuntimeFiles();

const manifest = {
  format: 'wa-bot-encrypted-runtime-backup-v1',
  created_at: startedAt.toISOString(),
  encryption: {
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64')
  },
  files: []
};

for (const file of runtimeFiles) {
  manifest.files.push(encryptFile({
    sourcePath: file.absolutePath,
    outputDir: filesDir,
    relativePath: file.relativePath,
    key
  }));
}

fs.writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`[Encrypted Backup] Backup created: ${backupDir}`);
console.log(`[Encrypted Backup] Files encrypted: ${manifest.files.length}`);
console.log('[Encrypted Backup] Store WA_BOT_BACKUP_ENCRYPTION_KEY separately from this backup.');

// --- Telegram Upload and Archiving ---
async function uploadToTelegram() {
  const tarGzPath = `${backupDir}.tar.gz`;
  try {
    console.log(`[Encrypted Backup] Archiving backup folder to: ${tarGzPath}`);
    
    // Gunakan tar bawaan OS (berfungsi di Linux dan Windows 10/11)
    execSync(`tar -czf "${tarGzPath}" -C "${backupRoot}" "${backupId}"`, { stdio: 'ignore' });
    console.log('[Encrypted Backup] Archive created successfully.');

    const telegramBotToken = process.env.WA_BOT_ALERT_TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.WA_BOT_ALERT_TELEGRAM_CHAT_ID;

    if (telegramBotToken && telegramChatId) {
      console.log('[Telegram Upload] Sending encrypted backup archive to Telegram...');
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(tarGzPath);
      const blob = new Blob([fileBuffer], { type: 'application/gzip' });
      
      formData.append('document', blob, `${backupId}.tar.gz`);
      formData.append('chat_id', telegramChatId);
      formData.append('caption', `Backup S-BRO terenkripsi (Offsite Storage)\nTanggal: ${startedAt.toLocaleString()}\nBerkas: ${backupId}.tar.gz`);

      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendDocument`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        console.log('[Telegram Upload] Backup successfully uploaded to Telegram.');
      } else {
        const errText = await response.text();
        console.error('[Telegram Upload] Failed to upload backup to Telegram:', errText);
        
        // Kirim alarm kegagalan dalam bentuk pesan teks ke Telegram
        try {
          const alertUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
          await fetch(alertUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              text: `[ALARM BACKUP] Gagal mengunggah berkas cadangan ke Telegram.\nTanggal: ${startedAt.toLocaleString()}\nBerkas ID: ${backupId}\nError: ${errText}`,
              disable_web_page_preview: true
            })
          });
          console.log('[Telegram Upload] Failure notification sent to Telegram.');
        } catch (alertError) {
          console.error('[Telegram Upload] Failed to send failure notification to Telegram:', alertError.message);
        }
      }
    } else {
      console.log('[Telegram Upload] Skipping upload: WA_BOT_ALERT_TELEGRAM_BOT_TOKEN or WA_BOT_ALERT_TELEGRAM_CHAT_ID is not configured.');
    }
  } catch (error) {
    console.error('[Encrypted Backup] Failed to archive or upload to Telegram:', error.message);
  } finally {
    try {
      if (fs.existsSync(tarGzPath)) {
        fs.unlinkSync(tarGzPath);
        console.log(`[Encrypted Backup] Temporary archive cleared: ${tarGzPath}`);
      }
    } catch (cleanupError) {
      console.error('[Encrypted Backup] Failed to delete temporary archive:', cleanupError.message);
    }
  }
}

await uploadToTelegram();

