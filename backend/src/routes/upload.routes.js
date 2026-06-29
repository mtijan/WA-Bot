import express from 'express';
import multer from 'multer';
import { downloadMedia, uploadMedia, deleteMedia } from '../controllers/upload.controller.js';
import { createMediaFilename, ensureMediaUploadDir, getMediaSpec, MEDIA_UPLOAD_DIR } from '../services/upload.service.js';
import { sendError } from '../utils/http_response.js';
import { requireActiveSubscription } from '../middleware/entitlement.middleware.js';

ensureMediaUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, MEDIA_UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    callback(null, createMediaFilename(file));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!getMediaSpec(file.mimetype)) {
      return callback(new Error('MEDIA_TYPE_NOT_ALLOWED'));
    }
    return callback(null, true);
  }
});

const router = express.Router();

router.post('/media', requireActiveSubscription, (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 413, 'MEDIA_FILE_TOO_LARGE', 'Berkas melebihi batas ukuran maksimal (Video 10MB, Gambar/Dokumen 5MB, Audio 2MB).');
    }

    if (err.message === 'MEDIA_TYPE_NOT_ALLOWED') {
      return sendError(res, 400, 'MEDIA_TYPE_NOT_ALLOWED', 'Hanya gambar, video, audio, dan dokumen yang diizinkan.');
    }

    return next(err);
  });
}, uploadMedia);

router.get('/media/:filename', downloadMedia);
router.delete('/media/:filename', deleteMedia);

export default router;
