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

const router = express.Router();

router.get('/health/live', live);
router.get('/health/ready', ready);

router.use(requireInternalToken);

router.get('/sessions', listSessions);
router.get('/sessions/:id', getSession);
router.post('/sessions/:id/init', initSession);
router.delete('/sessions/:id', deleteSession);
router.patch('/sessions/:id/proxy', updateSessionProxy);

router.get('/groups/:id', getDetailedGroupsInternal);
router.post('/groups/invite-link', getGroupInviteLinkInternal);
router.post('/groups/metadata', getGroupsMetadataInternal);
router.post('/groups/force-sync-contacts', forceSyncContactsInternal);
router.get('/single-message/groups/:id', getGroupsInternal);
router.post('/single-message/send', sendSingleMessageInternal);
router.post('/contacts/verify-group-contacts', verifyGroupContactsInternal);
router.post('/campaigns/:id/process', processCampaignInternal);
router.post('/warmer/campaigns/:id/start', startWarmerCampaignInternal);
router.post('/warmer/campaigns/:id/stop', stopWarmerCampaignInternal);
router.post('/warmer/campaigns/:id/clear', clearWarmerCampaignInternal);

export default router;
