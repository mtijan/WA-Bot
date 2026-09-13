import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTestAgent } from './helpers/test_app.js';

async function insertSession(sessionId) {
  const { dbRun } = await import('../src/database.js');
  await dbRun(
    'INSERT INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [sessionId, 'CONNECTED', 1]
  );
}

describe('Chatbot AI max_output_tokens settings', () => {
  it('returns the default 2048 for a session without saved AI settings', async () => {
    const agent = await getTestAgent();
    await insertSession('ai-output-default');

    const response = await agent.get('/api/chatbot-ai/settings/ai-output-default');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.max_output_tokens, 2048);
  });

  it('persists and returns a valid output limit', async () => {
    const agent = await getTestAgent();
    await insertSession('ai-output-custom');

    const saveResponse = await agent
      .post('/api/chatbot-ai/settings')
      .send({ session_id: 'ai-output-custom', max_output_tokens: 250 });
    assert.equal(saveResponse.status, 200);

    const getResponse = await agent.get('/api/chatbot-ai/settings/ai-output-custom');
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.data.max_output_tokens, 250);

    const updateResponse = await agent
      .post('/api/chatbot-ai/settings')
      .send({ session_id: 'ai-output-custom', max_output_tokens: 2048 });
    assert.equal(updateResponse.status, 200);

    const updatedSettings = await agent.get('/api/chatbot-ai/settings/ai-output-custom');
    assert.equal(updatedSettings.body.data.max_output_tokens, 2048);
  });

  it('rejects invalid output limits before writing settings', async () => {
    const agent = await getTestAgent();
    await insertSession('ai-output-invalid');

    for (const value of [null, 63, 10001, 250.5, 'invalid']) {
      const response = await agent
        .post('/api/chatbot-ai/settings')
        .send({ session_id: 'ai-output-invalid', max_output_tokens: value });

      assert.equal(response.status, 400);
      assert.equal(response.body.error_code, 'VALIDATION_ERROR');
      assert.ok(response.body.details.max_output_tokens);
    }
  });

  it('validates sandbox kind, message roles, and output limit before provider access', async () => {
    const agent = await getTestAgent();

    const invalidKind = await agent
      .post('/api/chatbot-ai/test')
      .send({ test_kind: 'unknown' });
    assert.equal(invalidKind.status, 400);
    assert.equal(invalidKind.body.error_code, 'VALIDATION_ERROR');

    const missingQuestion = await agent
      .post('/api/chatbot-ai/test')
      .send({ test_kind: 'sandbox', system_prompt: 'Instruksi saja.' });
    assert.equal(missingQuestion.status, 400);
    assert.equal(missingQuestion.body.error_code, 'INVALID_AI_USER_MESSAGE');

    const invalidLimit = await agent
      .post('/api/chatbot-ai/test')
      .send({ test_kind: 'connection', max_output_tokens: null });
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimit.body.error_code, 'VALIDATION_ERROR');
  });
});
