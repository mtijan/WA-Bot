import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTestAgent } from './helpers/test_app.js';

async function loadUsageDependencies() {
  await getTestAgent();
  const [{ dbAll, dbGet, dbRun }, usageService] = await Promise.all([
    import('../src/database.js'),
    import('../src/services/chatbot_ai_usage.service.js')
  ]);
  return { dbAll, dbGet, dbRun, ...usageService };
}

describe('Chatbot AI usage telemetry', () => {
  it('normalizes OpenAI-compatible usage including cached and reasoning tokens', async () => {
    const { createAIRequestContext, normalizeProviderUsage } = await loadUsageDependencies();
    assert.equal(createAIRequestContext({ requestKind: 'embedding', operation: 'query_embedding' }).requestKind, 'embedding');
    assert.deepEqual(normalizeProviderUsage({
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 50 }
      }
    }), {
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cachedTokens: 400,
      reasoningTokens: 50,
      usageStatus: 'KNOWN'
    });
  });

  it('records production and sandbox attempts without prompt or response content', async () => {
    const {
      createAIRequestContext,
      dbAll,
      dbGet,
      dbRun,
      recordChatbotAIUsage
    } = await loadUsageDependencies();
    await dbRun(
      'INSERT INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
      ['ai-usage-session', 'CONNECTED', 1]
    );

    const productionContext = createAIRequestContext({ requestKind: 'production' });
    await recordChatbotAIUsage({
      context: productionContext,
      userId: 1,
      sessionId: 'ai-usage-session',
      provider: 'ai.example.com',
      model: 'example-model',
      response: {
        id: 'response-1',
        model: 'provider-model',
        choices: [{ finish_reason: 'stop', message: { content: 'sensitive answer' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      },
      deliveryStatus: 'SENT',
      latencyMs: 125
    });

    const sandboxContext = createAIRequestContext({ requestKind: 'sandbox' });
    await recordChatbotAIUsage({
      context: sandboxContext,
      userId: 1,
      provider: 'ai.example.com',
      model: 'example-model',
      response: { choices: [{ finish_reason: 'length' }] },
      latencyMs: 50
    });

    const production = await dbGet(
      'SELECT * FROM chatbot_ai_usage WHERE request_id = ?',
      [productionContext.requestId]
    );
    assert.equal(production.request_kind, 'production');
    assert.equal(production.input_tokens, 100);
    assert.equal(production.output_tokens, 20);
    assert.equal(production.finish_reason, 'stop');
    assert.equal(production.delivery_status, 'SENT');
    assert.equal(production.latency_ms, 125);

    const sandbox = await dbGet(
      'SELECT request_kind, usage_status, finish_reason FROM chatbot_ai_usage WHERE request_id = ?',
      [sandboxContext.requestId]
    );
    assert.deepEqual(sandbox, {
      request_kind: 'sandbox',
      usage_status: 'UNKNOWN',
      finish_reason: 'length'
    });

    const columns = (await dbAll('PRAGMA table_info(chatbot_ai_usage)')).map((column) => column.name);
    assert.equal(columns.some((name) => /prompt|message|content|answer|response_raw/i.test(name)), false);
  });

  it('records failed connection tests with unknown usage instead of zero tokens', async () => {
    const {
      createAIRequestContext,
      dbGet,
      recordChatbotAIUsage
    } = await loadUsageDependencies();
    const context = createAIRequestContext({ requestKind: 'test' });

    await recordChatbotAIUsage({
      context,
      userId: 1,
      provider: 'ai.example.com',
      model: 'example-model',
      error: { status: 429, code: 'rate_limit_exceeded' },
      latencyMs: 80
    });

    const row = await dbGet(
      `SELECT request_kind, request_status, usage_status, input_tokens,
              output_tokens, http_status, error_code
       FROM chatbot_ai_usage WHERE request_id = ?`,
      [context.requestId]
    );
    assert.equal(row.request_kind, 'test');
    assert.equal(row.request_status, 'FAILED');
    assert.equal(row.usage_status, 'UNKNOWN');
    assert.equal(row.input_tokens, null);
    assert.equal(row.output_tokens, null);
    assert.equal(row.http_status, 429);
    assert.equal(row.error_code, 'rate_limit_exceeded');
  });
});
