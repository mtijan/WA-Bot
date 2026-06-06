import { getMediaPublicPath, getMediaSpec, deleteFileIfExists } from '../services/upload.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';

export const uploadMedia = async (req, res) => {
  const file = req.file;
  if (!file) {
    return sendError(res, 400, 'MEDIA_FILE_REQUIRED', 'File media wajib disertakan.');
  }

  const spec = getMediaSpec(file.mimetype);
  if (!spec) {
    deleteFileIfExists(file.path);
    return sendError(res, 400, 'MEDIA_TYPE_NOT_ALLOWED', 'Hanya gambar dan video yang diizinkan.');
  }

  if (file.size > spec.maxBytes) {
    deleteFileIfExists(file.path);
    const maxMb = Math.floor(spec.maxBytes / (1024 * 1024));
    return sendError(res, 413, 'MEDIA_FILE_TOO_LARGE', `${spec.mediaType} maksimal ${maxMb}MB.`);
  }

  return sendSuccess(res, {
    url: getMediaPublicPath(file.filename),
    media_type: spec.mediaType,
    file_name: file.originalname,
    stored_name: file.filename,
    mime_type: file.mimetype,
    size_bytes: file.size
  }, 200, { message: 'Media berhasil diupload.' });
};
