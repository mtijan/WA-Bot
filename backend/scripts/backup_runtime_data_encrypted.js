import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';
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
