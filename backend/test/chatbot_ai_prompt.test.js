import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildConnectionTestMessages,
  buildProductionMessages,
  buildSandboxMessages
} from '../src/services/chatbot_ai_prompt.service.js';

describe('Chatbot AI prompt builder', () => {
  it('keeps production system instructions and user messages in separate roles', () => {
    const messages = buildProductionMessages({
      systemInstruction: 'Gunakan bahasa Indonesia.',
      knowledgeBase: 'Biaya pendaftaran Rp100.000.',
      userMessage: 'Berapa biaya pendaftaran?'
    });

    assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
    assert.match(messages[0].content, /Gunakan bahasa Indonesia/);
    assert.match(messages[0].content, /Biaya pendaftaran Rp100\.000/);
    assert.equal(messages[1].content, 'Berapa biaya pendaftaran?');
  });

  it('keeps sandbox system_prompt and user_message in separate roles', () => {
    const messages = buildSandboxMessages({
      systemPrompt: 'Jawab hanya dari informasi yang tersedia.',
      userMessage: 'Apa jam operasional?'
    });

    assert.deepEqual(messages, [
      { role: 'system', content: 'Jawab hanya dari informasi yang tersedia.' },
      { role: 'user', content: 'Apa jam operasional?' }
    ]);
  });

  it('supports prompt_override only as a legacy user-message fallback', () => {
    const messages = buildSandboxMessages({
      systemPrompt: 'Instruksi sistem.',
      legacyPromptOverride: 'Pertanyaan lama.'
    });

    assert.equal(messages[0].role, 'system');
    assert.deepEqual(messages[1], { role: 'user', content: 'Pertanyaan lama.' });
  });

  it('centralizes the connection-test prompt and rejects an empty sandbox question', () => {
    assert.deepEqual(buildConnectionTestMessages().map((message) => message.role), ['user']);
    assert.throws(
      () => buildSandboxMessages({ systemPrompt: 'Instruksi saja.' }),
      (error) => error.code === 'INVALID_AI_USER_MESSAGE'
    );
  });
});
