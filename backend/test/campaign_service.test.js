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
        return { messageId: 'campaign-501-message', remoteJid: '628111@s.whatsapp.net' };
      };

      await campaignService.processCampaign(501, 0, 0);

      const log = await dbGet('SELECT status, message_id, remote_jid, ack_status FROM delivery_logs WHERE campaign_id = 501');
      assert.equal(log.status, 'SENT');
      assert.equal(log.message_id, 'campaign-501-message');
      assert.equal(log.remote_jid, '628111@s.whatsapp.net');
      assert.equal(log.ack_status, 'SERVER_ACK');
      assert.equal(sentText, 'Alice Own Tenant hi');
    } finally {
      whatsappService.getSessionStatus = originalGetSessionStatus;
      whatsappService.sendMessage = originalSendMessage;
    }
  });

  it('merender named custom variables dari snapshot delivery log', async () => {
    await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const { default: campaignService } = await import('../src/services/campaign.service.js');
    const { default: whatsappService } = await import('../src/services/whatsapp.service.js');

    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('variables-session', 'CONNECTED', 1)"
    );
    await dbRun(
      `INSERT INTO campaigns (id, session_id, name, message, status, user_id)
       VALUES (502, 'variables-session', 'Variable Check',
         'Halo {{Nama}}, NIM {{NIM}}, tagihan {{Jumlah}} ke {{No Rek}} sebelum {{Jatuh Tempo}}.',
         'PENDING', 1)`
    );
    await dbRun(
      `INSERT INTO delivery_logs
        (campaign_id, target_number, status, user_id, recipient_variables)
       VALUES (502, '628222', 'PENDING', 1, ?)`,
      [JSON.stringify({
        Nama: 'Alya',
        NIM: '2026001',
        Jumlah: '150000',
        'No Rek': '123456789',
        'Jatuh Tempo': '31/07/2026'
      })]
    );

    const originalGetSessionStatus = whatsappService.getSessionStatus;
    const originalSendMessage = whatsappService.sendMessage;
    let sentText = '';

    try {
      whatsappService.getSessionStatus = async () => ({ status: 'CONNECTED' });
      whatsappService.sendMessage = async (_sessionId, _target, text) => {
        sentText = text;
        return { messageId: 'campaign-502-message', remoteJid: '628222@s.whatsapp.net' };
      };

      await campaignService.processCampaign(502, 0, 0);

      const log = await dbGet(
        'SELECT status, rendered_message FROM delivery_logs WHERE campaign_id = 502'
      );
      assert.equal(log.status, 'SENT');
      assert.equal(
        sentText,
        'Halo Alya, NIM 2026001, tagihan 150000 ke 123456789 sebelum 31/07/2026.'
      );
      assert.equal(log.rendered_message, sentText);
    } finally {
      whatsappService.getSessionStatus = originalGetSessionStatus;
      whatsappService.sendMessage = originalSendMessage;
    }
  });

  it('mengambil snapshot variable hanya dari contact_id milik tenant sesi', async () => {
    await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const { default: campaignService } = await import('../src/services/campaign.service.js');
    const { config } = await import('../src/config.js');

    await dbRun(
      "INSERT INTO sessions (session_id, status, user_id) VALUES ('snapshot-session', 'CONNECTED', 1)"
    );
    const groupResult = await dbRun(
      "INSERT INTO contact_groups (name, user_id) VALUES ('Snapshot Group', 1)"
    );
    const contactResult = await dbRun(
      `INSERT INTO contacts
        (group_id, name, phone_number, status, custom_fields)
       VALUES (?, 'Dimas', '081333444555', 'VERIFIED', ?)`,
      [groupResult.id, JSON.stringify({ NIM: '2026123', Jumlah: '200000' })]
    );

    const originalRole = config.runtime.role;
    config.runtime.role = 'api';
    try {
      const result = await campaignService.createCampaign(
        'snapshot-session',
        'Halo {{Nama}} {{NIM}} {{Jumlah}}',
        [{ contact_id: contactResult.id }],
        0,
        0,
        'Snapshot Campaign'
      );
      assert.equal(result.totalTargets, 1);

      const log = await dbGet(
        'SELECT target_number, recipient_variables FROM delivery_logs WHERE campaign_id = ?',
        [result.campaignId]
      );
      assert.equal(log.target_number, '6281333444555');
      assert.deepEqual(JSON.parse(log.recipient_variables), {
        Nama: 'Dimas',
        'Phone Number': '081333444555',
        Email: '',
        Company: '',
        Position: '',
        Tags: '',
        Notes: '',
        NIM: '2026123',
        Jumlah: '200000'
      });

      await dbRun(
        "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, is_active) VALUES (3, 'tenant3', 'dummy_hash', 'Tenant 3', 'user', 1)"
      );
      const otherGroup = await dbRun(
        "INSERT INTO contact_groups (name, user_id) VALUES ('Other Tenant Group', 3)"
      );
      const otherContact = await dbRun(
        `INSERT INTO contacts (group_id, name, phone_number, status, custom_fields)
         VALUES (?, 'Other Tenant', '628999111222', 'VERIFIED', '{}')`,
        [otherGroup.id]
      );
      await assert.rejects(
        campaignService.createCampaign(
          'snapshot-session',
          'Halo {{Nama}}',
          [{ contact_id: otherContact.id }],
          0,
          0,
          'Forbidden Snapshot'
        ),
        /bukan milik tenant sesi/
      );
    } finally {
      config.runtime.role = originalRole;
    }
  });
});
