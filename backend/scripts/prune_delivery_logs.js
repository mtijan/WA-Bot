import sqlite3 from 'sqlite3';
import fs from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = process.env.WA_BOT_DB_PATH || join(__dirname, '..', 'database.sqlite');
const retentionDays = Number.parseInt(process.env.WA_BOT_LOG_RETENTION_DAYS || '30', 10);
const shouldApply = process.argv.includes('--apply');

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  throw new Error('WA_BOT_LOG_RETENTION_DAYS harus berupa angka positif.');
}

const ageLimitMs = retentionDays * 24 * 60 * 60 * 1000;
const cutOffDate = new Date(Date.now() - ageLimitMs);

console.log(`[Logs Pruner] Retention: ${retentionDays} hari`);
console.log(`[Logs Pruner] Batas waktu: ${cutOffDate.toISOString()}`);

const db = new sqlite3.Database(dbPath);

const pruneDbTable = (tableName) => {
  return new Promise((resolvePromise, rejectPromise) => {
    const whereClause = "created_at IS NOT NULL AND created_at < datetime('now', ?)";
    const age = `-${retentionDays} days`;

    db.get(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${whereClause}`, [age], (countError, row) => {
      if (countError) {
        return rejectPromise(countError);
      }

      const count = row ? row.count : 0;
      console.log(`[Database] Table ${tableName} - Kandidat penghapusan: ${count}`);

      if (!shouldApply) {
        return resolvePromise(0);
      }

      db.run(`DELETE FROM ${tableName} WHERE ${whereClause}`, [age], function onDelete(deleteError) {
        if (deleteError) {
          return rejectPromise(deleteError);
        }
        console.log(`[Database] Table ${tableName} - Baris dihapus: ${this.changes}`);
        resolvePromise(this.changes);
      });
    });
  });
};

const pruneExportFiles = async () => {
  const workspaceRoot = process.env.WA_BOT_WORKSPACE_ROOT || resolve(__dirname, '..', '..');
  try {
    const files = fs.readdirSync(workspaceRoot);
    let candidateCount = 0;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('ExportWAContacts_') && (file.endsWith('.csv') || file.endsWith('.json') || file.endsWith('.txt'))) {
        const filePath = join(workspaceRoot, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < (Date.now() - ageLimitMs)) {
          candidateCount++;
          console.log(`[File Export] Kandidat: ${file} (Umur: ${Math.round((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24))} hari)`);
          if (shouldApply) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      }
    }

    console.log(`[File Export] Total kandidat file ekspor: ${candidateCount}`);
    if (shouldApply) {
      console.log(`[File Export] File ekspor dihapus: ${deletedCount}`);
    }
  } catch (err) {
    console.error(`[File Export] Gagal memangkas file ekspor: ${err.message}`);
  }
};

const pruneBackups = async () => {
  const backendDir = resolve(__dirname, '..');
  const backupRoot = resolve(process.env.WA_BOT_BACKUP_DIR || join(backendDir, 'backups'));
  
  if (!fs.existsSync(backupRoot)) {
    console.log('[Backups] Folder backup tidak ditemukan.');
    return;
  }

  try {
    const folders = fs.readdirSync(backupRoot);
    let candidateCount = 0;
    let deletedCount = 0;

    for (const folder of folders) {
      const folderPath = join(backupRoot, folder);
      const stat = fs.statSync(folderPath);

      if (stat.isDirectory()) {
        const isTimestampFolder = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(folder) || 
                                 /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(folder);
        
        if (isTimestampFolder && stat.mtimeMs < (Date.now() - ageLimitMs)) {
          candidateCount++;
          console.log(`[Backups] Kandidat: ${folder} (Umur: ${Math.round((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24))} hari)`);
          if (shouldApply) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            deletedCount++;
          }
        }
      }
    }

    console.log(`[Backups] Total kandidat folder backup: ${candidateCount}`);
    if (shouldApply) {
      console.log(`[Backups] Folder backup dihapus: ${deletedCount}`);
    }
  } catch (err) {
    console.error(`[Backups] Gagal memangkas backups: ${err.message}`);
  }
};

try {
  await pruneDbTable('delivery_logs');
  await pruneDbTable('warmer_logs');
  await pruneExportFiles();
  await pruneBackups();

  if (!shouldApply) {
    console.log('[Logs Pruner] Dry-run selesai. Jalankan kembali dengan --apply untuk menghapus data secara permanen.');
  } else {
    console.log('[Logs Pruner] Pembersihan data selesai.');
  }
} catch (error) {
  console.error('[Logs Pruner] Gagal:', error);
} finally {
  db.close();
}
