import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getAuthenticatedAgent } from './helpers/test_app.js';
import { dbGet, dbRun } from '../src/database.js';

async function seedTenant(username, password) {
  const hash = await bcrypt.hash(password, 12);
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    await dbRun(
      `UPDATE users
       SET password_hash = ?, role = 'user', is_active = 1, token_version = 0,
           subscription_status = 'active', subscription_expires_at = ?
       WHERE username = ?`,
      [hash, new Date(Date.now() + 86400000).toISOString(), username]
    );
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [existing.id]);
    return existing.id;
  }

  const result = await dbRun(
    `INSERT INTO users
      (username, password_hash, display_name, role, is_active, subscription_status, subscription_expires_at)
     VALUES (?, ?, ?, 'user', 1, 'active', ?)`,
    [username, hash, username, new Date(Date.now() + 86400000).toISOString()]
  );
  return result.id;
}

async function login(agent, username, password) {
  const res = await agent.post('/api/auth/login').send({ username, password });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('SaaS admin hardening', () => {
  it('menolak akses monitoring API untuk user non-admin', async () => {
    const { agent } = await getAuthenticatedAgent();
    await seedTenant('monitoring_tenant_user', 'monitoring-tenant-12345');
    const cookie = await login(agent, 'monitoring_tenant_user', 'monitoring-tenant-12345');

    const res = await agent
      .get('/api/monitoring/status')
      .set('Cookie', cookie);

    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'FORBIDDEN_ACCESS');
  });

  it('mencatat audit log untuk perubahan plan', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();
    const planName = `Audit Plan ${Date.now()}`;

    const res = await agent
      .post('/api/plans')
      .set('Cookie', cookie)
      .send({
        name: planName,
        max_sessions: 2,
        max_campaigns_per_month: 10,
        max_flows: 5
      });

    assert.equal(res.status, 201);
    const audit = await dbGet(
      `SELECT event_type, target_type, target_id, result, metadata
       FROM audit_logs
       WHERE event_type = 'PLAN_CREATE' AND target_id = ?
       ORDER BY id DESC LIMIT 1`,
      [String(res.body.data.id)]
    );

    assert.ok(audit);
    assert.equal(audit.target_type, 'plan');
    assert.equal(audit.result, 'success');
    assert.equal(JSON.parse(audit.metadata).name, planName);
  });

  it('menolak field billing user yang tidak valid', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();

    const invalidStatus = await agent
      .post('/api/users')
      .set('Cookie', cookie)
      .send({
        username: `invalid_status_${Date.now()}`,
        password: 'invalid-status-12345',
        role: 'user',
        subscription_status: 'free_forever'
      });
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.body.error_code, 'VALIDATION_ERROR');

    const invalidPlan = await agent
      .post('/api/users')
      .set('Cookie', cookie)
      .send({
        username: `invalid_plan_${Date.now()}`,
        password: 'invalid-plan-12345',
        role: 'user',
        plan_id: 999999
      });
    assert.equal(invalidPlan.status, 400);
    assert.equal(invalidPlan.body.error_code, 'INVALID_PLAN');
  });

  it('berhasil menghapus user secara permanen beserta seluruh datanya (cascade)', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();
    
    // Seed target user
    const targetUserId = await seedTenant('delete_cascade_user', 'target-password-12345');
    
    // Seed associated data for this user
    await dbRun("INSERT INTO sessions (session_id, status, user_id) VALUES ('cascade-session', 'CONNECTED', ?)", [targetUserId]);
    await dbRun("INSERT INTO contact_groups (id, name, user_id) VALUES (999, 'cascade-group', ?)", [targetUserId]);
    await dbRun("INSERT INTO message_templates (id, name, content, user_id) VALUES (999, 'cascade-template', 'Hello', ?)", [targetUserId]);
    await dbRun("INSERT INTO campaigns (id, session_id, name, message, user_id) VALUES (999, 'cascade-session', 'cascade-campaign', 'Msg', ?)", [targetUserId]);
    
    // Delete the user
    const res = await agent
      .delete(`/api/users/${targetUserId}`)
      .set('Cookie', cookie);
      
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    
    // Verify user is deleted
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [targetUserId]);
    assert.equal(user, undefined);
    
    // Verify associated records are deleted
    const session = await dbGet("SELECT * FROM sessions WHERE user_id = ?", [targetUserId]);
    assert.equal(session, undefined);
    
    const group = await dbGet("SELECT * FROM contact_groups WHERE user_id = ?", [targetUserId]);
    assert.equal(group, undefined);
    
    const template = await dbGet("SELECT * FROM message_templates WHERE user_id = ?", [targetUserId]);
    assert.equal(template, undefined);
    
    const campaign = await dbGet("SELECT * FROM campaigns WHERE user_id = ?", [targetUserId]);
    assert.equal(campaign, undefined);
  });

  it('isolasi data dashboard stats dan pemantauan target user oleh admin', async () => {
    const { agent, cookie: adminCookie } = await getAuthenticatedAgent();
    const adminId = 1;

    // Clean sessions to ensure exact counts
    await dbRun('DELETE FROM sessions');

    // Seed target user
    const targetUserId = await seedTenant('dashboard_isolate_user', 'target-password-12345');

    // Seed some data for target user
    await dbRun("INSERT INTO sessions (session_id, status, user_id) VALUES ('user-session-test', 'CONNECTED', ?)", [targetUserId]);

    // Seed some data for admin user (ID 1)
    await dbRun("INSERT INTO sessions (session_id, status, user_id) VALUES ('admin-session-test', 'CONNECTED', ?)", [adminId]);

    // 1. Admin gets their own stats by default (without query param)
    const adminOwnRes = await agent
      .get('/api/dashboard/stats')
      .set('Cookie', adminCookie);
    assert.equal(adminOwnRes.status, 200);
    assert.equal(adminOwnRes.body.data.totalSessions, 1);
    assert.equal(adminOwnRes.body.data.activeSessions, 1);

    // 2. Admin gets target user's stats with target_user_id param
    const adminMonitorRes = await agent
      .get(`/api/dashboard/stats?target_user_id=${targetUserId}`)
      .set('Cookie', adminCookie);
    assert.equal(adminMonitorRes.status, 200);
    assert.equal(adminMonitorRes.body.data.totalSessions, 1);
    assert.equal(adminMonitorRes.body.data.activeSessions, 1);

    // 3. Target user gets their own stats by default
    const userCookie = await login(agent, 'dashboard_isolate_user', 'target-password-12345');
    const userOwnRes = await agent
      .get('/api/dashboard/stats')
      .set('Cookie', userCookie);
    assert.equal(userOwnRes.status, 200);
    assert.equal(userOwnRes.body.data.totalSessions, 1);
    assert.equal(userOwnRes.body.data.activeSessions, 1);

    // 4. Target user tries to get admin's stats by passing target_user_id=1, should be ignored and show user's own stats
    const userLeakRes = await agent
      .get(`/api/dashboard/stats?target_user_id=${adminId}`)
      .set('Cookie', userCookie);
    assert.equal(userLeakRes.status, 200);
    assert.equal(userLeakRes.body.data.totalSessions, 1);
  });
});

