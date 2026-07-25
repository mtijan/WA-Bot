import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getAuthenticatedAgent } from './helpers/test_app.js';
import { dbAll, dbGet, dbRun } from '../src/database.js';
import { sanitizeLogContext } from '../src/logger.js';
import { protectSecret } from '../src/services/secret.service.js';
import { encryptSessionFile } from '../src/utils/encrypted_auth_state.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch, isPrivateOrReservedIp } from '../src/utils/outbound_url.js';

async function seedTenant(username, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    await dbRun(
      `UPDATE users
       SET password_hash = ?, role = 'user', is_active = 1, token_version = 0,
           subscription_status = 'active', subscription_expires_at = ?
       WHERE id = ?`,
      [passwordHash, new Date(Date.now() + 86400000).toISOString(), existing.id]
    );
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [existing.id]);
    return existing.id;
  }

  const result = await dbRun(
    `INSERT INTO users
      (username, password_hash, display_name, role, is_active, subscription_status, subscription_expires_at)
     VALUES (?, ?, ?, 'user', 1, 'active', ?)`,
    [username, passwordHash, username, new Date(Date.now() + 86400000).toISOString()]
  );
  return result.id;
}

async function login(agent, username, password) {
  const response = await agent.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200);
  return response.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('High security hardening', () => {
  it('menolak literal IP privat/reserved dan hostname yang resolve ke jaringan privat', async () => {
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('10.0.0.4'), true);
    assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);

    await assert.rejects(
      assertSafeOutboundUrl('https://127.0.0.1/v1'),
      (error) => error.code === 'UNSAFE_OUTBOUND_URL'
    );
    await assert.rejects(
      assertSafeOutboundUrl('https://api.example.test/v1', {
        lookup: async () => [{ address: '10.10.0.5', family: 4 }]
      }),
      (error) => error.code === 'UNSAFE_OUTBOUND_URL'
    );

    const safeUrl = await assertSafeOutboundUrl('https://api.example.test/v1/', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }]
    });
    assert.equal(safeUrl, 'https://api.example.test/v1');

    const safeFetch = createSafeOutboundFetch({
      lookup: async () => [{ address: '192.168.1.10', family: 4 }]
    });
    await assert.rejects(
      safeFetch('https://rebinding.example.test/v1'),
      (error) => error.code === 'UNSAFE_OUTBOUND_URL'
    );
  });

  it('menolak Base URL AI privat pada endpoint kredensial', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();
    const response = await agent
      .post('/api/chatbot-ai/credentials')
      .set('Cookie', cookie)
      .send({
        name: 'unsafe-local-provider',
        base_url: 'https://127.0.0.1/v1',
        api_key: 'must-not-be-stored'
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.error_code, 'UNSAFE_OUTBOUND_URL');
  });

  it('mengisolasi synced WhatsApp contacts per tenant termasuk JID yang sama', async () => {
    await getAuthenticatedAgent();
    const tenantA = await seedTenant('wa_contact_tenant_a', 'wa-contact-a-12345');
    const tenantB = await seedTenant('wa_contact_tenant_b', 'wa-contact-b-12345');
    const jid = '628111111111@s.whatsapp.net';

    await dbRun(
      `INSERT INTO whatsapp_contacts (user_id, jid, name) VALUES (?, ?, ?)
       ON CONFLICT(user_id, jid) DO UPDATE SET name = excluded.name`,
      [tenantA, jid, 'Tenant A Name']
    );
    await dbRun(
      `INSERT INTO whatsapp_contacts (user_id, jid, name) VALUES (?, ?, ?)
       ON CONFLICT(user_id, jid) DO UPDATE SET name = excluded.name`,
      [tenantB, jid, 'Tenant B Name']
    );

    const rows = await dbAll(
      'SELECT user_id, name FROM whatsapp_contacts WHERE jid = ? ORDER BY user_id',
      [jid]
    );
    assert.deepEqual(rows, [
      { user_id: tenantA, name: 'Tenant A Name' },
      { user_id: tenantB, name: 'Tenant B Name' }
    ].sort((a, b) => a.user_id - b.user_id));
  });

  it('menolak template tenant lain sebelum jalur pengiriman WhatsApp dijalankan', async () => {
    const { agent } = await getAuthenticatedAgent();
    const tenantA = await seedTenant('template_owner_a', 'template-owner-a-12345');
    const tenantB = await seedTenant('template_sender_b', 'template-sender-b-12345');
    const tenantBCookie = await login(agent, 'template_sender_b', 'template-sender-b-12345');
    const suffix = Date.now();
    const sessionId = `template-tenant-b-${suffix}`;

    const template = await dbRun(
      'INSERT INTO message_templates (name, content, user_id) VALUES (?, ?, ?)',
      [`foreign-template-${suffix}`, 'Private tenant message', tenantA]
    );
    await dbRun(
      'INSERT INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
      [sessionId, 'CONNECTED', tenantB]
    );

    const response = await agent
      .post('/api/single-message/send')
      .set('Cookie', tenantBCookie)
      .send({
        sessionId,
        target: '628123456789',
        messageType: 'template',
        templateId: template.id
      });

    assert.equal(response.status, 403);
    assert.equal(response.body.error_code, 'FORBIDDEN_ACCESS');
  });

  it('tidak menyimpan nilai body atau secret mentah pada konteks log', () => {
    const sanitized = sanitizeLogContext({
      body: { api_key: 'sk-secret', message: 'customer private message' },
      authorization: 'Bearer token-value',
      senderId: '628123456789@s.whatsapp.net',
      params: { id: '42' }
    });
    const serialized = JSON.stringify(sanitized);

    assert.equal(serialized.includes('sk-secret'), false);
    assert.equal(serialized.includes('customer private message'), false);
    assert.equal(serialized.includes('token-value'), false);
    assert.equal(serialized.includes('628123456789'), false);
    assert.equal(sanitized.authorization, '[REDACTED]');
  });

  it('gagal tertutup ketika kunci enkripsi wajib tidak tersedia', () => {
    const previous = process.env.WA_BOT_SECRET_ENCRYPTION_KEY;
    delete process.env.WA_BOT_SECRET_ENCRYPTION_KEY;
    try {
      assert.throws(
        () => protectSecret('provider-secret'),
        /WA_BOT_SECRET_ENCRYPTION_KEY/
      );
      assert.throws(
        () => encryptSessionFile('session-secret'),
        (error) => error.code === 'SESSION_ENCRYPTION_KEY_NOT_CONFIGURED'
      );
    } finally {
      process.env.WA_BOT_SECRET_ENCRYPTION_KEY = previous;
    }
  });
});
