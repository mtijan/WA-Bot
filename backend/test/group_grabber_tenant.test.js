import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbGet, dbRun } from '../src/database.js';
import whatsappService from '../src/services/whatsapp.service.js';

after(() => cleanupTestDb());

function cookieFrom(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader].filter(Boolean);
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function createTenantUser(agent, adminCookie) {
  const username = `tenant_${Date.now()}`;
  const password = 'tenant-password-12345';

  const createRes = await agent
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({
      username,
      password,
      display_name: 'Tenant User',
      role: 'user'
    });

  assert.equal(createRes.status, 201);

  const loginRes = await agent
    .post('/api/auth/login')
    .send({ username, password });

  assert.equal(loginRes.status, 200);

  return {
    userId: createRes.body.data.id,
    cookie: cookieFrom(loginRes.headers['set-cookie'])
  };
}

describe('Group Grabber tenant isolation', () => {
  it('menolak non-admin yang mencoba memakai session milik tenant lain', async () => {
    const { agent, cookie: adminCookie } = await getAuthenticatedAgent();
    const tenant = await createTenantUser(agent, adminCookie);

    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('admin-session-grabber', 'CONNECTED', 1)"
    );
    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('tenant-session-grabber', 'CONNECTED', ?)",
      [tenant.userId]
    );

    const groupsRes = await agent
      .get('/api/group-grabber/groups/admin-session-grabber')
      .set('Cookie', tenant.cookie);
    assert.equal(groupsRes.status, 403);

    const inviteRes = await agent
      .post('/api/group-grabber/invite-link')
      .set('Cookie', tenant.cookie)
      .send({ sessionId: 'admin-session-grabber', groupId: 'group-1@g.us' });
    assert.equal(inviteRes.status, 403);

    const syncRes = await agent
      .post('/api/group-grabber/force-sync-contacts')
      .set('Cookie', tenant.cookie)
      .send({ sessionId: 'admin-session-grabber' });
    assert.equal(syncRes.status, 403);

    const exportRes = await agent
      .post('/api/group-grabber/export-participants')
      .set('Cookie', tenant.cookie)
      .send({ sessionId: 'admin-session-grabber', groupIds: ['group-1@g.us'] });
    assert.equal(exportRes.status, 403);
  });

  it('mengekspor nama kontak hanya dari tenant pemilik session', async () => {
    const { agent, cookie: adminCookie } = await getAuthenticatedAgent();
    const tenant = await createTenantUser(agent, adminCookie);

    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('tenant-export-session', 'CONNECTED', ?)",
      [tenant.userId]
    );
    await dbRun(
      "INSERT INTO contact_groups (id, name, user_id) VALUES (3101, 'Admin Contacts', 1)"
    );
    await dbRun(
      "INSERT INTO contact_groups (id, name, user_id) VALUES (3102, 'Tenant Contacts', ?)",
      [tenant.userId]
    );
    await dbRun(
      "INSERT INTO contacts (group_id, name, phone_number) VALUES (3101, 'Admin Secret Name', '628123456789')"
    );
    await dbRun(
      "INSERT INTO contacts (group_id, name, phone_number) VALUES (3102, 'Tenant Visible Name', '628123456789')"
    );

    const originalSocket = whatsappService.sockets['tenant-export-session'];
    whatsappService.sockets['tenant-export-session'] = {
      authState: { creds: { me: { id: '628000@s.whatsapp.net' } } },
      user: { id: '628000@s.whatsapp.net' },
      contacts: {},
      groupMetadata: async () => ({
        id: 'group-tenant@g.us',
        subject: 'Tenant Group',
        participants: [{ id: '628123456789@s.whatsapp.net' }]
      }),
      onWhatsApp: async () => [],
      getBusinessProfile: async () => null
    };

    try {
      const exportRes = await agent
        .post('/api/group-grabber/export-participants')
        .set('Cookie', tenant.cookie)
        .send({
          sessionId: 'tenant-export-session',
          groupIds: ['group-tenant@g.us'],
          format: 'json'
        });

      assert.equal(exportRes.status, 200);
      const exported = JSON.parse(exportRes.text);
      assert.equal(exported[0].savedName, 'Tenant Visible Name');
      assert.equal(exported[0].myContact, 'TRUE');
      assert.ok(!exportRes.text.includes('Admin Secret Name'));
    } finally {
      if (originalSocket) {
        whatsappService.sockets['tenant-export-session'] = originalSocket;
      } else {
        delete whatsappService.sockets['tenant-export-session'];
      }
    }

    const tenantSession = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', ['tenant-export-session']);
    assert.equal(tenantSession.user_id, tenant.userId);
  });
});
