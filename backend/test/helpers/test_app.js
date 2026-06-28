/**
 * Test helper untuk membuat instance Express app dengan database test terpisah.
 * File ini meng-set env var WA_BOT_DB_PATH ke file sementara sebelum mengimpor app,
 * sehingga pengujian tidak menyentuh database development.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import supertest from 'supertest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Buat direktori sementara untuk database test
const testTmpDir = mkdtempSync(join(tmpdir(), 'wa-bot-test-'));
const testDbPath = join(testTmpDir, 'test.sqlite');

// Set env var sebelum import apapun dari app agar database.js membaca path ini
process.env.NODE_ENV = 'test';
process.env.WA_BOT_DB_PATH = testDbPath;
process.env.WA_BOT_INTERNAL_TOKEN = 'testing-internal-token-secret-placeholder';

// Nonaktifkan admin auth dan API key agar test bisa mengakses endpoint tanpa kredensial
// kecuali kita secara eksplisit ingin menguji autentikasi
if (!process.env.WA_BOT_ADMIN_PASSWORD) {
  process.env.WA_BOT_ADMIN_PASSWORD = '';
}
if (!process.env.WA_BOT_API_KEY) {
  process.env.WA_BOT_API_KEY = '';
}

// Import createApp setelah env var di-set
const { createApp } = await import('../../src/app.js');
const { databaseReady } = await import('../../src/database.js');

let _app = null;

/**
 * Mengembalikan instance supertest yang siap digunakan untuk mengirim HTTP request.
 * Menunggu database siap (migrasi selesai) sebelum mengembalikan instance.
 * @returns {Promise<import('supertest').Agent>}
 */
export async function getTestAgent() {
  if (!_app) {
    await databaseReady;
    
    // Seed admin user dengan ID 1 jika belum ada agar foreign key constraint tidak gagal
    const { dbGet, dbRun } = await import('../../src/database.js');
    const existing = await dbGet('SELECT id FROM users WHERE id = 1');
    if (!existing) {
      await dbRun(
        "INSERT INTO users (id, username, password_hash, display_name, role, is_active) VALUES (1, 'admin', 'dummy_hash', 'Administrator', 'admin', 1)"
      );
    }
    
    _app = createApp({ runtimeRole: 'all' });
  }
  return supertest(_app);
}

/**
 * Mengembalikan instance supertest dengan autentikasi admin aktif.
 * Meng-set kredensial admin sementara dan mendapatkan cookie login.
 * @returns {Promise<{agent: import('supertest').Agent, cookie: string}>}
 */
export async function getAuthenticatedAgent() {
  // Set password test sementara
  process.env.WA_BOT_ADMIN_PASSWORD = 'test-admin-password-12345';
  process.env.WA_BOT_ADMIN_USERNAME = 'admin';

  // Buat ulang app dengan auth enabled
  await databaseReady;
  const authApp = createApp({ runtimeRole: 'all', authEnabled: true });
  const agent = supertest(authApp);

  // Secara dinamis seed admin user ke database test
  const bcrypt = await import('bcryptjs');
  const { dbRun, dbGet } = await import('../../src/database.js');
  const salt = await bcrypt.default.genSalt(12);
  const hash = await bcrypt.default.hash('test-admin-password-12345', salt);
  
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', ['admin']);
  if (existing) {
    await dbRun(
      "UPDATE users SET password_hash = ?, token_version = 0, is_active = 1 WHERE username = ?",
      [hash, 'admin']
    );
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [existing.id]);
  } else {
    await dbRun(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES ('admin', ?, 'Administrator', 'admin', 1)",
      [hash]
    );
  }

  // Login untuk mendapatkan cookie
  const loginRes = await agent
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'test-admin-password-12345' });

  const cookies = loginRes.headers['set-cookie'];
  const cookie = Array.isArray(cookies) 
    ? cookies.map(c => c.split(';')[0]).join('; ') 
    : (cookies || '');

  return { agent, cookie };
}

/**
 * Membersihkan file database sementara setelah pengujian selesai.
 */
export function cleanupTestDb() {
  try {
    rmSync(testTmpDir, { recursive: true, force: true });
  } catch {
    // Abaikan error jika tidak bisa dihapus (mungkin masih terkunci oleh sqlite)
  }
}
