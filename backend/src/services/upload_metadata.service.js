import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';

const ALLOWED_MEDIA = {
  'image/jpeg': { mediaType: 'Image', ext: '.jpg', maxBytes: config.uploads.imageMaxBytes },
  'image/png': { mediaType: 'Image', ext: '.png', maxBytes: config.uploads.imageMaxBytes },
  'image/webp': { mediaType: 'Image', ext: '.webp', maxBytes: config.uploads.imageMaxBytes },
  'image/gif': { mediaType: 'Image', ext: '.gif', maxBytes: config.uploads.imageMaxBytes },
  'video/mp4': { mediaType: 'Video', ext: '.mp4', maxBytes: config.uploads.videoMaxBytes },
  'video/webm': { mediaType: 'Video', ext: '.webm', maxBytes: config.uploads.videoMaxBytes },
  'video/quicktime': { mediaType: 'Video', ext: '.mov', maxBytes: config.uploads.videoMaxBytes },
  'audio/mpeg': { mediaType: 'Audio', ext: '.mp3', maxBytes: 2 * 1024 * 1024 },
  'audio/mp3': { mediaType: 'Audio', ext: '.mp3', maxBytes: 2 * 1024 * 1024 },
  'audio/wav': { mediaType: 'Audio', ext: '.wav', maxBytes: 2 * 1024 * 1024 },
  'audio/ogg': { mediaType: 'Audio', ext: '.ogg', maxBytes: 2 * 1024 * 1024 },
  'audio/x-m4a': { mediaType: 'Audio', ext: '.m4a', maxBytes: 2 * 1024 * 1024 },
  'audio/m4a': { mediaType: 'Audio', ext: '.m4a', maxBytes: 2 * 1024 * 1024 },
  'audio/aac': { mediaType: 'Audio', ext: '.aac', maxBytes: 2 * 1024 * 1024 },
  'audio/mp4': { mediaType: 'Audio', ext: '.mp4', maxBytes: 2 * 1024 * 1024 },
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

export const getMediaSpec = (mimeType) => ALLOWED_MEDIA[mimeType] || null;

export const createMediaFilename = (file) => {
  const spec = getMediaSpec(file.mimetype);
  const ext = spec ? spec.ext : '.bin';
  const originalName = file.originalname || 'file';
  const baseName = path.parse(originalName).name;
  const sanitized = baseName
    .replace(/[\/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '');

  return `${Date.now()}-${randomUUID()}-${sanitized}${ext}`;
};
