import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createSecurityHeaders, createCorsOptions, createRateLimiter } from '../src/middleware/security.middleware.js';

// Helper sederhana untuk melakukan test request terhadap aplikasi Express tiruan
async function fetchMockApp(app, path, headers = {}) {
  // Jalankan server pada port acak (port ephemeral)
  const server = app.listen(0);
  const { port } = server.address();
  
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    
    return {
      status: response.status,
      headers: response.headers,
      text,
      json
    };
  } finally {
    server.close();
  }
}

test('Security Middleware - Security Headers', async () => {
  const app = express();
  app.use(createSecurityHeaders());
  app.get('/test-headers', (req, res) => {
    res.send('ok');
  });

  const res = await fetchMockApp(app, '/test-headers');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('x-xss-protection'), '0');
  assert.ok(res.headers.get('content-security-policy'));
});

test('Security Middleware - Rate Limiting', async () => {
  const app = express();
  
  // Set limit sangat rendah khusus pengujian (misal maksimal 2 request)
  process.env.WA_BOT_RATE_LIMIT_MAX = '2';
  process.env.WA_BOT_RATE_LIMIT_WINDOW_MS = '10000'; // 10 detik

  app.use(createRateLimiter());
  app.get('/test-limit', (req, res) => {
    res.send('ok');
  });

  // Request 1: OK
  const res1 = await fetchMockApp(app, '/test-limit');
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res1.headers.get('ratelimit-remaining'), '1');

  // Request 2: OK
  const res2 = await fetchMockApp(app, '/test-limit');
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.headers.get('ratelimit-remaining'), '0');

  // Request 3: Terblokir (429)
  const res3 = await fetchMockApp(app, '/test-limit');
  assert.strictEqual(res3.status, 429);
  assert.strictEqual(res3.json?.status, 'error');
  assert.strictEqual(res3.json?.error_code, 'RATE_LIMIT_EXCEEDED');

  // Kembalikan environment variable ke semula
  delete process.env.WA_BOT_RATE_LIMIT_MAX;
  delete process.env.WA_BOT_RATE_LIMIT_WINDOW_MS;
});
