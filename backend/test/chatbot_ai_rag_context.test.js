import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RAG_CONTEXT_DEFAULTS,
  buildRagProvenance,
  filterRagResultsByRelevance,
  selectRagContext
} from '../src/services/chatbot_ai_rag_context.service.js';
import { calibrateRagRelevanceThreshold } from '../src/services/chatbot_ai_rag_evaluation.service.js';

function candidate(id, text, relevanceScore = 0.9, metadata = {}) {
  return {
    chunk_id: id * 10,
    source_id: id,
    source_type: 'flow',
    source_revision: 1,
    chunk_index: 0,
    chunk_text: text,
    relevance_score: relevanceScore,
    metadata
  };
}

test('RAG-0506 membatasi Top-K ke maksimum 5 dan context ke 1.000 token', () => {
  const results = Array.from({ length: 8 }, (_, index) => candidate(
    index + 1,
    `Informasi sumber ${index + 1} berisi jawaban singkat yang relevan.`
  ));
  const selected = selectRagContext(results, {
    topK: 99,
    contextTokenBudget: 5000,
    baseInputTokens: 100
  });

  assert.equal(selected.applied_top_k, RAG_CONTEXT_DEFAULTS.MAX_TOP_K);
  assert.equal(selected.selected_count, 5);
  assert.ok(selected.context_tokens <= RAG_CONTEXT_DEFAULTS.CONTEXT_TOKEN_BUDGET);
  assert.equal(selected.within_target, true);
  assert.ok(selected.estimated_total_input_tokens <= selected.hard_total_input_tokens);
});

test('RAG-0506 melewati chunk utuh yang melampaui hard input budget', () => {
  const selected = selectRagContext([
    candidate(1, 'kata '.repeat(800)),
    candidate(2, 'Jawaban singkat yang masih muat.')
  ], {
    topK: 4,
    contextTokenBudget: 1000,
    baseInputTokens: 2100,
    hardTotalInputTokens: 2200
  });

  assert.equal(selected.selected_count, 1);
  assert.equal(selected.results[0].source_id, 2);
  assert.ok(selected.estimated_total_input_tokens <= 2200);
});

test('RAG-0508 provenance aman dan tidak membawa metadata tenant sensitif', () => {
  const provenance = buildRagProvenance(candidate(7, 'Isi', 0.9, {
    flow_id: 7,
    flow_name: 'Admisi\nUtama',
    node_id: 'node-1',
    branch_path: ['root', 'price'],
    session_id: 'private-session',
    jid: '628100000000@s.whatsapp.net',
    proxy_password: 'secret'
  }));

  assert.deepEqual(provenance, {
    source_id: 7,
    source_type: 'flow',
    source_revision: 1,
    chunk_index: 0,
    flow_id: 7,
    flow_name: 'Admisi Utama',
    node_id: 'node-1',
    branch_path: ['root', 'price']
  });
  assert.equal('session_id' in provenance, false);
  assert.equal('jid' in provenance, false);
  assert.equal('proxy_password' in provenance, false);
});

test('RAG-0509 mengembalikan context kosong bila semua skor di bawah threshold', () => {
  const relevant = filterRagResultsByRelevance([
    candidate(1, 'Tidak cukup relevan', 0.4),
    candidate(2, 'Juga tidak cukup relevan', 0.69)
  ], { threshold: 0.7 });
  const selected = selectRagContext(relevant);

  assert.deepEqual(relevant, []);
  assert.equal(selected.context, '');
  assert.equal(selected.selected_count, 0);
  assert.equal(selected.reason, 'no_relevant_chunks');
});

test('RAG-0507 mengkalibrasi threshold dengan recall dan false-positive guard', () => {
  const calibration = calibrateRagRelevanceThreshold([
    { expected_relevant: true, top_score: 1 },
    { expected_relevant: true, top_score: 0.76 },
    { expected_relevant: true, top_score: 0.82 },
    { expected_relevant: false, top_score: 0 },
    { expected_relevant: false, top_score: 0.2 }
  ], { minimumRecall: 1, maximumFalsePositiveRate: 0 });

  assert.equal(calibration.threshold, 0.76);
  assert.equal(calibration.metrics.recall, 1);
  assert.equal(calibration.metrics.false_positive_rate, 0);
  assert.equal(calibration.metrics.accuracy, 1);
});

test('RAG-0507 menolak kalibrasi yang tidak memiliki kelas positif dan negatif', () => {
  assert.throws(
    () => calibrateRagRelevanceThreshold([
      { expected_relevant: true, top_score: 0.9 },
      { expected_relevant: true, top_score: 0.8 }
    ]),
    (error) => error.code === 'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT'
  );
});
