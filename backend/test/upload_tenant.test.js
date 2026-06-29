import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getAuthenticatedAgent } from './helpers/test_app.js';
import { dbGet, dbRun } from '../src/database.js';
import { deleteFileIfExists, resolveMediaFilePath } from '../src/services/upload.service.js';

const uploadedFiles = [];

async function seedUser(username, password, role = 'user') {
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  const hash = await bcrypt.hash(password, 12);

  if (existing) {
    await dbRun(
      `UPDATE users
       SET password_hash = ?, role = ?, is_active = 1, token_version = 0
       WHERE username = ?`,
      [hash, role, username]
    );
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [existing.id]);
    return existing.id;
  }

  const result = await dbRun(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, device_limit)
     VALUES (?, ?, ?, ?, 1, 1)`,
    [username, hash, username, role]
  );
  return result.id;
}

async function login(agent, username, password) {
  const res = await agent
    .post('/api/auth/login')
    .send({ username, password });

  assert.equal(res.status, 200);
  return res.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
}

after(() => {
  for (const filename of uploadedFiles) {
    deleteFileIfExists(resolveMediaFilePath(filename));
  }
});

describe('Uploaded media tenant isolation', () => {
  it('membatasi akses download media ke pemilik atau admin', async () => {
    const { agent, cookie: adminCookie } = await getAuthenticatedAgent();
    await seedUser('tenant_upload_a', 'tenant-upload-a-12345');
    await seedUser('tenant_upload_b', 'tenant-upload-b-12345');

    const tenantACookie = await login(agent, 'tenant_upload_a', 'tenant-upload-a-12345');
    const tenantBCookie = await login(agent, 'tenant_upload_b', 'tenant-upload-b-12345');

    const uploadRes = await agent
      .post('/api/uploads/media')
      .set('Cookie', tenantACookie)
      .attach('media', Buffer.from('hello tenant media'), {
        filename: 'tenant-note.txt',
        contentType: 'text/plain'
      });

    assert.equal(uploadRes.status, 200);
    const filename = uploadRes.body.data.stored_name;
    uploadedFiles.push(filename);

    const ownerRes = await agent
      .get(`/api/uploads/media/${encodeURIComponent(filename)}`)
      .set('Cookie', tenantACookie);
    assert.equal(ownerRes.status, 200);
    assert.equal(ownerRes.text, 'hello tenant media');

    const otherTenantRes = await agent
      .get(`/api/uploads/media/${encodeURIComponent(filename)}`)
      .set('Cookie', tenantBCookie);
    assert.equal(otherTenantRes.status, 403);

    const adminRes = await agent
      .get(`/api/uploads/media/${encodeURIComponent(filename)}`)
      .set('Cookie', adminCookie);
    assert.equal(adminRes.status, 403);
  });
});
