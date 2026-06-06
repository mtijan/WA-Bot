import express from 'express';
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
import { validateBody } from '../utils/validator.js';

const router = express.Router();

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
router.post('/cleanup', cleanupOrphanedContacts);
router.delete('/groups/:groupId/invalid', deleteInvalidContacts);
router.post('/groups/:groupId/verify', validateBody({
  session_id: { required: true, type: 'string', min: 1 }
}), verifyGroupContacts);

export default router;
