import express from 'express';
import {
  live,
  ready,
  listSessions,
  getSession,
  initSession,
  deleteSession,
  updateSessionProxy
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

export default router;
