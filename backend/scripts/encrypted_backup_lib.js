import crypto from 'crypto';
import fs from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const backendDir = resolve(__dirname, '..');

const safeName = (value) => Buffer.from(value, 'utf8').toString('base64url');

export const timestampForPath = () => new Date().toISOString().replace(/[:.]/g, '-');

export const getEncryptedBackupRoot = () => {
  return resolve(process.env.WA_BOT_ENCRYPTED_BACKUP_DIR || process.env.WA_BOT_BACKUP_DIR || join(backendDir, 'encrypted_backups'));
};

export const getRestoreDrillRoot = () => {
  return resolve(process.env.WA_BOT_RESTORE_DRILL_DIR || join(backendDir, 'restore_drills'));
};

export const deriveBackupKey = (salt) => {
  const secret = process.env.WA_BOT_BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error('WA_BOT_BACKUP_ENCRYPTION_KEY wajib diisi minimal 16 karakter untuk encrypted backup.');
  }

  return crypto.scryptSync(secret, salt, 32);
};

export const collectRuntimeFiles = () => {
  const roots = [
    { absolute: join(backendDir, 'database.sqlite'), relativeRoot: '' },
    { absolute: join(backendDir, 'sessions'), relativeRoot: 'sessions' }
  ];

  const files = [];

  const walk = (absolutePath, relativePath) => {
    if (!fs.existsSync(absolutePath)) return;

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath)) {
        walk(join(absolutePath, entry), join(relativePath, entry));
      }
      return;
    }

    if (stat.isFile()) {
      const normalizedRelative = relativePath.split(sep).join('/');
      if (normalizedRelative.startsWith('sessions/')) {
        const parts = normalizedRelative.split('/');
        // Berkas creds.json berada tepat di bawah subfolder sesi, misalnya: sessions/sesi-1/creds.json (panjang part = 3)
        const isCredsJson = parts.length === 3 && parts[2] === 'creds.json';
        if (!isCredsJson) return;
      }

      files.push({
        absolutePath,
        relativePath: normalizedRelative,
        size: stat.size
      });
    }
  };

  for (const root of roots) {
    if (root.relativeRoot) {
      walk(root.absolute, root.relativeRoot);
    } else if (fs.existsSync(root.absolute)) {
      walk(root.absolute, relative(backendDir, root.absolute));
    }
  }

  return files;
};

export const encryptFile = ({ sourcePath, outputDir, relativePath, key }) => {
  const original = fs.readFileSync(sourcePath);
  const compressed = zlib.gzipSync(original);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedName = `${safeName(relativePath)}.enc`;
  const encryptedPath = join(outputDir, encryptedName);

  fs.writeFileSync(encryptedPath, encrypted);

  return {
    path: relativePath,
    encrypted_file: encryptedName,
    size: original.length,
    sha256: crypto.createHash('sha256').update(original).digest('hex'),
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64')
  };
};

export const decryptFile = ({ encryptedPath, destinationPath, key, iv, authTag, expectedSha256 }) => {
  const encrypted = fs.readFileSync(encryptedPath);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const plain = zlib.gunzipSync(compressed);
  const actualSha256 = crypto.createHash('sha256').update(plain).digest('hex');

  if (actualSha256 !== expectedSha256) {
    throw new Error(`Hash mismatch saat restore drill: ${destinationPath}`);
  }

  fs.mkdirSync(dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, plain);
};
