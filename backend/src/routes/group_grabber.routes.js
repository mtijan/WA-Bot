import express from 'express';
import { getDetailedGroups, getInviteLink, exportParticipants, forceSyncContacts } from '../controllers/group_grabber.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/groups/:sessionId', getDetailedGroups);
router.post('/invite-link', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  groupId: { required: true, type: 'string', min: 1 }
}), getInviteLink);
router.post('/export-participants', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  groupIds: { required: true, type: 'array', min: 1 }
}), exportParticipants);
router.post('/force-sync-contacts', validateBody({
  sessionId: { required: true, type: 'string', min: 1 }
}), forceSyncContacts);

export default router;
