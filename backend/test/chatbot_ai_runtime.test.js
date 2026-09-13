import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHATBOT_AI_OUTPUT_LIMITS,
  CHATBOT_AI_TEMPERATURES,
  buildChatCompletionPayload,
  normalizeMaxOutputTokens,
  resolveChatTemperature,
  validateMaxOutputTokens
} from '../src/services/chatbot_ai_runtime.service.js';

describe('Chatbot AI output guard', () => {
  it('uses 2048 as the production default and accepts integer settings in range', () => {
    assert.equal(normalizeMaxOutputTokens(), 2048);
    assert.equal(normalizeMaxOutputTokens('250'), 250);
    assert.equal(normalizeMaxOutputTokens(64), 64);
    assert.equal(normalizeMaxOutputTokens(2048), 2048);
    assert.equal(normalizeMaxOutputTokens(10000), 10000);
  });

  it('rejects decimals and values outside 64-10000', () => {
    for (const value of [63, 10001, 250.5, 'not-a-number']) {
      assert.throws(
        () => normalizeMaxOutputTokens(value),
        (error) => error.code === 'INVALID_MAX_OUTPUT_TOKENS'
      );
      assert.match(validateMaxOutputTokens(value), /bilangan bulat/);
    }
  });

  it('maps the internal production limit to the OpenAI-compatible max_tokens parameter', () => {
    const payload = buildChatCompletionPayload({
      model: 'MiniMax-M2.7-highspeed',
      messages: [{ role: 'user', content: 'Halo' }],
      maxOutputTokens: 250
    });

    assert.equal(payload.max_tokens, 250);
    assert.equal(payload.temperature, 0.7);
  });

  it('limits connection tests to 32 output tokens', () => {
    const payload = buildChatCompletionPayload({
      model: 'MiniMax-M2.7-highspeed',
      messages: [{ role: 'user', content: 'Halo' }],
      maxOutputTokens: CHATBOT_AI_OUTPUT_LIMITS.max,
      requestKind: 'test'
    });

    assert.equal(payload.max_tokens, 32);
  });

  it('exposes explicit existing and grounded temperature profiles', () => {
    assert.equal(resolveChatTemperature('existing'), 0.7);
    assert.equal(resolveChatTemperature('grounded'), 0.3);
    assert.deepEqual(CHATBOT_AI_TEMPERATURES, { existing: 0.7, grounded: 0.3 });
    assert.throws(() => resolveChatTemperature('unknown'), /Unsupported/);
  });
});
