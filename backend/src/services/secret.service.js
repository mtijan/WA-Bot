import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1';

function getEncryptionKey() {
  const secret = process.env.WA_BOT_SECRET_ENCRYPTION_KEY;
  return secret && secret.length >= 32 ? createHash('sha256').update(secret).digest() : null;
}

export function protectSecret(value) {
  if (!value || value.startsWith(`${PREFIX}:`)) return value;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('WA_BOT_SECRET_ENCRYPTION_KEY wajib diisi minimal 32 karakter untuk menyimpan secret.');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function revealSecret(value) {
  if (!value || !value.startsWith(`${PREFIX}:`)) return value;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('WA_BOT_SECRET_ENCRYPTION_KEY wajib tersedia untuk membaca secret terenkripsi.');
  }

  const [, , ivBase64, tagBase64, encryptedBase64] = value.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final()
  ]).toString('utf8');
}
