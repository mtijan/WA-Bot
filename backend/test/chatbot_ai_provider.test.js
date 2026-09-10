import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTestAgent } from './helpers/test_app.js';

async function loadProviderDependencies() {
  await getTestAgent();
  const [{ dbAll }, providerService, usageService, budgetService] = await Promise.all([
    import('../src/database.js'),
    import('../src/services/chatbot_ai_provider.service.js'),
    import('../src/services/chatbot_ai_usage.service.js'),
    import('../src/services/chatbot_ai_budget.service.js')
  ]);
  return { dbAll, ...providerService, ...usageService, ...budgetService };
}

function createClient(handler) {
  return { chat: { completions: { create: handler } } };
}

function providerError(status, code = 'provider_error') {
  const error = new Error('Synthetic provider failure');
  error.status = status;
  error.code = code;
  return error;
}

describe('Chatbot AI explicit provider retry', () => {
  it('records a transient failed attempt and returns the second successful attempt', async () => {
    const {
      dbAll,
      executeInstrumentedChatCompletion,
      getAIBudgetAttemptId,
      recordChatbotAIUsage
    } = await loadProviderDependencies();
    let calls = 0;
    const provider = 'retry-success.example';
    const response = {
      id: 'retry-success-response',
      model: 'retry-model',
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
    };
    const result = await executeInstrumentedChatCompletion({
      openai: createClient(async () => {
        calls += 1;
        if (calls === 1) throw providerError(503, 'service_unavailable');
        return response;
      }),
      payload: { model: 'retry-model', messages: [] },
      requestKind: 'sandbox',
      userId: 1,
      provider,
      model: 'retry-model',
      retryDelayMs: 0
    });

    assert.equal(calls, 2);
    assert.equal(result.context.attemptNo, 2);
    assert.match(getAIBudgetAttemptId(result.context), /:2$/);
    await recordChatbotAIUsage({
      context: result.context,
      userId: 1,
      provider,
      model: 'retry-model',
      response: result.response
    });

    const rows = await dbAll(
      `SELECT request_id, attempt_no, request_status
       FROM chatbot_ai_usage WHERE provider = ? ORDER BY attempt_no`,
      [provider]
    );
    assert.deepEqual(rows.map((row) => [row.attempt_no, row.request_status]), [
      [1, 'FAILED'],
      [2, 'SUCCEEDED']
    ]);
    assert.equal(rows[0].request_id, rows[1].request_id);
  });

  it('does not retry a clear client error', async () => {
    const { dbAll, executeInstrumentedChatCompletion } = await loadProviderDependencies();
    let calls = 0;
    const provider = 'retry-client-error.example';
    await assert.rejects(
      executeInstrumentedChatCompletion({
        openai: createClient(async () => {
          calls += 1;
          throw providerError(400, 'invalid_request');
        }),
        payload: { model: 'retry-model', messages: [] },
        requestKind: 'test',
        userId: 1,
        provider,
        model: 'retry-model',
        retryDelayMs: 0
      }),
      (error) => error.status === 400
    );
    assert.equal(calls, 1);
    const rows = await dbAll(
      'SELECT attempt_no, request_status FROM chatbot_ai_usage WHERE provider = ?',
      [provider]
    );
    assert.deepEqual(rows.map((row) => [row.attempt_no, row.request_status]), [[1, 'FAILED']]);
  });

  it('stops after two transient attempts and records both independently', async () => {
    const {
      dbAll,
      executeInstrumentedChatCompletion,
      isRetryableAIProviderError
    } = await loadProviderDependencies();
    assert.equal(isRetryableAIProviderError(providerError(429, 'rate_limit')), true);
    assert.equal(isRetryableAIProviderError(providerError(401, 'unauthorized')), false);

    let calls = 0;
    const provider = 'retry-exhausted.example';
    await assert.rejects(
      executeInstrumentedChatCompletion({
        openai: createClient(async () => {
          calls += 1;
          throw providerError(503, 'service_unavailable');
        }),
        payload: { model: 'retry-model', messages: [] },
        requestKind: 'production',
        userId: 1,
        provider,
        model: 'retry-model',
        retryDelayMs: 0
      }),
      (error) => error.status === 503
    );
    assert.equal(calls, 2);

    const rows = await dbAll(
      `SELECT request_id, attempt_no, request_status
       FROM chatbot_ai_usage WHERE provider = ? ORDER BY attempt_no`,
      [provider]
    );
    assert.deepEqual(rows.map((row) => [row.attempt_no, row.request_status]), [
      [1, 'FAILED'],
      [2, 'FAILED']
    ]);
    assert.equal(rows[0].request_id, rows[1].request_id);
  });
});
