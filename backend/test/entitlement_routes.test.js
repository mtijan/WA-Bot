import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getAuthenticatedAgent } from './helpers/test_app.js';
import { dbGet, dbRun } from '../src/database.js';

async function seedPlan(name, maxFlows = 1) {
  const existing = await dbGet('SELECT id FROM subscription_plans WHERE name = ?', [name]);
  if (existing) return existing.id;

  const result = await dbRun(
    `INSERT INTO subscription_plans (name, max_sessions, max_campaigns_per_month, max_flows, is_default)
     VALUES (?, 1, 1, ?, 0)`,
    [name, maxFlows]
  );
  return result.id;
}

async function seedUser(username, password, overrides = {}) {
  const hash = await bcrypt.hash(password, 12);
  const planId = overrides.planId || await seedPlan(`${username}_plan`, overrides.maxFlows || 1);
  const status = overrides.subscriptionStatus || 'active';
  const expiresAt = overrides.subscriptionExpiresAt ?? new Date(Date.now() + 86400000).toISOString();
  const role = overrides.role || 'user';
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);

  if (existing) {
    await dbRun(
      `UPDATE users
       SET password_hash = ?, role = ?, is_active = 1, token_version = 0,
           plan_id = ?, subscription_status = ?, subscription_expires_at = ?
       WHERE username = ?`,
      [hash, role, planId, status, expiresAt, username]
    );
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [existing.id]);
    return existing.id;
  }

  const result = await dbRun(
    `INSERT INTO users
      (username, password_hash, display_name, role, is_active, device_limit, plan_id, subscription_status, subscription_expires_at)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
    [username, hash, username, role, planId, status, expiresAt]
  );
  return result.id;
}

async function login(agent, username, password) {
  const res = await agent.post('/api/auth/login').send({ username, password });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('SaaS entitlement route enforcement', () => {
  it('menolak upload media dan single message untuk user tanpa subscription aktif', async () => {
    const { agent } = await getAuthenticatedAgent();
    await seedUser('expired_ops_user', 'expired-ops-user-12345', {
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date(Date.now() - 86400000).toISOString()
    });
    const cookie = await login(agent, 'expired_ops_user', 'expired-ops-user-12345');

    const uploadRes = await agent
      .post('/api/uploads/media')
      .set('Cookie', cookie)
      .attach('media', Buffer.from('blocked'), {
        filename: 'blocked.txt',
        contentType: 'text/plain'
      });
    assert.equal(uploadRes.status, 403);
    assert.equal(uploadRes.body.error_code, 'PAYMENT_REQUIRED');

    const sendRes = await agent
      .post('/api/single-message/send')
      .set('Cookie', cookie)
      .send({ sessionId: 'any-session', target: '6281111111111', message: 'halo' });
    assert.equal(sendRes.status, 403);
    assert.equal(sendRes.body.error_code, 'PAYMENT_REQUIRED');
  });

  it('menolak import chatbot flow yang melebihi quota paket', async () => {
    const { agent } = await getAuthenticatedAgent();
    const planId = await seedPlan('single_flow_plan', 1);
    const userId = await seedUser('flow_quota_user', 'flow-quota-user-12345', { planId });
    const cookie = await login(agent, 'flow_quota_user', 'flow-quota-user-12345');

    await dbRun(
      `INSERT INTO chatbot_flows
        (flow_name, keywords, nodes, status, session_ids, target_type, match_type, user_id)
       VALUES ('Existing quota flow', 'hello', '[]', 'ACTIVE', '[]', 'ALL', 'CONTAINS', ?)`,
      [userId]
    );

    const importRes = await agent
      .post('/api/chatbot-flows/import')
      .set('Cookie', cookie)
      .send({
        flows: [{
          name: 'Imported flow',
          trigger_keywords: 'imported',
          nodes: []
        }]
      });

    assert.equal(importRes.status, 403);
    assert.equal(importRes.body.error_code, 'QUOTA_EXCEEDED');
  });
});
