import { Router } from 'express';
import { getAISettings, saveAISettings, testAISettings } from '../controllers/chatbot_ai.controller.js';

const router = Router();

router.get('/settings/:sessionId', getAISettings);
router.post('/settings', saveAISettings);
router.post('/test', testAISettings);

export default router;
