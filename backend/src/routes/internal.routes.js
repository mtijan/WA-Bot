import express from 'express';
import {
  live,
  ready,
  listSessions,
  getSession,
  initSession,
  deleteSession,
  updateSessionProxy,
  repairSessionInternal,
  reconnectSessionInternal,
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
  clearWarmerCampaignInternal,
  getFailedRepliesHealthInternal
} from '../controllers/internal.controller.js';
import { requireInternalToken } from '../middleware/internal_auth.middleware.js';
import { validateBody } from '../utils/validator.js';
import { isValidSessionId } from '../utils/session_id.js';
import { sendError } from '../utils/http_response.js';

const router = express.Router();

const validateSessionIdParam = (req, res, next) => {
  if (!isValidSessionId(req.params.id)) {
    return sendError(
      res,
      400,
      'INVALID_SESSION_ID',
      'ID sesi hanya boleh berisi huruf, angka, underscore, dan hyphen (maksimal 64 karakter).'
    );
  }
  return next();
};

router.get('/health/live', live);
router.get('/health/ready', ready);

router.use(requireInternalToken);

router.get('/health/failed-replies', getFailedRepliesHealthInternal);

router.get('/sessions', listSessions);
router.get('/sessions/:id', validateSessionIdParam, getSession);
router.post('/sessions/:id/init', validateSessionIdParam, initSession);
router.delete('/sessions/:id', validateSessionIdParam, deleteSession);
router.patch('/sessions/:id/proxy', validateSessionIdParam, updateSessionProxy);
router.post('/sessions/:id/repair', validateSessionIdParam, repairSessionInternal);
router.post('/sessions/:id/reconnect', validateSessionIdParam, reconnectSessionInternal);

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
