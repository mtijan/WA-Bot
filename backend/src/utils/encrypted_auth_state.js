import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

const PREFIX = 'enc:session:v1';
const fileLocks = new Map();

async function withFileLock(filePath, operation) {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  fileLocks.set(filePath, tail);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (fileLocks.get(filePath) === tail) {
      fileLocks.delete(filePath);
    }
  }
}

function getEncryptionKey() {
  const secret = process.env.WA_BOT_SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    const error = new Error('WA_BOT_SECRET_ENCRYPTION_KEY wajib diisi minimal 32 karakter untuk penyimpanan sesi.');
    error.code = 'SESSION_ENCRYPTION_KEY_NOT_CONFIGURED';
    throw error;
  }
  return createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(cipherText) {
  if (!cipherText || !cipherText.startsWith(`${PREFIX}:`)) {
    return cipherText;
  }

  const key = getEncryptionKey();
  const [,,, ivBase64, tagBase64, encryptedBase64] = cipherText.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export const useEncryptedMultiFileAuthState = async (folder) => {
  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

  const writeData = async (data, file) => {
    const jsonStr = JSON.stringify(data, BufferJSON.replacer);
    const encryptedStr = encrypt(jsonStr);
    const filePath = path.join(folder, fixFileName(file));
    await withFileLock(filePath, () => fs.promises.writeFile(filePath, encryptedStr, 'utf8'));
  };

  const readData = async (file) => {
    try {
      const filePath = path.join(folder, fixFileName(file));
      return await withFileLock(filePath, async () => {
        const fileContent = await fs.promises.readFile(filePath, 'utf8');
        const decryptedStr = decrypt(fileContent);
        return JSON.parse(decryptedStr, BufferJSON.reviver);
      });
    } catch (error) {
      return null;
    }
  };

  const removeData = async (file) => {
    try {
      const filePath = path.join(folder, fixFileName(file));
      await withFileLock(filePath, () => fs.promises.unlink(filePath));
    } catch (error) {
      // Ignore
    }
  };

  const folderInfo = await fs.promises.stat(folder).catch(() => null);
  if (!folderInfo) {
    await fs.promises.mkdir(folder, { recursive: true });
  }

  const creds = await readData('creds.json') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => {
      return writeData(creds, 'creds.json');
    }
  };
};
export { encrypt as encryptSessionFile, decrypt as decryptSessionFile };
