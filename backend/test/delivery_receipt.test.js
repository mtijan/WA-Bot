import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('Delivery receipt tracking', () => {
  it('mencatat metadata pesan keluar dan menaikkan ack secara monoton', async () => {
    await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const {
      mapBaileysMessageStatus,
      mapBaileysReceipt,
      recordOutboundDelivery,
      updateDeliveryReceipt
    } = await import('../src/services/delivery_receipt.service.js');

    assert.equal(mapBaileysMessageStatus(2), 'SERVER_ACK');
    assert.equal(mapBaileysMessageStatus(3), 'DELIVERED');
    assert.equal(mapBaileysReceipt({ receiptTimestamp: 1 }), 'DELIVERED');
    assert.equal(mapBaileysReceipt({ readTimestamp: 1 }), 'READ');

    const insert = await dbRun(
      "INSERT INTO delivery_logs (campaign_id, target_number, status, user_id) VALUES (NULL, '628100000001', 'PENDING', 1)"
    );
    await recordOutboundDelivery(insert.id, {
      messageId: 'receipt-message-1',
      remoteJid: '628100000001@s.whatsapp.net'
    });

    await updateDeliveryReceipt('receipt-message-1', 'READ');
    await updateDeliveryReceipt('receipt-message-1', 'SERVER_ACK');

    const row = await dbGet('SELECT status, message_id, remote_jid, ack_status FROM delivery_logs WHERE id = ?', [insert.id]);
    assert.equal(row.status, 'SENT');
    assert.equal(row.message_id, 'receipt-message-1');
    assert.equal(row.remote_jid, '628100000001@s.whatsapp.net');
    assert.equal(row.ack_status, 'READ');
  });

  it('menyimpan receipt sementara jika event datang sebelum log punya message_id', async () => {
    await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const { recordOutboundDelivery, updateDeliveryReceipt } = await import('../src/services/delivery_receipt.service.js');

    await updateDeliveryReceipt('receipt-race-message', 'DELIVERED');
    const insert = await dbRun(
      "INSERT INTO delivery_logs (campaign_id, target_number, status, user_id) VALUES (NULL, '628100000002', 'PENDING', 1)"
    );

    await recordOutboundDelivery(insert.id, {
      messageId: 'receipt-race-message',
      remoteJid: '628100000002@s.whatsapp.net'
    });

    const row = await dbGet('SELECT status, ack_status FROM delivery_logs WHERE id = ?', [insert.id]);
    assert.equal(row.status, 'SENT');
    assert.equal(row.ack_status, 'DELIVERED');
  });
});
