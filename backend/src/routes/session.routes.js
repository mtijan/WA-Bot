import express from 'express';
import { getSessions, createSession, deleteSession, updateSessionProxy, repairSession, reconnectSession } from '../controllers/session.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireActiveSubscription, checkSessionQuota } from '../middleware/entitlement.middleware.js';
import { SESSION_ID_MAX_LENGTH, SESSION_ID_PATTERN, isValidSessionId } from '../utils/session_id.js';
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

router.get('/', getSessions);
router.post('/', 
  requireActiveSubscription, 
  checkSessionQuota,
  validateBody({
    session_id: {
      required: true,
      type: 'string',
      min: 1,
      max: SESSION_ID_MAX_LENGTH,
      matches: SESSION_ID_PATTERN
    }
  }), 
  createSession
);
router.delete('/:id', validateSessionIdParam, deleteSession);
router.patch('/:id/proxy', validateSessionIdParam, updateSessionProxy);
router.post('/:id/repair', validateSessionIdParam, repairSession);
router.post('/:id/reconnect', validateSessionIdParam, reconnectSession);

export default router;
