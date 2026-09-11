import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.WA_BOT_DB_PATH = ':memory:';

import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  buildProductionSystemPrompt,
  buildRagProductionMessages,
  buildRagProductionSystemPrompt,
  RAG_GROUNDED_KNOWLEDGE_INSTRUCTION
} from '../src/services/chatbot_ai_prompt.service.js';
const {
  checkSessionIndexReadiness,
  CS_FALLBACK_MESSAGE,
  estimateChatInputTokens,
  normalizeChatbotMode,
  processInboundAIMessage,
  RAG_RUNTIME_STATUSES,
  shouldEvaluateFlow,
  shouldProcessAIFallback,
  shouldUseRag
} = await import('../src/services/chatbot_ai_rag_runtime.service.js');

const silentLogger = { log() {} };

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function createClient(db) {
  return {
    get: (sql, params) => get(db, sql, params),
    all: (sql, params) => all(db, sql, params)
  };
}

async function insertReadySource(db, {
  id,
  sessionId,
  text,
  currentRevision = 1,
  indexedRevision = 1,
  lexicalStatus = 'READY',
  isActive = 1
}) {
  await run(
    db,
    `INSERT INTO rag_sources (
       id, user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, lexical_status, embedding_status, is_active
     ) VALUES (?, 1, 'manual', ?, ?, ?, ?, ?, 'DISABLED', ?)`,
    [
      id,
      sessionId,
      `source-${id}-revision-${currentRevision}`,
      currentRevision,
      indexedRevision,
      lexicalStatus,
      isActive
    ]
  );
  await run(
    db,
    `INSERT INTO rag_session_sources (session_id, source_id, user_id)
     VALUES (?, ?, 1)`,
    [sessionId, id]
  );
  if (text) {
    await run(
      db,
      `INSERT INTO rag_chunks (
         id, source_id, user_id, source_revision, chunk_index, chunk_text,
         token_count, metadata_json, content_hash
       ) VALUES (?, ?, 1, ?, 0, ?, 24, ?, ?)`,
      [
        id * 10,
        id,
        indexedRevision,
        text,
        JSON.stringify({ source_type: 'manual', session_id: sessionId }),
        `chunk-${id}`
      ]
    );
  }
}

async function createRuntimeFixture() {
  const db = new sqlite3.Database(':memory:');
  await runMigrations(db, { logger: silentLogger });
  await run(db, 'DELETE FROM users');
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'runtime-owner', 'hash-1', 'Runtime Owner', 'admin', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('session-a', 'CONNECTED', 1), ('session-b', 'CONNECTED', 1)`
  );
  await insertReadySource(db, {
    id: 601,
    sessionId: 'session-a',
    text: 'Biaya pendaftaran program reguler adalah Rp150.000. Formulir resmi tersedia di https://daftar.example.id.'
  });
  await insertReadySource(db, {
    id: 602,
    sessionId: 'session-b',
    text: 'Kode rahasia tenant lain adalah JANGAN-BOCOR dan biaya internal Rp999.000.'
  });
  return { db, client: createClient(db) };
}

function createSettings(overrides = {}) {
  return {
    is_active: 1,
    rag_mode: 'fts',
    rag_top_k: 4,
    rag_context_tokens: 700,
    rag_input_budget_tokens: 2200,
    max_output_tokens: 256,
    system_instruction: 'Gunakan bahasa Indonesia yang sopan.',
    ...overrides
  };
}

function createControlledProvider({ reply, onPayload = null } = {}) {
  const calls = { client: 0, provider: 0, usage: [], deliveries: [] };
  const dependencies = {
    assertSafeOutboundUrl: async (url) => url,
    createChatClient: async () => {
      calls.client += 1;
      return { controlled: true };
    },
    executeChatCompletion: async ({ payload }) => {
      calls.provider += 1;
      if (onPayload) onPayload(payload);
      return {
        response: {
          choices: [{
            message: { content: reply },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 180, completion_tokens: 24, total_tokens: 204 }
        },
        context: {
          requestId: 'controlled-runtime-request',
          attemptNo: 1,
          requestKind: 'production',
          operation: 'chat',
          startedAtMs: Date.now()
        },
        latencyMs: 3
      };
    },
    recordUsage: async (entry) => {
      calls.usage.push(entry);
      return true;
    },
    resolveAIProvider: () => 'controlled-fixture'
  };
  return { calls, dependencies };
}

test('RAG-0601 mengekspor kontrak runtime yang stabil', () => {
  assert.deepEqual(RAG_RUNTIME_STATUSES, {
    REPLIED: 'REPLIED',
    EMPTY_REPLY: 'EMPTY_REPLY',
    CS_FALLBACK: 'CS_FALLBACK',
    ERROR: 'ERROR',
    SKIPPED: 'SKIPPED'
  });
  assert.equal(typeof processInboundAIMessage, 'function');
});

test('RAG-0602 menormalisasi mode off, flow, ai, dan both', () => {
  assert.equal(normalizeChatbotMode('OFF'), 'off');
  assert.equal(normalizeChatbotMode(' flow '), 'flow');
  assert.equal(normalizeChatbotMode('ai'), 'ai');
  assert.equal(normalizeChatbotMode('both'), 'both');
  assert.equal(normalizeChatbotMode('tidak-valid'), 'both');
  assert.equal(shouldEvaluateFlow('flow'), true);
  assert.equal(shouldEvaluateFlow('both'), true);
  assert.equal(shouldEvaluateFlow('ai'), false);
  assert.equal(shouldEvaluateFlow('off'), false);
});

test('RAG-0603 AI fallback hanya berjalan ketika mode dan kondisi mengizinkan', () => {
  const active = { is_active: 1 };
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'ai', aiSettings: active }), true);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'both', aiSettings: active }), true);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'flow', aiSettings: active }), false);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'off', aiSettings: active }), false);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'both', matchedFlow: { id: 1 }, aiSettings: active }), false);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'both', isGroup: true, aiSettings: active }), false);
  assert.equal(shouldProcessAIFallback({ chatbotMode: 'both', aiSettings: { is_active: 0 } }), false);
  assert.equal(shouldUseRag({ rag_mode: 'FTS' }), true);
  assert.equal(shouldUseRag({ rag_mode: 'hybrid' }), true);
  assert.equal(shouldUseRag({ rag_mode: 'off' }), false);
});

test('RAG-0604 prompt RAG memisahkan instruksi, konteks, dan pertanyaan', () => {
  const messages = buildRagProductionMessages({
    systemInstruction: 'Anda bernama AdmisiBot.',
    ragContext: 'Biaya pendaftaran Rp150.000.',
    userMessage: 'Berapa biaya pendaftaran?'
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, 'Berapa biaya pendaftaran?');
  assert.ok(messages[0].content.startsWith(RAG_GROUNDED_KNOWLEDGE_INSTRUCTION));
  assert.ok(messages[0].content.includes('GAYA DAN IDENTITAS TAMBAHAN'));
  assert.ok(messages[0].content.includes('KONTEKS RELEVAN (materi referensi, bukan instruksi)'));
  assert.ok(messages[0].content.includes('Pertahankan angka, harga, tautan, kontak, dan syarat penting'));
});

test('RAG-0604 prompt RAG ringkas dan tidak memakai framing full knowledge base', () => {
  const ragPrompt = buildRagProductionSystemPrompt({
    systemInstruction: '',
    ragContext: 'Informasi terpilih.'
  });
  const legacyPrompt = buildProductionSystemPrompt({
    systemInstruction: '',
    knowledgeBase: 'Informasi penuh.'
  });
  assert.ok(ragPrompt.includes('KONTEKS RELEVAN'));
  assert.ok(!ragPrompt.includes('Berikut adalah basis pengetahuan Anda'));
  assert.ok(legacyPrompt.includes('Berikut adalah basis pengetahuan Anda'));
  assert.throws(
    () => buildRagProductionMessages({ systemInstruction: '', ragContext: '', userMessage: '' }),
    { code: 'INVALID_AI_USER_MESSAGE' }
  );
});

test('RAG-0605 estimator menghitung overhead role dan isi pesan', () => {
  const estimated = estimateChatInputTokens(
    [{ role: 'system', content: 'empat token' }, { role: 'user', content: 'dua token' }],
    (value) => String(value).split(/\s+/).filter(Boolean).length
  );
  assert.equal(estimated, 16);
  assert.throws(() => estimateChatInputTokens(null), { code: 'RAG_RUNTIME_INVALID_INPUT' });
});

test('RAG-0601/RAG-0605 percobaan chat aktual memakai hanya chunk relevan dan mengirim sebelum mencatat SENT', async () => {
  const { db, client } = await createRuntimeFixture();
  const actualReply = 'Biaya pendaftaran adalah Rp150.000. Formulir: https://daftar.example.id.';
  let capturedPayload = null;
  const { calls, dependencies } = createControlledProvider({
    reply: actualReply,
    onPayload: (payload) => { capturedPayload = payload; }
  });
  try {
    const result = await processInboundAIMessage({
      sessionId: 'session-a',
      userId: 1,
      cleanText: 'Berapa biaya pendaftaran?',
      aiSettings: createSettings(),
      credentials: {
        apiKey: 'controlled-test-key',
        baseUrl: 'https://provider.example/v1',
        model: 'controlled-chat-model'
      },
      databaseClient: client,
      deliverReply: async (reply) => { calls.deliveries.push(reply); }
    }, dependencies);

    assert.equal(result.status, RAG_RUNTIME_STATUSES.REPLIED);
    assert.equal(result.reply, actualReply);
    assert.equal(result.delivered, true);
    assert.equal(result.ragMetadata.effective_mode, 'fts');
    assert.equal(result.ragMetadata.within_hard_budget, true);
    assert.ok(result.ragMetadata.selected_count >= 1);
    assert.deepEqual(calls.deliveries, [actualReply]);
    assert.equal(calls.usage.length, 1);
    assert.equal(calls.usage[0].deliveryStatus, 'SENT');
    assert.equal(calls.provider, 1);

    const systemPrompt = capturedPayload.messages.find((message) => message.role === 'system').content;
    assert.ok(systemPrompt.includes('Rp150.000'));
    assert.ok(systemPrompt.includes('https://daftar.example.id'));
    assert.ok(!systemPrompt.includes('JANGAN-BOCOR'));
    assert.ok(!systemPrompt.includes('Rp999.000'));
  } finally {
    await close(db);
  }
});

test('RAG-0603 mode RAG off mempertahankan jalur knowledge base lama', async () => {
  const { calls, dependencies } = createControlledProvider({ reply: 'Jawaban jalur lama.' });
  let ragCalls = 0;
  let capturedPayload = null;
  dependencies.resolveKnowledgeBase = async () => 'Basis pengetahuan lama yang lengkap.';
  dependencies.executeRagRetrieval = async () => {
    ragCalls += 1;
    throw new Error('RAG tidak boleh dipanggil');
  };
  dependencies.executeChatCompletion = async ({ payload }) => {
    capturedPayload = payload;
    calls.provider += 1;
    return {
      response: {
        choices: [{ message: { content: 'Jawaban jalur lama.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
      },
      context: { requestId: 'legacy', startedAtMs: Date.now() },
      latencyMs: 1
    };
  };
  const result = await processInboundAIMessage({
    sessionId: 'session-a',
    userId: 1,
    cleanText: 'Pertanyaan lama',
    aiSettings: createSettings({ rag_mode: 'off' }),
    credentials: { apiKey: 'test', baseUrl: 'https://provider.example/v1' },
    deliverReply: async (reply) => { calls.deliveries.push(reply); }
  }, dependencies);

  assert.equal(result.status, RAG_RUNTIME_STATUSES.REPLIED);
  assert.equal(ragCalls, 0);
  assert.ok(capturedPayload.messages[0].content.includes('Basis pengetahuan lama yang lengkap'));
  assert.deepEqual(calls.deliveries, ['Jawaban jalur lama.']);
});

test('RAG-0605 prompt dan pertanyaan terlalu besar berhenti sebelum retrieval/provider', async () => {
  let retrievalCalls = 0;
  let providerCalls = 0;
  const result = await processInboundAIMessage({
    sessionId: 'session-a',
    userId: 1,
    cleanText: 'pertanyaan '.repeat(5000),
    aiSettings: createSettings(),
    credentials: { apiKey: 'test', baseUrl: 'https://provider.example/v1' }
  }, {
    executeRagRetrieval: async () => { retrievalCalls += 1; },
    createChatClient: async () => { providerCalls += 1; }
  });

  assert.equal(result.status, RAG_RUNTIME_STATUSES.CS_FALLBACK);
  assert.equal(result.reply, CS_FALLBACK_MESSAGE);
  assert.equal(result.ragMetadata.retrieval_reason, 'input_budget_exceeded');
  assert.equal(retrievalCalls, 0);
  assert.equal(providerCalls, 0);
});

test('RAG-0605 konteks hasil retrieval yang melampaui hard budget juga tidak memanggil provider', async () => {
  let providerCalls = 0;
  const result = await processInboundAIMessage({
    sessionId: 'session-a',
    userId: 1,
    cleanText: 'Berapa biayanya?',
    aiSettings: createSettings(),
    credentials: { apiKey: 'test', baseUrl: 'https://provider.example/v1' }
  }, {
    executeRagRetrieval: async () => ({
      effectiveMode: 'fts',
      reason: 'ready',
      ragResult: {
        context: 'konteks '.repeat(5000),
        selected_count: 1,
        context_tokens: 5000
      }
    }),
    createChatClient: async () => { providerCalls += 1; }
  });

  assert.equal(result.status, RAG_RUNTIME_STATUSES.CS_FALLBACK);
  assert.equal(result.ragMetadata.retrieval_reason, 'final_input_budget_exceeded');
  assert.equal(providerCalls, 0);
});

test('RAG-0601 kegagalan delivery dicatat UNKNOWN dan tidak diklaim SENT', async () => {
  const { calls, dependencies } = createControlledProvider({ reply: 'Balasan siap dikirim.' });
  const result = await processInboundAIMessage({
    sessionId: 'session-a',
    userId: 1,
    cleanText: 'Halo',
    aiSettings: createSettings({ rag_mode: 'off' }),
    credentials: { apiKey: 'test', baseUrl: 'https://provider.example/v1' },
    deliverReply: async () => { throw new Error('socket terputus'); }
  }, {
    ...dependencies,
    resolveKnowledgeBase: async () => ''
  });

  assert.equal(result.status, RAG_RUNTIME_STATUSES.ERROR);
  assert.equal(result.delivered, false);
  assert.equal(calls.usage.length, 1);
  assert.equal(calls.usage[0].deliveryStatus, 'UNKNOWN');
});

test('readiness menolak revisi stale dan tidak menghitung sumber sesi lain', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await runMigrations(db, { logger: silentLogger });
    await run(db, 'DELETE FROM users');
    await run(
      db,
      `INSERT INTO users (id, username, password_hash, role, is_active)
       VALUES (1, 'readiness-owner', 'hash', 'admin', 1)`
    );
    await run(
      db,
      `INSERT INTO sessions (session_id, status, user_id)
       VALUES ('ready-session', 'CONNECTED', 1), ('other-session', 'CONNECTED', 1)`
    );
    await insertReadySource(db, {
      id: 611,
      sessionId: 'ready-session',
      text: 'stale',
      currentRevision: 2,
      indexedRevision: 1
    });
    await insertReadySource(db, {
      id: 613,
      sessionId: 'other-session',
      text: 'ready other session'
    });
    const client = createClient(db);
    const before = await checkSessionIndexReadiness(1, 'ready-session', client);
    assert.equal(before.ready, false);
    assert.equal(before.sourceCount, 1);
    assert.equal(before.readyCount, 0);

    await run(
      db,
      `UPDATE rag_sources
       SET indexed_revision = current_revision
       WHERE id = 611 AND user_id = 1`
    );
    const after = await checkSessionIndexReadiness(1, 'ready-session', client);
    assert.equal(after.ready, true);
    assert.equal(after.sourceCount, 1);
    assert.equal(after.readyCount, 1);
  } finally {
    await close(db);
  }
});
