import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', 'database.sqlite');
const retentionDays = Number.parseInt(process.env.WA_BOT_LOG_RETENTION_DAYS || '30', 10);
const shouldApply = process.argv.includes('--apply');

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  throw new Error('WA_BOT_LOG_RETENTION_DAYS harus berupa angka positif.');
}

const db = new sqlite3.Database(dbPath);
const whereClause = "created_at IS NOT NULL AND created_at < datetime('now', ?)";
const age = `-${retentionDays} days`;

db.get(`SELECT COUNT(*) AS count FROM delivery_logs WHERE ${whereClause}`, [age], (countError, row) => {
  if (countError) {
    db.close();
    throw countError;
  }

  console.log(`[Delivery Logs] Retention: ${retentionDays} hari`);
  console.log(`[Delivery Logs] Kandidat penghapusan: ${row.count}`);

  if (!shouldApply) {
    console.log('[Delivery Logs] Dry-run selesai. Jalankan kembali dengan --apply untuk menghapus data.');
    return db.close();
  }

  db.run(`DELETE FROM delivery_logs WHERE ${whereClause}`, [age], function deleteLogs(deleteError) {
    if (deleteError) {
      db.close();
      throw deleteError;
    }

    console.log(`[Delivery Logs] Baris dihapus: ${this.changes}`);
    db.close();
  });
});

