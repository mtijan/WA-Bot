import express from 'express';
import { getGroups, sendMessage } from '../controllers/single_message.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/groups/:sessionId', getGroups);
router.post('/send', validateBody({
  sessionId: { required: true, type: 'string', min: 1 },
  target: { required: true, type: 'string', min: 5 },
  allowOptedOut: { type: 'boolean' }
}), sendMessage);

export default router;
