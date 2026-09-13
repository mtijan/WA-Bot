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
  generateAISessionEmbeddings,
  getAISessionRagStatus,
  testAISessionRetrieval,
  getEmbeddingProfile,
  saveEmbeddingProfile,
  testEmbeddingProfileCapability,
  getEmbeddingUsage
} from '../controllers/chatbot_ai.controller.js';
import { validateBody } from '../utils/validator.js';
import { validateMaxOutputTokens } from '../services/chatbot_ai_runtime.service.js';

const router = Router();

// Settings routes
router.get('/settings/:sessionId', getAISettings);
router.post('/settings', validateBody({
  session_id: { required: true, type: 'string', min: 1 },
  max_output_tokens: { type: 'number', custom: validateMaxOutputTokens },
  rag_mode: { type: 'string', allowedValues: ['off', 'fts', 'hybrid'] },
  rag_top_k: { type: 'number', min: 1, max: 5 },
  rag_context_tokens: { type: 'number', min: 100, max: 10000 },
  rag_input_budget_tokens: { type: 'number', min: 256, max: 32768 },
  cache_ttl_seconds: { type: 'number', min: 60, max: 86400 },
  debounce_ms: { type: 'number', min: 0, max: 60000 },
  temperature: { type: 'number', min: 0, max: 2 }
}), saveAISettings);
router.post('/test', validateBody({
  session_id: { type: 'string', min: 1 },
  credential_id: { type: 'number' },
  test_kind: { type: 'string', allowedValues: ['connection', 'sandbox'] },
  system_prompt: { type: 'string', max: 100000 },
  user_message: { type: 'string', max: 10000 },
  prompt_override: { type: 'string', max: 110000 },
  max_output_tokens: { type: 'number', custom: validateMaxOutputTokens },
  use_rag: { type: 'boolean' },
  rag_mode: { type: 'string', allowedValues: ['off', 'fts', 'hybrid'] },
  rag_top_k: { type: 'number', min: 1, max: 5 },
  rag_context_tokens: { type: 'number', min: 100, max: 10000 },
  rag_threshold: { type: 'number', min: 0, max: 1 },
  temperature: { type: 'number', min: 0, max: 2 }
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
router.get('/rag/embedding-usage', getEmbeddingUsage);
router.get('/rag/:sessionId/status', getAISessionRagStatus);
router.post('/rag/:sessionId/test-retrieval', validateBody({
  query: { required: true, type: 'string', min: 1, max: 1000 },
  mode: { type: 'string', allowedValues: ['fts', 'hybrid'] },
  top_k: { type: 'number', min: 1, max: 20 },
  relevance_threshold: { type: 'number', min: 0, max: 1 }
}), testAISessionRetrieval);
router.post('/rag/:sessionId/reindex', validateBody({
  source_id: { type: 'number' },
  force: { type: 'boolean' }
}), reindexAISession);
router.post('/rag/:sessionId/generate-embeddings', validateBody({
  force: { type: 'boolean' }
}), generateAISessionEmbeddings);

export default router;
