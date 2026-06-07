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
  // Images (Max 5MB)
  'image/jpeg': { mediaType: 'Image', ext: '.jpg', maxBytes: config.uploads.imageMaxBytes },
  'image/png': { mediaType: 'Image', ext: '.png', maxBytes: config.uploads.imageMaxBytes },
  'image/webp': { mediaType: 'Image', ext: '.webp', maxBytes: config.uploads.imageMaxBytes },
  'image/gif': { mediaType: 'Image', ext: '.gif', maxBytes: config.uploads.imageMaxBytes },
  
  // Videos (Max 10MB)
  'video/mp4': { mediaType: 'Video', ext: '.mp4', maxBytes: config.uploads.videoMaxBytes },
  'video/webm': { mediaType: 'Video', ext: '.webm', maxBytes: config.uploads.videoMaxBytes },
  'video/quicktime': { mediaType: 'Video', ext: '.mov', maxBytes: config.uploads.videoMaxBytes },
  
  // Audio (Max 2MB)
  'audio/mpeg': { mediaType: 'Audio', ext: '.mp3', maxBytes: 2 * 1024 * 1024 },
  'audio/mp3': { mediaType: 'Audio', ext: '.mp3', maxBytes: 2 * 1024 * 1024 },
  'audio/wav': { mediaType: 'Audio', ext: '.wav', maxBytes: 2 * 1024 * 1024 },
  'audio/ogg': { mediaType: 'Audio', ext: '.ogg', maxBytes: 2 * 1024 * 1024 },
  'audio/x-m4a': { mediaType: 'Audio', ext: '.m4a', maxBytes: 2 * 1024 * 1024 },
  'audio/m4a': { mediaType: 'Audio', ext: '.m4a', maxBytes: 2 * 1024 * 1024 },
  'audio/aac': { mediaType: 'Audio', ext: '.aac', maxBytes: 2 * 1024 * 1024 },
  'audio/mp4': { mediaType: 'Audio', ext: '.mp4', maxBytes: 2 * 1024 * 1024 },
  
  // Documents (Max 5MB)
  'application/pdf': { mediaType: 'Document', ext: '.pdf', maxBytes: 5 * 1024 * 1024 },
  'application/msword': { mediaType: 'Document', ext: '.doc', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { mediaType: 'Document', ext: '.docx', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.ms-excel': { mediaType: 'Document', ext: '.xls', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { mediaType: 'Document', ext: '.xlsx', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.ms-powerpoint': { mediaType: 'Document', ext: '.ppt', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { mediaType: 'Document', ext: '.pptx', maxBytes: 5 * 1024 * 1024 },
  'text/plain': { mediaType: 'Document', ext: '.txt', maxBytes: 5 * 1024 * 1024 },
  'text/csv': { mediaType: 'Document', ext: '.csv', maxBytes: 5 * 1024 * 1024 },
  'application/zip': { mediaType: 'Document', ext: '.zip', maxBytes: 5 * 1024 * 1024 },
  'application/x-zip-compressed': { mediaType: 'Document', ext: '.zip', maxBytes: 5 * 1024 * 1024 },
  'application/octet-stream': { mediaType: 'Document', ext: '.bin', maxBytes: 5 * 1024 * 1024 }
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
