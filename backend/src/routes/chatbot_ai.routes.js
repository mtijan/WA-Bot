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

const router = Router();

// Settings routes
router.get('/settings/:sessionId', getAISettings);
router.post('/settings', saveAISettings);
router.post('/test', testAISettings);

// Credentials routes
router.get('/credentials', getCredentials);
router.post('/credentials', createCredential);
router.put('/credentials/:id', updateCredential);
router.delete('/credentials/:id', deleteCredential);
router.patch('/credentials/:id/toggle', toggleCredentialActive);

export default router;
