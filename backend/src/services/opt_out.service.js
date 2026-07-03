import { dbAll, dbGet, dbRun } from '../database.js';

const OPT_OUT_KEYWORDS = new Set([
  'stop', 
  'unsubscribe', 
  'berhenti', 
  'saya ingin konsultasi', 
  'admin', 
  'saya ingin berbicara dengan admin'
]);

export function normalizePhoneNumber(value = '') {
  return String(value).replace(/\D/g, '');
}

export function canonicalPhoneNumber(value = '') {
  const phoneNumber = normalizePhoneNumber(value);
  return phoneNumber.startsWith('0') ? `62${phoneNumber.slice(1)}` : phoneNumber;
}

export function isOptOutKeyword(text = '') {
  return OPT_OUT_KEYWORDS.has(String(text).trim().toLowerCase());
}

export async function recordOptOut(value, userId, source = 'MANUAL') {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) throw new Error('Nomor telepon opt-out tidak valid.');
  const uId = userId || 1;

  await dbRun(
    `INSERT INTO opt_out_contacts (user_id, phone_number, source)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, phone_number) DO UPDATE SET
       source = excluded.source,
       created_at = CURRENT_TIMESTAMP`,
    [uId, phoneNumber, source]
  );

  return phoneNumber;
}

export async function removeOptOut(value, userId) {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) throw new Error('Nomor telepon opt-out tidak valid.');
  if (userId) {
    await dbRun('DELETE FROM opt_out_contacts WHERE phone_number = ? AND user_id = ?', [phoneNumber, userId]);
  } else {
    await dbRun('DELETE FROM opt_out_contacts WHERE phone_number = ?', [phoneNumber]);
  }
}

export async function isOptedOut(value, userId) {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) return false;
  const uId = userId || 1;
  return Boolean(await dbGet('SELECT phone_number FROM opt_out_contacts WHERE phone_number = ? AND user_id = ?', [phoneNumber, uId]));
}

export async function listOptOuts(userId = null) {
  if (userId) {
    return dbAll('SELECT phone_number, source, created_at FROM opt_out_contacts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }
  return dbAll('SELECT phone_number, source, created_at FROM opt_out_contacts ORDER BY created_at DESC');
}
