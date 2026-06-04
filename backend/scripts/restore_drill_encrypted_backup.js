import fs from 'fs';
import sqlite3 from 'sqlite3';
import { basename, join, resolve } from 'path';
import {
  decryptFile,
  deriveBackupKey,
  getEncryptedBackupRoot,
  getRestoreDrillRoot,
  timestampForPath
} from './encrypted_backup_lib.js';

const selectedBackup = process.argv[2];

const backupRoot = getEncryptedBackupRoot();
const backupDir = selectedBackup
  ? resolve(selectedBackup)
  : resolve(backupRoot, fs.readdirSync(backupRoot).filter((entry) => {
      return fs.existsSync(join(backupRoot, entry, 'manifest.json'));
    }).sort().pop() || '');

if (!backupDir || !fs.existsSync(join(backupDir, 'manifest.json'))) {
  throw new Error('Encrypted backup tidak ditemukan. Jalankan npm run backup:encrypted terlebih dahulu.');
}

const manifest = JSON.parse(fs.readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
if (manifest.format !== 'wa-bot-encrypted-runtime-backup-v1') {
  throw new Error(`Format backup tidak dikenal: ${manifest.format}`);
}

const key = deriveBackupKey(Buffer.from(manifest.encryption.salt, 'base64'));
const restoreDir = join(getRestoreDrillRoot(), `${timestampForPath()}_${basename(backupDir)}`);

for (const file of manifest.files) {
  decryptFile({
    encryptedPath: join(backupDir, 'files', file.encrypted_file),
    destinationPath: join(restoreDir, file.path),
    key,
    iv: file.iv,
    authTag: file.auth_tag,
    expectedSha256: file.sha256
  });
}

const restoredDb = join(restoreDir, 'database.sqlite');
if (fs.existsSync(restoredDb)) {
  const db = new sqlite3.Database(restoredDb);
  await new Promise((resolvePromise, rejectPromise) => {
    db.get('SELECT COUNT(*) as count FROM sqlite_master WHERE type = ?', ['table'], (err, row) => {
      if (err) rejectPromise(err);
      else {
        console.log(`[Restore Drill] SQLite table count: ${row.count}`);
        resolvePromise();
      }
    });
  });
  db.close();
}

console.log(`[Restore Drill] Backup source: ${backupDir}`);
console.log(`[Restore Drill] Restored to drill directory: ${restoreDir}`);
console.log('[Restore Drill] Live runtime data was not overwritten.');
