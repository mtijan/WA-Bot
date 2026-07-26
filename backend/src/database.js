import './env.js';
import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const dbPath = process.env.WA_BOT_DB_PATH || join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB Init] Failed to open database:', err);
  } else {
    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA busy_timeout = 5000;');
  }
});

let resolveDatabaseReady;
let rejectDatabaseReady;

export const databaseReady = new Promise((resolve, reject) => {
  resolveDatabaseReady = resolve;
  rejectDatabaseReady = reject;
});

runMigrations(db)
  .then((result) => {
    if (result.applied > 0) {
      console.log(`[DB Migrate] ${result.applied} migration(s) applied. Total known migrations: ${result.total}.`);
    }
    resolveDatabaseReady();
  })
  .catch((err) => {
    console.error('[DB Migrate] Failed to prepare database schema:', err);
    rejectDatabaseReady(err);
  });

export const dbRun = async (sql, params = []) => {
  await databaseReady;
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = async (sql, params = []) => {
  await databaseReady;
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = async (sql, params = []) => {
  await databaseReady;
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export default db;
