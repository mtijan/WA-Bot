import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRagConversationalFallbackMessages
} from '../src/services/chatbot_ai_prompt.service.js';
import {
  buildRagPreflightDiagnostic,
  classifyRagConversationQuery,
  RAG_AUTO_CONFIGURATION,
  RAG_RETENTION_POLICY,
  resolveRagAutoConfiguration,
  resolveRagQueryPolicy
} from '../src/services/chatbot_ai_rag_policy.service.js';
import {
  processInboundAIMessage,
  RAG_RUNTIME_STATUSES
} from '../src/services/chatbot_ai_rag_runtime.service.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  retrieveRagEvaluationContext
} from './helpers/rag_retrieval_evaluation_fixture.js';

function controlledCompletion(reply = 'Halo! Senang bertemu dengan Anda. Ada yang bisa saya bantu?') {
  const calls = { provider: 0, payloads: [], events: [] };
  return {
    calls,
    dependencies: {
      assertSafeOutboundUrl: async (url) => url,
      createChatClient: async () => ({}),
      executeChatCompletion: async ({ payload }) => {
        calls.provider += 1;
        calls.payloads.push(payload);
        return {
          response: {
            id: 'phase9-completion-fixture',
            choices: [{ finish_reason: 'stop', message: { content: reply } }],
            usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 }
          },
          context: {
            requestId: '11111111-1111-4111-8111-111111111111',
            attemptNo: 1,
            requestKind: 'production',
            operation: 'chat',
            startedAtMs: Date.now()
          },
          latencyMs: 4
        };
      },
      recordUsage: async () => true,
      recordRuntimeEvent: async (event) => calls.events.push(event),
      resolveAIProvider: () => 'controlled-fixture',
      recheckDeliveryAccess: async () => ({ allowed: true, reason: 'OK' })
    }
  };
}

function runtimeParams(cleanText) {
  return {
    sessionId: 'phase9-session',
    userId: 1,
    cleanText,
    aiSettings: {
      is_active: 1,
      rag_mode: 'hybrid',
      rag_top_k: 4,
      rag_context_tokens: 1000,
      rag_input_budget_tokens: 2200,
      max_output_tokens: 512,
      temperature: 0.3,
      system_instruction: 'Anda adalah AdmisiBot yang ramah.',
      cache_enabled: 0
    },
    credentials: {
      apiKey: 'controlled-fixture-key',
      baseUrl: 'https://provider.example/v1',
      model: 'controlled-model'
    }
  };
}

describe('RAG-0911 privacy and retention policy', () => {
  it('mengunci retensi bounded dan melarang penyimpanan query embedding/prompt mentah', () => {
    assert.deepEqual(RAG_RETENTION_POLICY, {
      response_cache_max_seconds: 86400,
      usage_days: 30,
      completed_index_job_days: 7,
      source_embeddings: 'SOURCE_LIFECYCLE',
      query_embeddings: 'TRANSIENT_NOT_STORED',
      prompt_and_reply_logging: 'PROHIBITED',
      pii_response_cache: 'PROHIBITED'
    });
  });
});

describe('RAG-0913 auto-configuration and pre-flight', () => {
  it('menerapkan konfigurasi aman saat mode RAG pertama kali diaktifkan', () => {
    const result = resolveRagAutoConfiguration({
      requestedMode: 'hybrid',
      previousMode: 'off',
      payload: { rag_top_k: 5 }
    });
    assert.equal(result.activating, true);
    assert.equal(result.applied.rag_top_k, 5);
    assert.equal(result.applied.rag_context_tokens, RAG_AUTO_CONFIGURATION.rag_context_tokens);
    assert.equal(result.applied.cache_enabled, 0);
    assert.equal(result.applied.direct_answer_enabled, 1);
  });

  it('melaporkan blocking, fallback FTS, dan READY secara deterministik', () => {
    const blocked = buildRagPreflightDiagnostic({
      status: { rag_mode: 'hybrid', sources_count: 0, chunks_count: 0 },
      settings: { rag_mode: 'hybrid', cache_enabled: 0, cache_ttl_seconds: 86400 }
    });
    assert.equal(blocked.state, 'BLOCKED');
    assert.deepEqual(blocked.blocking_codes, ['SOURCE_AVAILABLE', 'CHUNK_AVAILABLE', 'LEXICAL_READY']);

    const lexical = buildRagPreflightDiagnostic({
      status: {
        rag_mode: 'hybrid', sources_count: 1, chunks_count: 4,
        lexical_ready: true, embedding_ready: false, active_job: null
      },
      settings: { rag_mode: 'hybrid', cache_enabled: 0, cache_ttl_seconds: 86400 }
    });
    assert.equal(lexical.state, 'READY_WITH_WARNINGS');
    assert.equal(lexical.ready, true);
    assert.equal(lexical.effective_mode, 'fts');
    assert.deepEqual(lexical.warning_codes, ['EMBEDDING_READY']);
  });
});

describe('RAG-0914 graceful conversational fallback', () => {
  it('membedakan sapaan murni dari sapaan yang memuat pertanyaan bisnis', () => {
    assert.deepEqual(classifyRagConversationQuery('Halo!'), { kind: 'social', reason: 'social_pattern' });
    assert.deepEqual(classifyRagConversationQuery('Halo kak'), { kind: 'social', reason: 'social_pattern' });
    assert.deepEqual(classifyRagConversationQuery('Selamat pagi kak'), { kind: 'social', reason: 'social_pattern' });
    assert.deepEqual(classifyRagConversationQuery('Halo, biaya pendaftarannya berapa?'), { kind: 'knowledge', reason: 'business_marker' });
    assert.equal(resolveRagQueryPolicy({ query: 'Makasih ya', mode: 'hybrid', hasQueryVector: true }).should_retrieve, false);
  });

  it('menjawab sapaan melalui persona-only provider tanpa retrieval atau CS palsu', async () => {
    const { calls, dependencies } = controlledCompletion();
    const sent = [];
    const result = await processInboundAIMessage({
      ...runtimeParams('Halo!'),
      deliverReply: async (reply) => sent.push(reply)
    }, {
      ...dependencies,
      executeRagRetrieval: async () => assert.fail('sapaan murni tidak boleh menjalankan retrieval'),
      resolveKnowledgeBase: async () => assert.fail('full KB tidak boleh dimuat')
    });
    assert.equal(result.status, RAG_RUNTIME_STATUSES.REPLIED);
    assert.equal(result.ragMetadata.effective_mode, 'conversation');
    assert.equal(result.ragMetadata.conversational_fallback, true);
    assert.equal(calls.provider, 1);
    assert.deepEqual(sent, ['Halo! Senang bertemu dengan Anda. Ada yang bisa saya bantu?']);
    const serializedMessages = JSON.stringify(calls.payloads[0].messages);
    assert.match(serializedMessages, /basa-basi ringan/u);
    assert.doesNotMatch(serializedMessages, /Rp150\.000|KONTEKS RELEVAN/u);
  });

  it('prompt persona-only melarang fakta bisnis yang tidak memiliki context', () => {
    const messages = buildRagConversationalFallbackMessages({
      systemInstruction: 'Anda bernama AdmisiBot.',
      userMessage: 'Apa kabar?'
    });
    assert.match(messages[0].content, /Jangan mengarang fakta bisnis/u);
    assert.match(messages[0].content, /AdmisiBot/u);
    assert.equal(messages[1].content, 'Apa kabar?');
  });
});

describe('RAG-0915 calibrated dynamic threshold', () => {
  it('memakai 0.7571067 untuk Hybrid, 0 untuk FTS, dan bypass untuk social chat', () => {
    const hybrid = resolveRagQueryPolicy({
      query: 'Kalau mau mendaftar perlu dokumen apa?',
      mode: 'hybrid',
      hasQueryVector: true
    });
    assert.equal(hybrid.relevance_threshold, 0.7571067);
    assert.equal(hybrid.threshold_source, 'calibrated_hybrid');
    assert.equal(resolveRagQueryPolicy({
      query: 'Kalau mau mendaftar perlu dokumen apa?', mode: 'fts', hasQueryVector: false
    }).relevance_threshold, 0);
    assert.equal(resolveRagQueryPolicy({
      query: 'Halo', mode: 'hybrid', hasQueryVector: true
    }).threshold_source, 'conversational_bypass');
  });

  it('0.7571 mempertahankan contextual greeting relevan dan menolak weak false positive 0.45', async () => {
    const { db, client } = await createRagEvaluationFixture();
    try {
      const contextual = {
        query: 'Halo, biaya pendaftaran program reguler berapa?',
        vector: [1, 0, 0, 0, 0, 0, 0, 0]
      };
      const contextualResult = await retrieveRagEvaluationContext(contextual, client, {
        relevanceThreshold: 0.7571067
      });
      assert.equal(contextualResult.results[0].source_id, 301);

      const weak = {
        query: 'Halo, saya ingin tahu info itu',
        vector: [0.45, ...Array(7).fill(Math.sqrt((1 - (0.45 ** 2)) / 7))]
      };
      const permissive = await retrieveRagEvaluationContext(weak, client, { relevanceThreshold: 0.4 });
      const calibrated = await retrieveRagEvaluationContext(weak, client, { relevanceThreshold: 0.7571067 });
      assert.ok(permissive.selected_count > 0);
      assert.equal(calibrated.selected_count, 0);
    } finally {
      await closeRagEvaluationFixture(db);
    }
  });
});
