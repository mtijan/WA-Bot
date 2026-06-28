import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, getAuthenticatedAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('GET /api/auth/me', () => {
  it('mengembalikan status autentikasi tanpa login', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/auth/me');

    // Endpoint auth/me berada sebelum middleware admin auth, jadi selalu bisa diakses
    assert.equal(res.status, 200);
    assert.ok(res.body !== undefined);
  });
});

describe('POST /api/auth/login', () => {
  it('mengembalikan error untuk kredensial kosong ketika auth aktif', async () => {
    // Aktifkan auth sementara
    const origPassword = process.env.WA_BOT_ADMIN_PASSWORD;
    process.env.WA_BOT_ADMIN_PASSWORD = 'test-password-for-auth';

    const { agent } = await getAuthenticatedAgent();
    const res = await agent
      .post('/api/auth/login')
      .send({ username: '', password: '' });

    assert.ok([400, 401].includes(res.status), `Expected 400 or 401, got ${res.status}`);
    assert.equal(res.body.status, 'error');

    process.env.WA_BOT_ADMIN_PASSWORD = origPassword;
  });

  it('mengembalikan error untuk password salah ketika auth aktif', async () => {
    const origPassword = process.env.WA_BOT_ADMIN_PASSWORD;
    process.env.WA_BOT_ADMIN_PASSWORD = 'test-password-for-auth';

    const { agent } = await getAuthenticatedAgent();
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });

    assert.equal(res.status, 401);
    assert.equal(res.body.status, 'error');

    process.env.WA_BOT_ADMIN_PASSWORD = origPassword;
  });

  it('mengembalikan cookie sesi untuk kredensial benar', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();

    assert.ok(cookie, 'Cookie sesi harus dikembalikan setelah login berhasil');
    assert.ok(cookie.includes('wa_bot_access'), 'Cookie harus mengandung nama wa_bot_access');
  });
});

describe('POST /api/auth/logout', () => {
  it('menghapus cookie sesi', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();
    const res = await agent
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const clearCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.ok(clearCookie.includes('Max-Age=0'), 'Cookie harus dihapus dengan Max-Age=0');
    }
  });
});

describe('Refresh token hardening', () => {
  it('merotasi refresh token dan menolak refresh token lama', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();

    const refreshRes = await agent
      .post('/api/auth/refresh')
      .set('Cookie', cookie);

    assert.equal(refreshRes.status, 200);
    const rotatedCookie = refreshRes.headers['set-cookie'];
    assert.ok(String(rotatedCookie).includes('wa_bot_refresh'), 'Refresh harus mengirim cookie refresh baru');

    const oldRefreshRes = await agent
      .post('/api/auth/refresh')
      .set('Cookie', cookie);

    assert.equal(oldRefreshRes.status, 401);
  });

  it('mencabut sesi aktif setelah password akun sendiri diubah', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();

    const changeRes = await agent
      .patch('/api/users/1/password')
      .set('Cookie', cookie)
      .send({
        old_password: 'test-admin-password-12345',
        new_password: 'test-admin-password-67890'
      });

    assert.equal(changeRes.status, 200);

    const protectedRes = await agent
      .get('/api/templates')
      .set('Cookie', cookie);

    assert.equal(protectedRes.status, 401);
  });
});
