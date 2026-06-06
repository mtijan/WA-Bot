import { Router } from 'express';
import { 
  getAISettings, 
  saveAISettings, 
  testAISettings,
  getCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  toggleCredentialActive
} from '../controllers/chatbot_ai.controller.js';
import { validateBody } from '../utils/validator.js';

const router = Router();

// Settings routes
router.get('/settings/:sessionId', getAISettings);
router.post('/settings', validateBody({
  session_id: { required: true, type: 'string', min: 1 }
}), saveAISettings);
router.post('/test', testAISettings);

// Credentials routes
router.get('/credentials', getCredentials);
router.post('/credentials', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 }
}), createCredential);
router.put('/credentials/:id', updateCredential);
router.delete('/credentials/:id', deleteCredential);
router.patch('/credentials/:id/toggle', toggleCredentialActive);

export default router;
