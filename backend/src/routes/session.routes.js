import express from 'express';
import { getSessions, createSession, deleteSession, updateSessionProxy } from '../controllers/session.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/', getSessions);
router.post('/', validateBody({
  session_id: { required: true, type: 'string', min: 1 }
}), createSession);
router.delete('/:id', deleteSession);
router.patch('/:id/proxy', updateSessionProxy);

export default router;
