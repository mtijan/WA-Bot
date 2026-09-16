import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { RAG_CONTEXT_DEFAULTS } from '../src/services/chatbot_ai_rag_context.service.js';
import { RAG_AUTO_CONFIGURATION } from '../src/services/chatbot_ai_rag_policy.service.js';
import {
  auditRagEvaluationEvidence,
  evaluateRagRetrievalOutcomes,
  sanitizeRagEvaluationTranscript
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  EVALUATION_CASES,
  EVALUATION_DATASET_SHA256,
  retrieveRagEvaluationContext,
  verifyRagEvaluationDatasetDigest
} from '../test/helpers/rag_retrieval_evaluation_fixture.js';

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function categorySummary(cases) {
  return Object.fromEntries([...new Set(cases.map((item) => item.category))].map((category) => [
    category,
    cases.filter((item) => item.category === category).length
  ]));
}

async function main() {
  const output = path.resolve(process.cwd(), readArgument(
    '--output',
    '../scratch/rag_phase10_offline_retrieval_report.json'
  ));
  if (!verifyRagEvaluationDatasetDigest()) {
    throw new Error('Digest dataset evaluasi berubah; baseline wajib direview ulang.');
  }

  const { db, client } = await createRagEvaluationFixture();
  try {
    const cases = [];
    for (const item of EVALUATION_CASES) {
      const startedAt = performance.now();
      const result = await retrieveRagEvaluationContext(item, client, {
        relevanceThreshold: RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD,
        topK: RAG_AUTO_CONFIGURATION.rag_top_k,
        contextTokenBudget: RAG_AUTO_CONFIGURATION.rag_context_tokens,
        baseInputTokens: 120,
        hardTotalInputTokens: RAG_AUTO_CONFIGURATION.rag_input_budget_tokens
      });
      cases.push({
        id: item.id,
        category: item.category,
        query: sanitizeRagEvaluationTranscript(item.query),
        expected_behavior: item.expected_behavior,
        gold_source_ids: item.gold_source_ids,
        retrieved_source_ids: result.results.map((candidate) => candidate.source_id),
        selected_count: result.selected_count,
        context_tokens: result.context_tokens,
        estimated_total_input_tokens: result.estimated_total_input_tokens,
        retrieval_latency_ms: Number((performance.now() - startedAt).toFixed(3))
      });
    }

    const metrics = evaluateRagRetrievalOutcomes(cases.map((item) => ({
      id: item.id,
      category: item.category,
      gold_source_ids: item.gold_source_ids,
      retrieved_source_ids: item.retrieved_source_ids
    })));
    const report = {
      generated_at: new Date().toISOString(),
      environment: 'LOCAL_DISPOSABLE_SQLITE',
      purpose: 'RAG-1002 offline retrieval evaluation; bukan staging atau UAT',
      dataset_sha256: EVALUATION_DATASET_SHA256,
      threshold: RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD,
      top_k: RAG_AUTO_CONFIGURATION.rag_top_k,
      case_count: cases.length,
      categories: categorySummary(cases),
      external_calls: {
        chat_provider: 0,
        embedding_provider: 0,
        whatsapp_send: 0
      },
      metrics,
      cases
    };
    report.sensitive_audit = auditRagEvaluationEvidence(report, [
      { label: 'cross_session_secret', value: 'Promo rahasia sesi bayangan' },
      { label: 'cross_tenant_secret', value: 'Kode rahasia tenant omega' }
    ]);
    if (!report.sensitive_audit.passed) {
      throw new Error(`Audit sensitif gagal: ${report.sensitive_audit.detected_labels.join(', ')}`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      output: path.basename(output),
      dataset_sha256: report.dataset_sha256,
      case_count: report.case_count,
      top_1_accuracy: metrics.top_1_accuracy,
      top_3_accuracy: metrics.top_3_accuracy,
      negative_rejection_rate: metrics.negative_rejection_rate,
      failed_case_ids: metrics.failed_case_ids,
      sensitive_audit: report.sensitive_audit,
      external_calls: report.external_calls
    })}\n`);
  } finally {
    await closeRagEvaluationFixture(db);
  }
}

main().catch((error) => {
  process.stderr.write(`Offline RAG evaluation failed: ${error.message}\n`);
  process.exitCode = 1;
});
