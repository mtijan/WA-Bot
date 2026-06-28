import express from 'express';
import { getSessions, createSession, deleteSession, updateSessionProxy, repairSession, reconnectSession } from '../controllers/session.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireActiveSubscription, checkSessionQuota } from '../middleware/entitlement.middleware.js';

const router = express.Router();

router.get('/', getSessions);
router.post('/', 
  requireActiveSubscription, 
  checkSessionQuota,
  validateBody({
    session_id: { required: true, type: 'string', min: 1 }
  }), 
  createSession
);
router.delete('/:id', deleteSession);
router.patch('/:id/proxy', updateSessionProxy);
router.post('/:id/repair', repairSession);
router.post('/:id/reconnect', reconnectSession);

export default router;
