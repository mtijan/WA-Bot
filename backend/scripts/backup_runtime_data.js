import '../src/env.js';
import fs from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = resolve(process.env.WA_BOT_BACKUP_DIR || join(backendDir, 'backups'));
const backupDir = join(backupRoot, timestamp);

fs.mkdirSync(backupDir, { recursive: true });

const databasePath = join(backendDir, 'database.sqlite');
if (fs.existsSync(databasePath)) {
  fs.copyFileSync(databasePath, join(backupDir, 'database.sqlite'));
}

const sessionsPath = join(backendDir, 'sessions');
if (fs.existsSync(sessionsPath)) {
  fs.cpSync(sessionsPath, join(backupDir, 'sessions'), { recursive: true });
}

console.log(`[Backup] Runtime data copied to: ${backupDir}`);
console.log('[Backup] Treat this directory as sensitive data and encrypt protected storage.');
