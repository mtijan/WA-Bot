import express from 'express';
import { getSessions, createSession, deleteSession, updateSessionProxy } from '../controllers/session.controller.js';

const router = express.Router();

router.get('/', getSessions);
router.post('/', createSession);
router.delete('/:id', deleteSession);
router.patch('/:id/proxy', updateSessionProxy);

export default router;
