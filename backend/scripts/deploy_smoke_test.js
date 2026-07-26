import '../src/env.js';
import { config } from '../src/config.js';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const frontendUrl = process.env.WA_BOT_FRONTEND_URL || 'http://localhost:5173';
const apiUrl = process.env.WA_BOT_API_URL || 'http://localhost:3001/api';
const internalUrl = process.env.WA_BOT_INTERNAL_URL || 'http://localhost:3002/internal';
const internalToken = process.env.WA_BOT_INTERNAL_TOKEN || config.internal.token || '';

// Health checks are registered at the root level of the host, not under /api
const apiBaseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

let failed = false;

async function runCheck(name, fn) {
  console.log(`${CYAN}[SMOKE TEST] Menjalankan: ${name}...${RESET}`);
  try {
    const passed = await fn();
    if (passed) {
      console.log(`${GREEN}[SUCCESS] Lolos: ${name}${RESET}\n`);
    } else {
      console.log(`${RED}[FAIL] Gagal: ${name}${RESET}\n`);
      failed = true;
    }
  } catch (err) {
    console.log(`${RED}[ERROR] Pengecualian pada ${name}: ${err.message}${RESET}\n`);
    failed = true;
  }
}

async function start() {
  console.log('==================================================');
  console.log('MEMULAI SMOKE TEST DEPLOY OTOMATIS');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`Public API URL: ${apiUrl}`);
  console.log(`Internal URL: ${internalUrl}`);
  console.log(`Internal Token Terkonfigurasi: ${internalToken ? 'Ya' : 'Tidak'}`);
  console.log('==================================================\n');

  // 1. Periksa Frontend Static Server
  await runCheck('Frontend Static Page', async () => {
    const res = await fetch(frontendUrl);
    if (!res.ok) {
      console.log(`Status respon: ${res.status}`);
      return false;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.log(`Ekspektasi content-type text/html, menerima: ${contentType}`);
      return false;
    }
    const text = await res.text();
    if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
      console.log('Isi respon tidak menyerupai berkas HTML');
      return false;
    }
    return true;
  });

  // 2. Periksa Public API Health
  await runCheck('Public API Health (/health)', async () => {
    const res = await fetch(`${apiBaseUrl}/health`);
    if (!res.ok) {
      console.log(`Status respon: ${res.status}`);
      return false;
    }
    const json = await res.json();
    if (json.status !== 'healthy') {
      console.log(`Ekspektasi status "healthy", menerima: ${JSON.stringify(json)}`);
      return false;
    }
    return true;
  });

  // 3. Periksa Public API Readiness
  await runCheck('Public API Readiness (/health/ready)', async () => {
    const res = await fetch(`${apiBaseUrl}/health/ready`);
    const json = await res.json();
    console.log(`Status respon readiness: ${res.status}`);
    console.log(`Detail readiness: ${JSON.stringify(json)}`);
    if (!json.status) {
      console.log('JSON respon tidak memiliki field "status"');
      return false;
    }
    return true;
  });

  // 4. Periksa Internal Health Live
  await runCheck('Internal Health Live (/health/live)', async () => {
    const res = await fetch(`${internalUrl}/health/live`);
    if (!res.ok) {
      console.log(`Status respon: ${res.status}`);
      return false;
    }
    const json = await res.json();
    if (json.status !== 'alive') {
      console.log(`Ekspektasi status "alive", menerima: ${JSON.stringify(json)}`);
      return false;
    }
    return true;
  });

  // 5. Periksa Internal Health Ready
  await runCheck('Internal Health Ready (/health/ready)', async () => {
    const res = await fetch(`${internalUrl}/health/ready`);
    const json = await res.json();
    console.log(`Status respon internal readiness: ${res.status}`);
    console.log(`Detail internal readiness: ${JSON.stringify(json)}`);
    if (!json.status) {
      console.log('JSON respon tidak memiliki field "status"');
      return false;
    }
    return true;
  });

  // 6. Periksa Internal Authenticated Session Check (jika token terkonfigurasi)
  if (internalToken) {
    await runCheck('Internal Sessions List (Authenticated)', async () => {
      const res = await fetch(`${internalUrl}/sessions`, {
        headers: {
          'X-Internal-Token': internalToken
        }
      });
      if (!res.ok) {
        console.log(`Status respon: ${res.status}`);
        const bodyText = await res.text();
        console.log(`Respon galat: ${bodyText}`);
        return false;
      }
      const json = await res.json();
      if (json.status !== 'success' || !Array.isArray(json.data)) {
        console.log(`Format respon tidak sesuai: ${JSON.stringify(json)}`);
        return false;
      }
      console.log(`Total session manager terhubung: ${json.data.length}`);
      return true;
    });
  } else {
    console.log(`${YELLOW}[WARN] Lewati: Internal Sessions List (Authenticated) - Token internal tidak disetel${RESET}\n`);
  }

  console.log('==================================================');
  if (failed) {
    console.log(`${RED}SMOKE TEST DEPLOY GAGAL${RESET}`);
    console.log('==================================================');
    process.exit(1);
  } else {
    console.log(`${GREEN}SMOKE TEST DEPLOY BERHASIL DENGAN SUKSES${RESET}`);
    console.log('==================================================');
    process.exit(0);
  }
}

start();
