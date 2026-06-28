import fs from 'fs';
import {
  getMediaPublicPath,
  getMediaSpec,
  deleteFileIfExists,
  getUploadedMediaByFilename,
  recordUploadedMedia,
  resolveMediaFilePath
} from '../services/upload.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

export const uploadMedia = async (req, res) => {
  const file = req.file;
  if (!file) {
    return sendError(res, 400, 'MEDIA_FILE_REQUIRED', 'File media wajib disertakan.');
  }

  const spec = getMediaSpec(file.mimetype);
  if (!spec) {
    deleteFileIfExists(file.path);
    return sendError(res, 400, 'MEDIA_TYPE_NOT_ALLOWED', 'Hanya gambar, video, audio, dan dokumen yang diizinkan.');
  }

  if (file.size > spec.maxBytes) {
    deleteFileIfExists(file.path);
    const maxMb = Math.floor(spec.maxBytes / (1024 * 1024));
    return sendError(res, 413, 'MEDIA_FILE_TOO_LARGE', `${spec.mediaType} maksimal ${maxMb}MB.`);
  }

  try {
    await recordUploadedMedia({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      mediaType: spec.mediaType,
      sizeBytes: file.size,
      userId: req.auth.userId
    });

    return sendSuccess(res, {
      url: getMediaPublicPath(file.filename),
      media_type: spec.mediaType,
      file_name: file.originalname,
      stored_name: file.filename,
      mime_type: file.mimetype,
      size_bytes: file.size
    }, 200, { message: 'Media berhasil diupload.' });
  } catch (error) {
    deleteFileIfExists(file.path);
    logError('uploadMedia.recordMetadata', error, { filename: file.filename, userId: req.auth?.userId });
    return sendError(res, 500, 'MEDIA_METADATA_ERROR', 'Gagal mencatat metadata media.');
  }
};

export const downloadMedia = async (req, res) => {
  const { filename } = req.params;

  try {
    const filePath = resolveMediaFilePath(filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return sendError(res, 404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
    }

    const media = await getUploadedMediaByFilename(filename);
    if (!media) {
      return sendError(res, 404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && media.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke media ini.');
    }

    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    if (media.mime_type) {
      res.type(media.mime_type);
    }
    return res.sendFile(filePath);
  } catch (error) {
    logError('downloadMedia', error, { filename, userId: req.auth?.userId });
    return sendError(res, 500, 'MEDIA_DOWNLOAD_ERROR', 'Gagal mengambil media.');
  }
};
