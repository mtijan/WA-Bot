import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { dbGet, dbRun } from '../database.js';
import { createMediaFilename, getMediaSpec } from './upload_metadata.service.js';

export { createMediaFilename, getMediaSpec } from './upload_metadata.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

export const MEDIA_UPLOAD_DIR = path.resolve(
  config.uploads.mediaDir || path.join(BACKEND_ROOT, 'uploads', 'media')
);

export const ensureMediaUploadDir = () => {
  fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true });
};


export const getMediaPublicPath = (filename) => `/api/uploads/media/${filename}`;

export const getUploadedMediaByFilename = (filename) => {
  return dbGet('SELECT * FROM uploaded_media WHERE filename = ?', [filename]);
};

export const recordUploadedMedia = ({ filename, originalName, mimeType, mediaType, sizeBytes, userId }) => {
  return dbRun(
    `INSERT INTO uploaded_media
      (filename, original_name, mime_type, media_type, size_bytes, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [filename, originalName, mimeType, mediaType, sizeBytes, userId]
  );
};

export const resolveMediaFilePath = (filename) => {
  if (!filename || typeof filename !== 'string') return null;
  if (filename.includes('/') || filename.includes('\\')) return null;

  const absolutePath = path.resolve(MEDIA_UPLOAD_DIR, filename);
  const relative = path.relative(MEDIA_UPLOAD_DIR, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return absolutePath;
};

export const resolveUploadedMediaPath = (value) => {
  if (!value || typeof value !== 'string') return value;

  const marker = '/api/uploads/media/';
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return value;

  const filename = decodeURIComponent(value.slice(markerIndex + marker.length)).split(/[?#]/)[0];
  const absolutePath = resolveMediaFilePath(filename);
  if (!absolutePath) return value;

  return absolutePath;
};

export const deleteFileIfExists = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};
