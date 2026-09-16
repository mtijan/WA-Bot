import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import {
  auditRagEvaluationEvidence,
  evaluateRagGenerationOutcomes,
  sanitizeRagEvaluationTranscript
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import { buildRagRuntimeEvent } from '../src/services/chatbot_ai_rag_telemetry.service.js';

const RATES = Object.freeze({
  input_usd_per_million: 0.03,
  cached_input_usd_per_million: 0.015,
  output_usd_per_million: 0.12
});

function answerRecord({
  id,
  profile,
  answer,
  inputTokens,
  outputTokens,
  retrievalLatencyMs,
  providerLatencyMs,
  totalLatencyMs,
  judgement = { groundedness: 5, unsupported_claim: false }
}) {
  return {
    id,
    profile,
    category: 'exact',
    answerable: true,
    required_claims: ['Rp150.000'],
    answer,
    status: 'SUCCEEDED',
    provider_called: true,
    provider_attempts: 1,
    judgement,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: 0,
    retrieval_latency_ms: retrievalLatencyMs,
    provider_latency_ms: providerLatencyMs,
    total_latency_ms: totalLatencyMs
  };
}

function negativeRecord({ id, profile, inputTokens = null, outputTokens = null }) {
  const providerCalled = profile === 'CURRENT_FULL_KB';
  return {
    id,
    profile,
    category: 'out_of_scope',
    answerable: false,
    required_claims: [],
    answer: 'Silakan hubungi customer service.',
    status: providerCalled ? 'SUCCEEDED' : 'CS_FALLBACK',
    provider_called: providerCalled,
    provider_attempts: providerCalled ? 1 : 0,
    behavior_pass: true,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    retrieval_latency_ms: profile === 'RAG_HYBRID' ? 3 : 0,
    provider_latency_ms: providerCalled ? 80 : null,
    total_latency_ms: providerCalled ? 82 : 3
  };
}

test('RAG-0906 mengukur groundedness, hallucination, claim coverage, dan useful coverage', () => {
  const result = evaluateRagGenerationOutcomes([
    answerRecord({
      id: 'EX-01', profile: 'CURRENT_FULL_KB', answer: 'Biayanya Rp150.000.',
      inputTokens: 1000, outputTokens: 30, retrievalLatencyMs: 0,
      providerLatencyMs: 120, totalLatencyMs: 121
    }),
    answerRecord({
      id: 'EX-01', profile: 'RAG_HYBRID', answer: 'Biayanya Rp150.000.',
      inputTokens: 200, outputTokens: 25, retrievalLatencyMs: 4,
      providerLatencyMs: 90, totalLatencyMs: 95
    }),
    negativeRecord({ id: 'OS-01', profile: 'CURRENT_FULL_KB', inputTokens: 980, outputTokens: 20 }),
    negativeRecord({ id: 'OS-01', profile: 'RAG_HYBRID' })
  ], { rates: RATES });

  assert.equal(result.cases, 2);
  assert.equal(result.profiles.RAG_HYBRID.groundedness_rate, 1);
  assert.equal(result.profiles.RAG_HYBRID.judge_coverage_rate, 1);
  assert.equal(result.profiles.RAG_HYBRID.groundedness_rate_valid_judgements, 1);
  assert.equal(result.profiles.RAG_HYBRID.hallucination_rate, 0);
  assert.equal(result.profiles.RAG_HYBRID.required_claim_coverage_rate, 1);
  assert.equal(result.profiles.RAG_HYBRID.useful_coverage_rate, 1);
});

test('RAG-0906 menerima Markdown dan bentuk persen ekuivalen tanpa melonggarkan fakta wajib', () => {
  const records = [
    {
      ...answerRecord({
        id: 'EX-09', profile: 'RAG_HYBRID',
        answer: '**Potongan biaya kuliah** sebesar **50%**.',
        inputTokens: 200, outputTokens: 20, retrievalLatencyMs: 2,
        providerLatencyMs: 80, totalLatencyMs: 82
      }),
      required_claims: ['potongan biaya kuliah 50 persen']
    },
    {
      ...answerRecord({
        id: 'EX-11', profile: 'CURRENT_FULL_KB',
        answer: 'Gunakan **portal belajar** setiap hari **Sabtu**.',
        inputTokens: 300, outputTokens: 20, retrievalLatencyMs: 0,
        providerLatencyMs: 90, totalLatencyMs: 90
      }),
      required_claims: ['portal belajar', 'hari Sabtu']
    }
  ];
  const result = evaluateRagGenerationOutcomes(records, { rates: RATES });
  assert.equal(result.profiles.RAG_HYBRID.required_claim_coverage_rate, 1);
  assert.equal(result.profiles.CURRENT_FULL_KB.required_claim_coverage_rate, 1);
});

test('RAG-0906 menghitung judgement invalid sebagai belum terbukti grounded', () => {
  const record = answerRecord({
    id: 'EX-01', profile: 'RAG_HYBRID', answer: 'Biayanya Rp150.000.',
    inputTokens: 200, outputTokens: 20, retrievalLatencyMs: 2,
    providerLatencyMs: 80, totalLatencyMs: 82, judgement: null
  });
  const result = evaluateRagGenerationOutcomes([record], { rates: RATES });
  assert.equal(result.profiles.RAG_HYBRID.valid_judgements, 0);
  assert.equal(result.profiles.RAG_HYBRID.judge_coverage_rate, 0);
  assert.equal(result.profiles.RAG_HYBRID.groundedness_rate, 0);
  assert.equal(result.profiles.RAG_HYBRID.useful_outcomes, 0);
});

test('RAG-0907/RAG-0908 membandingkan token dan biaya all-in per outcome berguna', () => {
  const result = evaluateRagGenerationOutcomes([
    answerRecord({
      id: 'EX-01', profile: 'CURRENT_FULL_KB', answer: 'Biayanya Rp150.000.',
      inputTokens: 1000, outputTokens: 30, retrievalLatencyMs: 0,
      providerLatencyMs: 120, totalLatencyMs: 121
    }),
    answerRecord({
      id: 'EX-01', profile: 'RAG_HYBRID', answer: 'Biayanya Rp150.000.',
      inputTokens: 200, outputTokens: 25, retrievalLatencyMs: 4,
      providerLatencyMs: 90, totalLatencyMs: 95
    })
  ], {
    rates: RATES,
    embeddingCostUsd: { CURRENT_FULL_KB: 0, RAG_HYBRID: 0.000001 }
  });

  assert.equal(result.comparison.answerable_input_token_reduction_rate, 0.8);
  assert.ok(result.comparison.all_in_cost_reduction_rate > 0.6);
  assert.equal(result.profiles.RAG_HYBRID.cost_usd.embedding, 0.000001);
  assert.equal(result.profiles.RAG_HYBRID.cost_usd.usage_known_calls, 1);
  assert.equal(result.profiles.RAG_HYBRID.retry_attempts, 0);
  assert.equal(result.profiles.RAG_HYBRID.cost_usd.retry_incremental, 0);
});

test('RAG-0909 menghitung p50/p95 retrieval, provider, dan total tanpa mencampur nilai unknown', () => {
  const records = [];
  for (let index = 1; index <= 20; index += 1) {
    records.push(answerRecord({
      id: `EX-${String(index).padStart(2, '0')}`,
      profile: 'CURRENT_FULL_KB',
      answer: 'Biayanya Rp150.000.', inputTokens: 1000, outputTokens: 20,
      retrievalLatencyMs: 0, providerLatencyMs: index * 10, totalLatencyMs: index * 10 + 1
    }));
    records.push(answerRecord({
      id: `EX-${String(index).padStart(2, '0')}`,
      profile: 'RAG_HYBRID',
      answer: 'Biayanya Rp150.000.', inputTokens: 200, outputTokens: 20,
      retrievalLatencyMs: index, providerLatencyMs: index * 5, totalLatencyMs: index * 6
    }));
  }
  const result = evaluateRagGenerationOutcomes(records, { rates: RATES });
  assert.equal(result.profiles.RAG_HYBRID.latency_ms.retrieval.p50_ms, 10);
  assert.equal(result.profiles.RAG_HYBRID.latency_ms.retrieval.p95_ms, 19);
  assert.equal(result.profiles.RAG_HYBRID.latency_ms.provider.p95_ms, 95);
  assert.equal(result.profiles.RAG_HYBRID.latency_ms.total.p95_ms, 114);
});

test('RAG-0910 transcript sanitizer dan runtime event allowlist tidak membocorkan nilai sensitif', () => {
  const raw = [
    'Kontak 0812-0000-1234',
    '628123456789@s.whatsapp.net',
    'admin@example.test',
    'C:\\private\\persona.txt',
    'sk-phase9-supersecret123456'
  ].join('\n');
  const sanitized = sanitizeRagEvaluationTranscript(raw);
  assert.match(sanitized, /\[PHONE\]/);
  assert.match(sanitized, /\[JID\]/);
  assert.match(sanitized, /\[EMAIL\]/);
  assert.match(sanitized, /\[LOCAL_PATH\]/);
  assert.match(sanitized, /\[SECRET\]/);

  const event = buildRagRuntimeEvent({
    userId: 1,
    totalLatencyMs: 25,
    result: {
      status: 'REPLIED',
      delivered: true,
      reply: raw,
      error: raw,
      usageContext: { requestId: '11111111-1111-4111-8111-111111111111' },
      ragMetadata: {
        rag_mode: 'hybrid', effective_mode: 'hybrid', retrieval_reason: 'ready',
        selected_count: 2, retrieval_latency_ms: 4, provider_latency_ms: 20,
        shadow_enabled: true, shadow_effective_mode: 'fts',
        shadow_retrieval_reason: 'ready', shadow_selected_count: 1,
        shadow_retrieval_latency_ms: 3, shadow_session_id: raw,
        rollback_mode: 'fts', legacy_full_kb_enabled: false,
        prompt: raw, knowledge_base: raw, session_id: raw
      }
    }
  });
  const audit = auditRagEvaluationEvidence({ sanitized, event }, [
    { label: 'phone', value: '0812-0000-1234' },
    { label: 'jid', value: '628123456789@s.whatsapp.net' },
    { label: 'email', value: 'admin@example.test' },
    { label: 'path', value: 'C:\\private\\persona.txt' },
    { label: 'api_key', value: 'sk-phase9-supersecret123456' }
  ]);
  assert.deepEqual(audit, { passed: true, detected_labels: [] });
  assert.deepEqual(Object.keys(event).sort(), [
    'ai_call_avoided', 'cache_hit', 'chunk_count', 'conversational_fallback',
    'debounced', 'debounced_count', 'delivered', 'direct_answer', 'embedding_fallback',
    'event', 'legacy_full_kb_enabled', 'provider_latency_ms', 'query_kind', 'rag_mode', 'relevance_threshold',
    'request_id', 'retrieval_latency_ms', 'retrieval_reason', 'retrieval_type', 'rollback_mode',
    'shadow_chunk_count', 'shadow_embedding_fallback', 'shadow_enabled',
    'shadow_query_kind', 'shadow_relevance_threshold', 'shadow_retrieval_latency_ms',
    'shadow_retrieval_reason', 'shadow_retrieval_type', 'shadow_threshold_source',
    'status', 'threshold_source', 'total_latency_ms', 'user_id'
  ]);
});
