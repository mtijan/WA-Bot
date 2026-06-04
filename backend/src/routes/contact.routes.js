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

const router = express.Router();

// Groups routes
router.get('/groups', getGroups);
router.post('/groups', createGroup);
router.put('/groups/:id', updateGroup);
router.delete('/groups/:id', deleteGroup);

// Contacts routes
router.get('/', getContacts);
router.post('/', createContact);
router.put('/:id', updateContact);
router.delete('/:id', deleteContact);
router.post('/bulk', bulkCreateContacts);
router.post('/cleanup', cleanupOrphanedContacts);
router.delete('/groups/:groupId/invalid', deleteInvalidContacts);
router.post('/groups/:groupId/verify', verifyGroupContacts);

export default router;
