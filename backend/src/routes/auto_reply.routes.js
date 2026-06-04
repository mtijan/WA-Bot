import express from 'express';
import { getAutoReplies, createAutoReply, updateAutoReply, deleteAutoReply } from '../controllers/auto_reply.controller.js';

const router = express.Router();

router.get('/', getAutoReplies);
router.post('/', createAutoReply);
router.put('/:id', updateAutoReply);
router.delete('/:id', deleteAutoReply);

export default router;
