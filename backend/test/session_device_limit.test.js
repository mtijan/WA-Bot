import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbAll, dbGet, dbRun } from '../src/database.js';
import { reserveSessionSlot } from '../src/controllers/session.controller.js';

after(() => cleanupTestDb());

function cookieFrom(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader].filter(Boolean);
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Session device limit', () => {
  it('menolak user non-admin yang sudah mencapai batas device dari admin', async () => {
    const { agent, cookie: adminCookie } = await getAuthenticatedAgent();
    const username = `device_limit_${Date.now()}`;
    const password = 'tenant-password-12345';

    const createUserRes = await agent
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        username,
        password,
        display_name: 'Limited Device User',
        role: 'user'
      });

    assert.equal(createUserRes.status, 201);

    const userId = createUserRes.body.data.id;
    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('limited-user-device-1', 'CONNECTED', ?)",
      [userId]
    );

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ username, password });
    assert.equal(loginRes.status, 200);

    const sessionRes = await agent
      .post('/api/sessions')
      .set('Cookie', cookieFrom(loginRes.headers['set-cookie']))
      .send({ session_id: 'limited-user-device-2' });

    assert.equal(sessionRes.status, 403);
    assert.equal(sessionRes.body.error_code, 'QUOTA_EXCEEDED');
  });

  it('memakai plan.max_sessions sebagai sumber limit meskipun device_limit user lebih tinggi', async () => {
    const planName = `single_device_plan_${Date.now()}`;
    const plan = await dbRun(
      `INSERT INTO subscription_plans (name, max_sessions, max_campaigns_per_month, max_flows, is_default)
       VALUES (?, 1, 10, 10, 0)`,
      [planName]
    );
    const user = await dbRun(
      `INSERT INTO users
        (username, password_hash, display_name, role, is_active, device_limit, plan_id, subscription_status)
       VALUES (?, 'dummy_hash', 'Plan Limited User', 'user', 1, 99, ?, 'active')`,
      [`plan_limit_${Date.now()}`, plan.id]
    );

    await dbRun(
      'INSERT INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
      [`plan-limit-existing-${Date.now()}`, 'CONNECTED', user.id]
    );

    const result = await reserveSessionSlot(`plan-limit-new-${Date.now()}`, {
      userId: user.id,
      role: 'user'
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'QUOTA_EXCEEDED');
  });

  it('menahan race condition saat dua create session paralel memakai kuota terakhir', async () => {
    const planName = `race_device_plan_${Date.now()}`;
    const plan = await dbRun(
      `INSERT INTO subscription_plans (name, max_sessions, max_campaigns_per_month, max_flows, is_default)
       VALUES (?, 1, 10, 10, 0)`,
      [planName]
    );
    const user = await dbRun(
      `INSERT INTO users
        (username, password_hash, display_name, role, is_active, device_limit, plan_id, subscription_status)
       VALUES (?, 'dummy_hash', 'Race Limited User', 'user', 1, 99, ?, 'active')`,
      [`race_limit_${Date.now()}`, plan.id]
    );

    const sessionA = `race-session-a-${Date.now()}`;
    const sessionB = `race-session-b-${Date.now()}`;
    const auth = { userId: user.id, role: 'user' };
    const results = await Promise.all([
      reserveSessionSlot(sessionA, auth),
      reserveSessionSlot(sessionB, auth)
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.code === 'QUOTA_EXCEEDED').length, 1);

    const sessions = await dbAll(
      'SELECT session_id FROM sessions WHERE user_id = ? AND session_id IN (?, ?)',
      [user.id, sessionA, sessionB]
    );
    assert.equal(sessions.length, 1);

    const maxPlan = await dbGet(
      `SELECT p.max_sessions FROM users u
       LEFT JOIN subscription_plans p ON u.plan_id = p.id
       WHERE u.id = ?`,
      [user.id]
    );
    assert.equal(maxPlan.max_sessions, 1);
  });
});
