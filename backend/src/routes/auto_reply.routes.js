import express from 'express';
import { getAutoReplies, createAutoReply, updateAutoReply, deleteAutoReply } from '../controllers/auto_reply.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/', getAutoReplies);
router.post('/', validateBody({
  session_id: { required: true, type: 'string', min: 1 },
  keyword: { required: true, type: 'string', min: 1 },
  type: { required: true, type: 'string', allowedValues: ['text', 'image', 'video', 'template'] },
  content: { required: true, type: 'string', min: 1 }
}), createAutoReply);
router.put('/:id', validateBody({
  keyword: { required: true, type: 'string', min: 1 },
  type: { required: true, type: 'string', allowedValues: ['text', 'image', 'video', 'template'] },
  content: { required: true, type: 'string', min: 1 }
}), updateAutoReply);
router.delete('/:id', deleteAutoReply);

export default router;
