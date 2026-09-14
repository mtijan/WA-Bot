import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import { RAG_CONTEXT_DEFAULTS } from '../src/services/chatbot_ai_rag_context.service.js';
import {
  calibrateRagRelevanceThreshold,
  evaluateRagRetrievalOutcomes
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import {
  closeRagEvaluationFixture as close,
  createRagEvaluationFixture as createFixture,
  EVALUATION_CASES as evaluationCases,
  EVALUATION_DATASET_SHA256 as DATASET_SHA256,
  RAW_EVALUATION_CASES as rawEvaluationCases,
  retrieveRagEvaluationCandidates as retrieveCandidates,
  retrieveRagEvaluationContext
} from './helpers/rag_retrieval_evaluation_fixture.js';

test('RAG-0901 sampai RAG-0904 mengunci dataset, pola chat, klaim, dan negative isolation', () => {
  assert.equal(
    createHash('sha256').update(JSON.stringify(rawEvaluationCases)).digest('hex'),
    DATASET_SHA256,
    'dataset berubah tanpa pembaruan baseline yang disengaja'
  );
  assert.equal(evaluationCases.length, 50);
  assert.deepEqual(
    Object.fromEntries([...new Set(evaluationCases.map((item) => item.category))]
      .map((category) => [
        category,
        evaluationCases.filter((item) => item.category === category).length
      ])),
    {
      exact: 15,
      synonym: 10,
      typo: 5,
      multi_source: 5,
      follow_up: 5,
      out_of_scope: 5,
      adversarial_tenant: 5
    }
  );

  const requiredClaimTypes = new Set(evaluationCases.flatMap((item) => item.claim_types));
  for (const claimType of ['price', 'link', 'contact']) {
    assert.ok(requiredClaimTypes.has(claimType), `dataset belum mencakup ${claimType}`);
  }
  assert.equal(
    evaluationCases.filter((item) => item.category === 'multi_source')
      .every((item) => item.gold_source_ids.length >= 2 && item.required_claims.length >= 2),
    true
  );
  assert.equal(
    evaluationCases.filter((item) => item.category === 'adversarial_tenant').length,
    5
  );
});

test('RAG-0510/RAG-0905 mengukur Top-1, Top-3, negative rejection, dan klaim aktual', async (t) => {
  const { db, client } = await createFixture();
  try {
    const candidatesById = new Map();
    for (const item of evaluationCases) {
      candidatesById.set(item.id, await retrieveCandidates(item, client));
    }
    const calibrationCases = evaluationCases
      .filter((item) => item.calibration)
      .map((item) => ({
        expected_relevant: item.gold_source_ids.length > 0,
        top_score: candidatesById.get(item.id)[0]?.relevance_score || 0
      }));
    assert.equal(calibrationCases.length, 20);
    const calibration = calibrateRagRelevanceThreshold(calibrationCases, {
      minimumRecall: 0.9,
      maximumFalsePositiveRate: 0
    });
    assert.ok(Math.abs(calibration.threshold - RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD) < 0.000001);

    const outcomes = [];
    for (const item of evaluationCases) {
      const result = await retrieveRagEvaluationContext(item, client, {
        relevanceThreshold: calibration.threshold,
        topK: 4,
        contextTokenBudget: 1000,
        baseInputTokens: 120
      });
      const retrievedSourceIds = result.results.map((candidate) => candidate.source_id);
      outcomes.push({ item, result, retrievedSourceIds });
      assert.ok(result.context_tokens <= 1000, `${item.id}: context melewati budget`);
      assert.ok(result.estimated_total_input_tokens <= 2200, `${item.id}: input melewati hard budget`);
      assert.equal(
        result.results.some((candidate) => [901, 902].includes(candidate.source_id)),
        false,
        `${item.id}: cross-tenant source bocor`
      );
      for (const candidate of result.results) {
        assert.equal('session_id' in candidate.provenance, false);
        assert.equal('internal_note' in candidate.provenance, false);
      }
      for (const requiredClaim of item.required_claims) {
        assert.ok(
          result.context.toLocaleLowerCase('id-ID').includes(requiredClaim.toLocaleLowerCase('id-ID')),
          `${item.id}: klaim wajib '${requiredClaim}' tidak tersedia di context aktual`
        );
      }
    }

    const metrics = evaluateRagRetrievalOutcomes(outcomes.map(({ item, retrievedSourceIds }) => ({
      id: item.id,
      category: item.category,
      gold_source_ids: item.gold_source_ids,
      retrieved_source_ids: retrievedSourceIds
    })));
    assert.equal(metrics.answerable_cases, 35);
    assert.equal(metrics.negative_cases, 15);
    assert.ok(metrics.top_1_accuracy >= 0.9, `top-1 accuracy hanya ${metrics.top_1_accuracy}`);
    assert.ok(metrics.top_3_accuracy >= 0.9, `top-3 accuracy hanya ${metrics.top_3_accuracy}`);
    assert.equal(metrics.negative_rejection_rate, 1);
    assert.deepEqual(metrics.failed_case_ids, []);

    const priceCase = outcomes.find(({ item }) => item.id === 'EX-02');
    const urlCase = outcomes.find(({ item }) => item.id === 'EX-03');
    const contactCase = outcomes.find(({ item }) => item.id === 'EX-12');
    assert.match(priceCase.result.context, /Rp150\.000/);
    assert.match(urlCase.result.context, /https:\/\/daftar\.example\.id/);
    assert.match(contactCase.result.context, /WhatsApp 0812-0000-1234/);

    t.diagnostic(`calibrated_threshold=${calibration.threshold.toFixed(6)}`);
    t.diagnostic(`top1_accuracy=${(metrics.top_1_accuracy * 100).toFixed(2)}%`);
    t.diagnostic(`top3_accuracy=${(metrics.top_3_accuracy * 100).toFixed(2)}%`);
    t.diagnostic(`negative_rejection=${(metrics.negative_rejection_rate * 100).toFixed(2)}%`);
    t.diagnostic(`category_results=${JSON.stringify(metrics.by_category)}`);
    t.diagnostic(`case_results=${JSON.stringify(outcomes.map(({ item, retrievedSourceIds }) => ({
      id: item.id,
      query: item.query,
      gold: item.gold_source_ids,
      top_3: retrievedSourceIds.slice(0, 3)
    })))}`);
  } finally {
    await close(db);
  }
});
