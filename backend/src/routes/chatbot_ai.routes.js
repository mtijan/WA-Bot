import { Router } from 'express';
import { 
  getAISettings, 
  saveAISettings, 
  testAISettings,
  getCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  toggleCredentialActive,
  reindexAISession,
  getEmbeddingProfile,
  saveEmbeddingProfile,
  testEmbeddingProfileCapability
} from '../controllers/chatbot_ai.controller.js';
import { validateBody } from '../utils/validator.js';
import { validateMaxOutputTokens } from '../services/chatbot_ai_runtime.service.js';

const router = Router();

// Settings routes
router.get('/settings/:sessionId', getAISettings);
router.post('/settings', validateBody({
  session_id: { required: true, type: 'string', min: 1 },
  max_output_tokens: { type: 'number', custom: validateMaxOutputTokens }
}), saveAISettings);
router.post('/test', validateBody({
  session_id: { type: 'string', min: 1 },
  credential_id: { type: 'number' },
  test_kind: { type: 'string', allowedValues: ['connection', 'sandbox'] },
  system_prompt: { type: 'string', max: 100000 },
  user_message: { type: 'string', max: 10000 },
  prompt_override: { type: 'string', max: 110000 },
  max_output_tokens: { type: 'number', custom: validateMaxOutputTokens }
}), testAISettings);

// Credentials routes
router.get('/credentials', getCredentials);
router.post('/credentials', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 }
}), createCredential);
router.put('/credentials/:id', updateCredential);
router.delete('/credentials/:id', deleteCredential);
router.patch('/credentials/:id/toggle', toggleCredentialActive);

// RAG routes
router.get('/rag/embedding-profile', getEmbeddingProfile);
router.put('/rag/embedding-profile', validateBody({
  credential_id: { type: 'number' },
  model: { type: 'string', min: 1, max: 100 },
  dimensions: { type: 'number' },
  test_capability: { type: 'boolean' }
}), saveEmbeddingProfile);
router.post('/rag/embedding-profile/test', validateBody({
  credential_id: { type: 'number' },
  base_url: { type: 'string' },
  api_key: { type: 'string' },
  model: { type: 'string' },
  dimensions: { type: 'number' }
}), testEmbeddingProfileCapability);
router.post('/rag/:sessionId/reindex', validateBody({
  source_id: { type: 'number' },
  force: { type: 'boolean' }
}), reindexAISession);

export default router;
