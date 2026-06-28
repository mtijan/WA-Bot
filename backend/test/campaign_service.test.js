import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('Campaign tenant isolation', () => {
  it('mengambil nama kontak personalisasi hanya dari tenant pemilik sesi', async () => {
    await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const { default: campaignService } = await import('../src/services/campaign.service.js');
    const { default: whatsappService } = await import('../src/services/whatsapp.service.js');

    await dbRun(
      "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, is_active) VALUES (2, 'tenant2', 'dummy_hash', 'Tenant 2', 'user', 1)"
    );
    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('tenant1-session', 'CONNECTED', 1)"
    );
    await dbRun(
      "INSERT INTO contact_groups (id, name, user_id) VALUES (201, 'Tenant 2 Contacts', 2)"
    );
    await dbRun(
      "INSERT INTO contacts (group_id, name, phone_number) VALUES (201, 'Bob Other Tenant', '628111')"
    );
    await dbRun(
      "INSERT INTO contact_groups (id, name, user_id) VALUES (101, 'Tenant 1 Contacts', 1)"
    );
    await dbRun(
      "INSERT INTO contacts (group_id, name, phone_number) VALUES (101, 'Alice Own Tenant', '628111')"
    );
    await dbRun(
      "INSERT INTO campaigns (id, session_id, name, message, status, user_id) VALUES (501, 'tenant1-session', 'Tenant Check', '{{name}} hi', 'PENDING', 1)"
    );
    await dbRun(
      "INSERT INTO delivery_logs (campaign_id, target_number, status, user_id) VALUES (501, '628111', 'PENDING', 1)"
    );

    const originalGetSessionStatus = whatsappService.getSessionStatus;
    const originalSendMessage = whatsappService.sendMessage;
    let sentText = '';

    try {
      whatsappService.getSessionStatus = async () => ({ status: 'CONNECTED' });
      whatsappService.sendMessage = async (_sessionId, _target, text) => {
        sentText = text;
      };

      await campaignService.processCampaign(501, 0, 0);

      const log = await dbGet('SELECT status FROM delivery_logs WHERE campaign_id = 501');
      assert.equal(log.status, 'SENT');
      assert.equal(sentText, 'Alice Own Tenant hi');
    } finally {
      whatsappService.getSessionStatus = originalGetSessionStatus;
      whatsappService.sendMessage = originalSendMessage;
    }
  });
});
