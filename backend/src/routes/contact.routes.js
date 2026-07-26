import express from 'express';
import multer from 'multer';
import {
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getContacts,
  createContact,
  updateContact,
  deleteContact,
  bulkCreateContacts,
  deleteInvalidContacts,
  cleanupOrphanedContacts,
  verifyGroupContacts
} from '../controllers/contact.controller.js';
import {
  importContactsFromFile,
  previewContactImport
} from '../controllers/contact_import.controller.js';
import { CONTACT_IMPORT_MAX_BYTES } from '../services/contact_import.service.js';
import { validateBody } from '../utils/validator.js';
import { requireRole } from '../middleware/admin_auth.middleware.js';
import { sendError } from '../utils/http_response.js';

const router = express.Router();
const contactImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CONTACT_IMPORT_MAX_BYTES,
    files: 1,
    fields: 4
  }
});

const parseContactImportUpload = (req, res, next) => {
  contactImportUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxMegabytes = Math.ceil(CONTACT_IMPORT_MAX_BYTES / (1024 * 1024));
      return sendError(res, 413, 'CONTACT_IMPORT_FILE_TOO_LARGE', `Ukuran file kontak maksimal ${maxMegabytes} MB.`);
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return sendError(res, 400, 'CONTACT_IMPORT_SINGLE_FILE_ONLY', 'Upload hanya boleh berisi satu file.');
    }
    return next(error);
  });
};

// Groups routes
router.get('/groups', getGroups);
router.post('/groups', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 }
}), createGroup);
router.put('/groups/:id', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 }
}), updateGroup);
router.delete('/groups/:id', deleteGroup);

// Contacts routes
router.get('/', getContacts);
router.post('/', validateBody({
  group_id: { required: true },
  phone_number: { required: true, type: 'string', min: 5 }
}), createContact);
router.put('/:id', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  phone_number: { required: true, type: 'string', min: 5 }
}), updateContact);
router.delete('/:id', deleteContact);
router.post('/bulk', validateBody({
  group_id: { required: true },
  contacts: { required: true, type: 'array', min: 1 }
}), bulkCreateContacts);
router.post('/import/preview', parseContactImportUpload, previewContactImport);
router.post('/import', parseContactImportUpload, importContactsFromFile);
router.post('/cleanup', requireRole('admin'), cleanupOrphanedContacts);
router.delete('/groups/:groupId/invalid', deleteInvalidContacts);
router.post('/groups/:groupId/verify', validateBody({
  session_id: { required: true, type: 'string', min: 1 }
}), verifyGroupContacts);

export default router;
