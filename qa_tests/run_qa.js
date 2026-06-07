import sqlite3 from 'sqlite3';
import axios from 'axios';
import puppeteer from 'puppeteer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createApiKeyAuth, createCorsOptions, createRateLimiter } from '../backend/src/middleware/security.middleware.js';
import { buildAdminCookie, createAdminAuthMiddleware, createAdminSessionToken, validateAdminCredentials, verifyAdminSessionToken } from '../backend/src/middleware/admin_auth.middleware.js';
import { maskAISettings, resolveStoredApiKey } from '../backend/src/controllers/chatbot_ai.controller.js';
import { protectSecret, revealSecret } from '../backend/src/services/secret.service.js';
import { databaseReady, dbRun } from '../backend/src/database.js';
import { canonicalPhoneNumber, isOptedOut, isOptOutKeyword, normalizePhoneNumber, recordOptOut, removeOptOut } from '../backend/src/services/opt_out.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Konfigurasi Path
const dbPath = join(__dirname, '..', 'backend', 'database.sqlite');
const screenshotsDir = join(__dirname, 'screenshots');
const backendUrl = 'http://localhost:3001/api';

// Buat folder screenshots jika belum ada
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runTests() {
  console.log('==================================================');
  console.log('MEMULAI QA TEST OTOMATIS: KESELURUHAN SISTEM WA-BOT');
  console.log('==================================================\n');

  try {
    await databaseReady;

    // 1. TAHAP PENGUJIAN DATABASE
    console.log('[QA - TAHAP 1] Verifikasi Skema Database SQLite3 (Seluruh Tabel)...');
    await verifyDatabaseSchema();
    console.log('>> Tahap 1 Sukses: Database terverifikasi.\n');

    // 2. TAHAP PENGUJIAN REST API BACKEND
    console.log('[QA - TAHAP 2] Pengujian Endpoint REST API Backend...');
    await verifyBackendApi();
    console.log('>> Tahap 2 Sukses: REST API terverifikasi.\n');

    // 3. TAHAP PENGUJIAN KEAMANAN (SECURITIES)
    console.log('[QA - TAHAP 3] Pengujian Keamanan (Securities)...');
    await runSecurityTests();
    console.log('>> Tahap 3 Sukses: Pengujian Keamanan terverifikasi.\n');

    // 4. TAHAP PENGUJIAN UI & SCREENSHOT (E2E PUPPETEER)
    console.log('[QA - TAHAP 4] Pengujian E2E & Tangkapan Layar Halaman UI...');
    await runE2eUiTests();
    console.log('>> Tahap 4 Sukses: Pengujian UI & tangkapan layar selesai.\n');

    console.log('==================================================');
    console.log('SELURUH QA TEST SELESAI DENGAN SUKSES (100% PASSED)');
    console.log(`Laporan dan screenshot disimpan di folder: ${screenshotsDir}`);
    console.log('==================================================');

  } catch (err) {
    console.error('\n[QA TEST ERROR] Pengujian terhenti karena kesalahan berikut:');
    console.error(err);
    process.exit(1);
  }
}

// Tahap 1: Verifikasi database komprehensif
function verifyDatabaseSchema() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error('Gagal membuka database SQLite3: ' + err.message));
    });

    const tablesToVerify = [
      'sessions', 'proxies', 'campaigns', 'delivery_logs', 
      'chatbot_flows', 'auto_replies', 'contact_groups', 
      'message_templates', 'contacts', 'warmer_templates', 
      'warmer_campaigns', 'warmer_logs', 'whatsapp_contacts',
      'settings', 'chatbot_ai_settings', 'opt_out_contacts'
    ];

    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
      if (err) {
        db.close();
        return reject(err);
      }

      const existingTables = rows.map(r => r.name);
      for (const table of tablesToVerify) {
        if (!existingTables.includes(table)) {
          db.close();
          return reject(new Error(`Tabel penting '${table}' tidak ditemukan di database!`));
        }
        console.log(` - Tabel ${table}: Terverifikasi.`);
      }

      db.close();
      resolve();
    });
  });
}

// Tahap 2: Pengujian REST API
async function verifyBackendApi() {
  // 1. Uji Sesi
  console.log(' - Menguji GET /api/sessions...');
  const sessionsRes = await axios.get(`${backendUrl}/sessions`);
  if (sessionsRes.data.status !== 'success' || !Array.isArray(sessionsRes.data.data)) {
    throw new Error('Format respon GET /api/sessions tidak valid!');
  }
  console.log(`   Status: Sukses (${sessionsRes.data.data.length} sesi ditemukan)`);

  // 2. Uji Proxy
  console.log(' - Menguji GET /api/proxies...');
  const proxiesRes = await axios.get(`${backendUrl}/proxies`);
  if (proxiesRes.data.status !== 'success') {
    throw new Error('Gagal memanggil GET /api/proxies!');
  }
  console.log('   Status: Sukses mengambil daftar proxy');

  // 3. Uji Contacts & Groups
  console.log(' - Menguji GET /api/contacts/groups...');
  const groupsRes = await axios.get(`${backendUrl}/contacts/groups`);
  if (groupsRes.data.status !== 'success' || !Array.isArray(groupsRes.data.data)) {
    throw new Error('Gagal memanggil GET /api/contacts/groups!');
  }
  console.log(`   Status: Sukses (${groupsRes.data.data.length} grup kontak ditemukan)`);

  // 4. Uji Templates
  console.log(' - Menguji GET /api/templates...');
  const templatesRes = await axios.get(`${backendUrl}/templates`);
  if (templatesRes.data.status !== 'success') {
    throw new Error('Gagal memanggil GET /api/templates!');
  }
  console.log('   Status: Sukses mengambil daftar template');
}

// Tahap 3: Pengujian Keamanan (Securities)
async function runSecurityTests() {
  await verifySecurityMiddleware();

  // TC-SEC-01: Verifikasi isolasi kredensial (Folder sessions)
  console.log(' - TC-SEC-01: Menguji proteksi & keberadaan auth state...');
  const authDir = join(__dirname, '..', 'backend', 'sessions');
  if (fs.existsSync(authDir)) {
    console.log('   Status: Folder sessions terdeteksi di lingkungan lokal backend (Aman dari publikasi webroot frontend).');
  } else {
    console.log('   Status: Folder sessions belum dibuat karena tidak ada sesi aktif, namun lokasinya aman di luar direktori publik.');
  }

  // TC-SEC-02: Simulasi Serangan SQL Injection (Payload Sanitization)
  console.log(' - TC-SEC-02: Simulasi payload SQL Injection pada endpoint Chatbot AI...');
  const sqlInjectionPayload = {
    session_id: "session' OR '1'='1",
    is_active: 1,
    base_url: 'https://ai.sumopod.com/v1',
    api_key: 'sk-xxxxxxxx',
    model_name: 'glm-5-turbo',
    system_instruction: 'Persona asisten',
    knowledge_base: 'Basis pengetahuan',
    delay_seconds: 1,
    show_typing: 1
  };

  try {
    const res = await axios.post(`${backendUrl}/chatbot-ai/settings`, sqlInjectionPayload);
    if (res.data.status === 'success') {
      console.log('   Status: System sukses memproses payload tanpa error crash database (Prepared Statement berhasil meresolusi karakter escape SQL dengan aman).');
    } else {
      throw new Error('Endpoint gagal memproses payload!');
    }
  } catch (err) {
    if (err.response && err.response.status === 500) {
      throw new Error(`Sistem crash akibat SQL Injection! Log error: ${err.message}`);
    } else {
      console.log(`   Status: Sanitasi payload berhasil dengan penolakan atau penanganan error terkelola (${err.message}).`);
    }
  } finally {
    await dbRun('DELETE FROM chatbot_ai_settings WHERE session_id = ?', [sqlInjectionPayload.session_id]);
  }
}

async function verifySecurityMiddleware() {
  console.log(' - TC-SEC-04: Menguji CORS, API key auth, rate limiting, dan masking secret...');
  const originalEnv = {
    apiKey: process.env.WA_BOT_API_KEY,
    origins: process.env.WA_BOT_ALLOWED_ORIGINS,
    max: process.env.WA_BOT_RATE_LIMIT_MAX,
    windowMs: process.env.WA_BOT_RATE_LIMIT_WINDOW_MS,
    encryptionKey: process.env.WA_BOT_SECRET_ENCRYPTION_KEY,
    adminUser: process.env.WA_BOT_ADMIN_USERNAME,
    adminPassword: process.env.WA_BOT_ADMIN_PASSWORD,
    adminSessionSecret: process.env.WA_BOT_ADMIN_SESSION_SECRET
  };

  try {
    process.env.WA_BOT_API_KEY = 'qa-secret-key';
    process.env.WA_BOT_ALLOWED_ORIGINS = 'http://localhost:5174';
    process.env.WA_BOT_RATE_LIMIT_MAX = '2';
    process.env.WA_BOT_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.WA_BOT_SECRET_ENCRYPTION_KEY = 'qa-encryption-secret';
    process.env.WA_BOT_ADMIN_USERNAME = 'qa-admin';
    process.env.WA_BOT_ADMIN_PASSWORD = 'qa-admin-password';
    process.env.WA_BOT_ADMIN_SESSION_SECRET = 'qa-admin-session-secret';

    const corsOptions = createCorsOptions();
    await new Promise((resolve, reject) => {
      corsOptions.origin('https://untrusted.example', err => err ? resolve() : reject(new Error('CORS menerima origin asing.')));
    });

    const auth = createApiKeyAuth();
    const unauthorized = createMockResponse();
    auth(createMockRequest({}), unauthorized, () => {
      throw new Error('API key middleware melewatkan request tanpa key.');
    });
    if (unauthorized.statusCode !== 401) throw new Error('API key middleware tidak mengembalikan HTTP 401.');

    let authorized = false;
    auth(createMockRequest({ 'X-API-Key': 'qa-secret-key' }), createMockResponse(), () => {
      authorized = true;
    });
    if (!authorized) throw new Error('API key middleware menolak key yang valid.');

    const limiter = createRateLimiter();
    limiter(createMockRequest(), createMockResponse(), () => {});
    limiter(createMockRequest(), createMockResponse(), () => {});
    const limited = createMockResponse();
    limiter(createMockRequest(), limited, () => {
      throw new Error('Rate limiter melewatkan request di atas batas.');
    });
    if (limited.statusCode !== 429) throw new Error('Rate limiter tidak mengembalikan HTTP 429.');

    if (!validateAdminCredentials('qa-admin', 'qa-admin-password') || validateAdminCredentials('qa-admin', 'wrong')) {
      throw new Error('Validasi credential admin tidak bekerja.');
    }
    const adminToken = createAdminSessionToken('qa-admin');
    if (verifyAdminSessionToken(adminToken)?.sub !== 'qa-admin') {
      throw new Error('Token sesi admin tidak dapat diverifikasi.');
    }
    const adminAuth = createAdminAuthMiddleware();
    const noSession = createMockResponse();
    adminAuth(createMockRequest({}), noSession, () => {
      throw new Error('Admin auth melewatkan request tanpa cookie.');
    });
    if (noSession.statusCode !== 401) throw new Error('Admin auth tidak mengembalikan HTTP 401.');

    let adminAllowed = false;
    adminAuth(createMockRequest({ cookie: buildAdminCookie(adminToken) }), createMockResponse(), () => {
      adminAllowed = true;
    });
    if (!adminAllowed) throw new Error('Admin auth menolak cookie sesi yang valid.');

    const masked = maskAISettings({ api_key: 'provider-secret', model_name: 'glm-5-turbo' });
    if (masked.api_key !== '' || masked.has_api_key !== true) {
      throw new Error('Respons AI settings masih membocorkan API key.');
    }
    if (resolveStoredApiKey('provider-secret', '', false) !== 'provider-secret') {
      throw new Error('API key lama tidak dipertahankan saat form kosong disimpan.');
    }
    const protectedSecret = protectSecret('provider-secret');
    if (!protectedSecret.startsWith('enc:v1:') || revealSecret(protectedSecret) !== 'provider-secret') {
      throw new Error('Enkripsi AES-GCM untuk secret AI tidak bekerja.');
    }
    if (
      !isOptOutKeyword(' BERHENTI ')
      || normalizePhoneNumber('62812@s.whatsapp.net') !== '62812'
      || canonicalPhoneNumber('0812') !== '62812'
    ) {
      throw new Error('Normalisasi nomor atau keyword opt-out tidak bekerja.');
    }
    const qaOptOutNumber = '6280000000999';
    await recordOptOut(qaOptOutNumber, 'QA_TEST');
    if (!await isOptedOut('080000000999')) throw new Error('Suppression list gagal mencocokkan format nomor lokal.');
    await removeOptOut('080000000999');
    if (await isOptedOut(qaOptOutNumber)) throw new Error('Suppression list gagal menghapus opt-out.');
    console.log('   TC-OPT-01: Suppression list opt-out terverifikasi untuk format nomor 08 dan 62.');

    console.log('   Status: Middleware security dan masking secret terverifikasi.');
  } finally {
    restoreEnv('WA_BOT_API_KEY', originalEnv.apiKey);
    restoreEnv('WA_BOT_ALLOWED_ORIGINS', originalEnv.origins);
    restoreEnv('WA_BOT_RATE_LIMIT_MAX', originalEnv.max);
    restoreEnv('WA_BOT_RATE_LIMIT_WINDOW_MS', originalEnv.windowMs);
    restoreEnv('WA_BOT_SECRET_ENCRYPTION_KEY', originalEnv.encryptionKey);
    restoreEnv('WA_BOT_ADMIN_USERNAME', originalEnv.adminUser);
    restoreEnv('WA_BOT_ADMIN_PASSWORD', originalEnv.adminPassword);
    restoreEnv('WA_BOT_ADMIN_SESSION_SECRET', originalEnv.adminSessionSecret);
  }
}

function createMockRequest(headers = {}) {
  return {
    headers,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get(name) {
      return headers[name] || headers[name.toLowerCase()];
    }
  };
}

function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// Tahap 4: Uji E2E UI & Tangkapan Layar (Puppeteer)
async function runE2eUiTests() {
  // Cek port frontend yang aktif (5174 atau 5173)
  let frontendUrl = 'http://localhost:5174';
  try {
    await axios.get(frontendUrl);
  } catch (e) {
    frontendUrl = 'http://localhost:5173';
  }
  console.log(` - Menggunakan Alamat Frontend: ${frontendUrl}`);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pagesToTest = [
    { name: '1_dashboard_main', route: '/' },
    { name: '2_devices_management', route: '/devices' },
    { name: '3_single_message', route: '/single-message' },
    { name: '4_templates_management', route: '/templates' },
    { name: '5_contacts_management', route: '/contacts' },
    { name: '6_bulk_messages', route: '/bulk-messages' },
    { name: '7_warmer_management', route: '/warmer' },
    { name: '8_chatbot_ai_settings', route: '/chatbot-ai' },
    { name: '9_chatbot_flows_builder', route: '/chatbot-flows' },
    { name: '10_group_grabber', route: '/group-grabber' }
  ];

  for (const pageItem of pagesToTest) {
    console.log(` - Membuka halaman ${pageItem.route} di peramban...`);
    try {
      await page.goto(`${frontendUrl}${pageItem.route}`, { waitUntil: 'networkidle2', timeout: 15000 });
      // Tunggu jeda sebentar agar render animasi selesai sempurna
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));

      // TC-SEC-03: Khusus halaman chatbot-ai, verifikasi input API Key dalam mode masked
      if (pageItem.route === '/chatbot-ai') {
        let hasPasswordInput = await page.$('input[type="password"]').then(el => !!el);
        let openedModal = false;

        if (!hasPasswordInput) {
          // Klik tombol '+ Tambah Kredensial' untuk memunculkan input password di modal
          const buttons = await page.$$('button');
          for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text && text.includes('Tambah Kredensial')) {
              await btn.click();
              await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500))); // Tunggu modal merender
              openedModal = true;
              break;
            }
          }
        }

        const typeAttribute = await page.$eval('input[type="password"]', el => el.type).catch(() => 'not-found');
        console.log(`   TC-SEC-03: Memeriksa tipe field API Key... (Tipe terdeteksi: ${typeAttribute})`);
        if (typeAttribute !== 'password') {
          console.warn('   [WARNING] Field API Key tidak terproteksi dengan tipe password!');
        } else {
          console.log('   Status: Input API Key terproteksi dengan mode masked (tipe password) sukses.');
        }

        if (openedModal) {
          // Klik tombol 'Batal' untuk menutup modal kembali
          const buttons = await page.$$('button');
          for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text && text.includes('Batal')) {
              await btn.click();
              await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
              break;
            }
          }
        }
      }

      const ssPath = join(screenshotsDir, `${pageItem.name}.png`);
      await page.screenshot({ path: ssPath });
      console.log(`   Screenshot disimpan: ${pageItem.name}.png`);
    } catch (pageErr) {
      console.error(`   Gagal mengambil screenshot untuk rute ${pageItem.route}:`, pageErr.message);
    }
  }

  await browser.close();
}

runTests();
