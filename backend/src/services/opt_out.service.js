import { dbAll, dbGet, dbRun } from '../database.js';

const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'berhenti']);

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

export async function recordOptOut(value, source = 'MANUAL') {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) throw new Error('Nomor telepon opt-out tidak valid.');

  await dbRun(
    `INSERT INTO opt_out_contacts (phone_number, source)
     VALUES (?, ?)
     ON CONFLICT(phone_number) DO UPDATE SET
       source = excluded.source,
       created_at = CURRENT_TIMESTAMP`,
    [phoneNumber, source]
  );

  return phoneNumber;
}

export async function removeOptOut(value) {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) throw new Error('Nomor telepon opt-out tidak valid.');
  await dbRun('DELETE FROM opt_out_contacts WHERE phone_number = ?', [phoneNumber]);
}

export async function isOptedOut(value) {
  const phoneNumber = canonicalPhoneNumber(value);
  if (!phoneNumber) return false;
  return Boolean(await dbGet('SELECT phone_number FROM opt_out_contacts WHERE phone_number = ?', [phoneNumber]));
}

export async function listOptOuts() {
  return dbAll('SELECT phone_number, source, created_at FROM opt_out_contacts ORDER BY created_at DESC');
}
