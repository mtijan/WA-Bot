import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

export const MEDIA_UPLOAD_DIR = path.resolve(
  config.uploads.mediaDir || path.join(BACKEND_ROOT, 'uploads', 'media')
);

const ALLOWED_MEDIA = {
  'image/jpeg': { mediaType: 'Image', ext: '.jpg', maxBytes: config.uploads.imageMaxBytes },
  'image/png': { mediaType: 'Image', ext: '.png', maxBytes: config.uploads.imageMaxBytes },
  'image/webp': { mediaType: 'Image', ext: '.webp', maxBytes: config.uploads.imageMaxBytes },
  'image/gif': { mediaType: 'Image', ext: '.gif', maxBytes: config.uploads.imageMaxBytes },
  'video/mp4': { mediaType: 'Video', ext: '.mp4', maxBytes: config.uploads.videoMaxBytes },
  'video/webm': { mediaType: 'Video', ext: '.webm', maxBytes: config.uploads.videoMaxBytes },
  'video/quicktime': { mediaType: 'Video', ext: '.mov', maxBytes: config.uploads.videoMaxBytes }
};

export const ensureMediaUploadDir = () => {
  fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true });
};

export const getMediaSpec = (mimeType) => ALLOWED_MEDIA[mimeType] || null;

export const createMediaFilename = (file) => {
  const spec = getMediaSpec(file.mimetype);
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  const ext = originalExt && originalExt.length <= 8 ? originalExt : spec.ext;
  return `${Date.now()}-${randomUUID()}${ext}`;
};

export const getMediaPublicPath = (filename) => `/api/uploads/media/${filename}`;

export const resolveUploadedMediaPath = (value) => {
  if (!value || typeof value !== 'string') return value;

  const marker = '/api/uploads/media/';
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return value;

  const filename = decodeURIComponent(value.slice(markerIndex + marker.length)).split(/[?#]/)[0];
  if (!filename || filename.includes('/') || filename.includes('\\')) return value;

  const absolutePath = path.resolve(MEDIA_UPLOAD_DIR, filename);
  if (!absolutePath.startsWith(MEDIA_UPLOAD_DIR)) return value;

  return absolutePath;
};

export const deleteFileIfExists = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};
