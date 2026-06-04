import express from 'express';
import { getGroups, sendMessage } from '../controllers/single_message.controller.js';

const router = express.Router();

router.get('/groups/:sessionId', getGroups);
router.post('/send', sendMessage);

export default router;
