import express from 'express';
import {
  live,
  ready,
  listSessions,
  getSession,
  initSession,
  deleteSession,
  updateSessionProxy,
  getDetailedGroupsInternal,
  getGroupInviteLinkInternal,
  getGroupsMetadataInternal,
  forceSyncContactsInternal,
  getGroupsInternal,
  sendSingleMessageInternal,
  verifyGroupContactsInternal,
  processCampaignInternal,
  startWarmerCampaignInternal,
  stopWarmerCampaignInternal,
  clearWarmerCampaignInternal
} from '../controllers/internal.controller.js';
import { requireInternalToken } from '../middleware/internal_auth.middleware.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/health/live', live);
router.get('/health/ready', ready);

router.use(requireInternalToken);

router.get('/sessions', listSessions);
router.get('/sessions/:id', getSession);
router.post('/sessions/:id/init', initSession);
router.delete('/sessions/:id', deleteSession);
router.patch('/sessions/:id/proxy', updateSessionProxy);

// Group Grabber
router.get('/groups/:id', getDetailedGroupsInternal);
router.post('/groups/invite-link', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  groupId: { required: true, type: 'string', min: 1 }
}), getGroupInviteLinkInternal);
router.post('/groups/metadata', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  groupIds: { required: true, type: 'array', min: 1 }
}), getGroupsMetadataInternal);
router.post('/groups/force-sync-contacts', validateBody({
  sessionId: { required: true, type: 'string', min: 1 }
}), forceSyncContactsInternal);

// Single Message
router.get('/single-message/groups/:id', getGroupsInternal);
router.post('/single-message/send', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  target: { required: true, type: 'string', min: 5 }
}), sendSingleMessageInternal);

// Contacts verification
router.post('/contacts/verify-group-contacts', validateBody({
  groupId: { required: true },
  sessionId: { required: true, type: 'string', min: 1 }
}), verifyGroupContactsInternal);

// Campaign process nudge
router.post('/campaigns/:id/process', processCampaignInternal);

// Warmer control
router.post('/warmer/campaigns/:id/start', startWarmerCampaignInternal);
router.post('/warmer/campaigns/:id/stop', stopWarmerCampaignInternal);
router.post('/warmer/campaigns/:id/clear', clearWarmerCampaignInternal);

export default router;
