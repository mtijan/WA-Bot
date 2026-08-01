import { dbGet, dbRun } from '../database.js';

const ACK_RANK = Object.freeze({
  QUEUED: 0,
  SERVER_ACK: 1,
  DELIVERED: 2,
  READ: 3,
  PLAYED: 4,
  FAILED: 5
});
const pendingReceipts = new Map();
const MAX_PENDING_RECEIPTS = 1000;

function isKnownAckStatus(status) {
  return Object.prototype.hasOwnProperty.call(ACK_RANK, status);
}

function rememberPendingReceipt(messageId, ackStatus, errorMessage = null) {
  const current = pendingReceipts.get(messageId);
  if (!current || (ACK_RANK[ackStatus] ?? -1) >= (ACK_RANK[current.ackStatus] ?? -1)) {
    pendingReceipts.set(messageId, { ackStatus, errorMessage });
  }

  if (pendingReceipts.size > MAX_PENDING_RECEIPTS) {
    const oldestMessageId = pendingReceipts.keys().next().value;
    pendingReceipts.delete(oldestMessageId);
  }
}

export function mapBaileysMessageStatus(status) {
  const normalized = Number(status);
  if (normalized === 0) return 'FAILED';
  if (normalized === 1) return 'QUEUED';
  if (normalized === 2) return 'SERVER_ACK';
  if (normalized === 3) return 'DELIVERED';
  if (normalized === 4) return 'READ';
  if (normalized === 5) return 'PLAYED';
  return null;
}

export function mapBaileysReceipt(receipt = {}) {
  if (receipt.playedTimestamp != null) return 'PLAYED';
  if (receipt.readTimestamp != null) return 'READ';
  if (receipt.receiptTimestamp != null) return 'DELIVERED';
  return null;
}

export async function updateDeliveryReceipt(messageId, nextAckStatus, errorMessage = null) {
  if (!messageId || !isKnownAckStatus(nextAckStatus)) return false;

  const normalizedMessageId = String(messageId);

  const rows = await dbGet(
    `SELECT id, status, ack_status
     FROM delivery_logs
     WHERE message_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [normalizedMessageId]
  );
  if (!rows) {
    rememberPendingReceipt(normalizedMessageId, nextAckStatus, errorMessage);
    return false;
  }

  const currentAckStatus = rows.ack_status || 'QUEUED';
  if (currentAckStatus === 'FAILED' && nextAckStatus !== 'FAILED') return true;
  if ((ACK_RANK[nextAckStatus] ?? -1) < (ACK_RANK[currentAckStatus] ?? -1)) return true;

  if (nextAckStatus === 'FAILED') {
    await dbRun(
      `UPDATE delivery_logs
       SET status = 'FAILED', ack_status = 'FAILED',
           error_message = COALESCE(?, error_message), ack_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [errorMessage, rows.id]
    );
  } else {
    await dbRun(
      `UPDATE delivery_logs
       SET ack_status = ?, ack_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAckStatus, rows.id]
    );
  }
  return true;
}

export async function recordOutboundDelivery(deliveryLogId, sendResult) {
  const messageId = sendResult?.messageId ? String(sendResult.messageId) : '';
  if (!deliveryLogId || !messageId) {
    throw new Error('WhatsApp tidak mengembalikan ID pesan keluar.');
  }

  await dbRun(
    `UPDATE delivery_logs
     SET status = 'SENT',
         message_id = ?,
         remote_jid = ?,
         ack_status = 'SERVER_ACK',
         ack_updated_at = CURRENT_TIMESTAMP,
         error_message = NULL
     WHERE id = ?`,
    [messageId, sendResult.remoteJid || null, deliveryLogId]
  );

  const pendingReceipt = pendingReceipts.get(messageId);
  if (pendingReceipt) {
    pendingReceipts.delete(messageId);
    await updateDeliveryReceipt(messageId, pendingReceipt.ackStatus, pendingReceipt.errorMessage);
  }
}

export const deliveryAckRank = ACK_RANK;
