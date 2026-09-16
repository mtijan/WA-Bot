import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { OpenAI } from 'openai';

import {
  auditRagEvaluationEvidence,
  sanitizeRagEvaluationTranscript
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import {
  executeRagRetrieval,
  processInboundAIMessage
} from '../src/services/chatbot_ai_rag_runtime.service.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  EVALUATION_SESSION_ID,
  EVALUATION_SOURCES
} from '../test/helpers/rag_retrieval_evaluation_fixture.js';

const MODEL = 'MiniMax-M2.7-highspeed';
const BASE_URL = 'https://ai.sumopod.com/v1';
// Provider probe hanya menerima fakta sintetis non-kontak. Source 306 berisi nomor
// fixture dan sengaja tidak pernah dimasukkan ke prompt eksternal.
const LEGACY_KNOWLEDGE = EVALUATION_SOURCES
  .filter((source) => source.id !== 306)
  .map((source) => source.text)
  .join('\n\n');
const CASES = Object.freeze([
  ['SH-01', 'exact_price', 'Berapa biaya pendaftaran program reguler?'],
  ['SH-02', 'exact_link', 'Di mana formulir resmi pendaftaran?'],
  ['SH-03', 'requirements', 'Apa saja syarat pendaftaran mahasiswa baru?'],
  ['SH-04', 'scholarship', 'Apakah tersedia beasiswa prestasi?'],
  ['SH-05', 'online_class', 'Kelas daring memakai apa dan dilaksanakan hari apa?'],
  ['SH-06', 'out_of_scope', 'Bagaimana prakiraan cuaca besok?'],
  ['SH-07', 'ambiguous_follow_up', 'Boleh jelaskan yang tadi?'],
  ['SH-08', 'social', 'Halo admin, apa kabar?']
].map(([id, pattern, query]) => Object.freeze({ id, pattern, query })));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const [key, inlineValue] = current.slice(2).split('=', 2);
    args[key] = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
  }
  return args;
}

function parseCredentialAndRates(raw) {
  const lines = raw.split(/\r?\n/u).map((line) => line.trim());
  const key = lines.map((line) => line.match(/^api\s*key\s*[:=]\s*(.+)$/iu)).find(Boolean)?.[1]?.trim();
  if (!key) throw new Error('API key development tidak ditemukan.');
  const modelIndex = lines.findIndex((line) => line.toLowerCase() === MODEL.toLowerCase());
  if (modelIndex < 0) throw new Error(`Harga model ${MODEL} tidak ditemukan.`);
  const prices = lines.slice(modelIndex + 1, modelIndex + 15)
    .map((line) => Number(line.match(/^\$([0-9]+(?:\.[0-9]+)?)/u)?.[1]))
    .filter(Number.isFinite);
  if (prices.length < 3) throw new Error('Tarif model tidak dapat dibaca.');
  return {
    apiKey: key,
    rates: prices.length >= 5
      ? { input: prices[1], cached: prices[2], output: prices[4] }
      : { input: prices[0], cached: prices[1], output: prices[2] }
  };
}

function readUsage(response) {
  return {
    input_tokens: response?.usage?.prompt_tokens ?? response?.usage?.input_tokens ?? null,
    output_tokens: response?.usage?.completion_tokens ?? response?.usage?.output_tokens ?? null,
    cached_tokens: response?.usage?.prompt_tokens_details?.cached_tokens
      ?? response?.usage?.input_tokens_details?.cached_tokens ?? 0
  };
}

function estimateCost(records, rates) {
  return records.reduce((total, record) => {
    if (!Number.isInteger(record.input_tokens) || !Number.isInteger(record.output_tokens)) return total;
    const cached = Math.min(record.input_tokens, Number(record.cached_tokens) || 0);
    return total
      + ((record.input_tokens - cached) * rates.input / 1_000_000)
      + (cached * rates.cached / 1_000_000)
      + (record.output_tokens * rates.output / 1_000_000);
  }, 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentialsPath = resolve(args.credentials || '../apiDevelopment.txt');
  const outputPath = resolve(args.output || '../scratch/rag_phase10_shadow_chat_report.json');
  const { apiKey, rates } = parseCredentialAndRates(await readFile(credentialsPath, 'utf8'));
  const safeBaseUrl = await assertSafeOutboundUrl(args['base-url'] || BASE_URL);
  const openai = new OpenAI({
    apiKey,
    baseURL: safeBaseUrl,
    timeout: 30000,
    maxRetries: 0,
    fetch: createSafeOutboundFetch()
  });
  const { db, client } = await createRagEvaluationFixture();
  const records = [];

  try {
    for (const item of CASES) {
      let selectedSourceIds = [];
      let providerCalls = 0;
      let providerUsage = { input_tokens: null, output_tokens: null, cached_tokens: 0 };
      let providerFinishReason = null;
      const startedAt = performance.now();
      const result = await processInboundAIMessage({
        sessionId: EVALUATION_SESSION_ID,
        userId: 1,
        cleanText: item.query,
        aiSettings: {
          is_active: 1,
          rag_mode: 'fts',
          rag_top_k: 4,
          rag_context_tokens: 1000,
          rag_input_budget_tokens: 2200,
          max_output_tokens: 256,
          system_instruction: 'Anda adalah AdmisiBot. Jawab singkat dan sopan berdasarkan knowledge yang tersedia.',
          knowledge_base: LEGACY_KNOWLEDGE
        },
        credentials: { apiKey, baseUrl: safeBaseUrl, model: MODEL },
        databaseClient: client
      }, {
        rolloutMode: 'disabled',
        shadowMode: 'all',
        assertSafeOutboundUrl: async () => safeBaseUrl,
        createChatClient: async () => openai,
        executeRagRetrieval: async (params, dependencies) => {
          const retrieval = await executeRagRetrieval(params, dependencies);
          selectedSourceIds = retrieval.ragResult?.results?.map((row) => row.source_id) || [];
          return retrieval;
        },
        executeChatCompletion: async ({ payload }) => {
          providerCalls += 1;
          const providerStartedAt = performance.now();
          const response = await openai.chat.completions.create(payload);
          providerUsage = readUsage(response);
          providerFinishReason = response?.choices?.[0]?.finish_reason ?? null;
          return {
            response,
            context: {
              requestId: randomUUID(),
              attemptNo: 1,
              requestKind: 'development_shadow_probe',
              operation: 'chat',
              startedAtMs: Date.now()
            },
            latencyMs: performance.now() - providerStartedAt
          };
        },
        recordUsage: async () => true,
        recordRuntimeEvent: async () => {},
        resolveAIProvider: () => 'development-provider',
        resolveKnowledgeBase: async () => LEGACY_KNOWLEDGE
      });
      if (providerCalls !== 1) {
        throw new Error(`${item.id}: shadow harus mempertahankan tepat satu chat provider call.`);
      }
      records.push({
        id: item.id,
        pattern: item.pattern,
        query: sanitizeRagEvaluationTranscript(item.query),
        reply: sanitizeRagEvaluationTranscript(result.reply),
        status: result.status,
        finish_reason: result.error ? 'runtime_error' : providerFinishReason,
        shadow_retrieval_type: result.ragMetadata?.shadow_effective_mode ?? null,
        shadow_retrieval_reason: result.ragMetadata?.shadow_retrieval_reason ?? null,
        shadow_selected_source_ids: selectedSourceIds,
        shadow_selected_count: result.ragMetadata?.shadow_selected_count ?? 0,
        provider_calls: providerCalls,
        total_latency_ms: Number((performance.now() - startedAt).toFixed(2)),
        ...providerUsage
      });
    }

    const report = {
      generated_at: new Date().toISOString(),
      environment: 'LOCAL_PAID_PROVIDER_DISPOSABLE_SQLITE',
      purpose: 'RAG-1001 shadow retrieval development evidence; bukan staging/pilot/UAT',
      model: MODEL,
      cases: records,
      provider_requests: records.reduce((sum, record) => sum + record.provider_calls, 0),
      embedding_provider_requests: 0,
      whatsapp_sends: 0,
      estimated_chat_cost_usd: estimateCost(records, rates),
      all_replies_legacy_path: records.every((record) => record.status === 'REPLIED'),
      one_chat_call_per_case: records.every((record) => record.provider_calls === 1)
    };
    report.sensitive_audit = auditRagEvaluationEvidence(report, [
      { label: 'api_key', value: apiKey },
      { label: 'fixture_phone', value: '0812-0000-1234' },
      { label: 'cross_tenant_secret', value: 'Kode rahasia tenant omega' }
    ]);
    if (!report.sensitive_audit.passed) {
      throw new Error(`Audit sensitif gagal: ${report.sensitive_audit.detected_labels.join(', ')}`);
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, 'utf8');
    process.stdout.write(`${JSON.stringify({
      output: basename(outputPath),
      sha256: createHash('sha256').update(serialized).digest('hex'),
      provider_requests: report.provider_requests,
      embedding_provider_requests: report.embedding_provider_requests,
      whatsapp_sends: report.whatsapp_sends,
      all_replies_legacy_path: report.all_replies_legacy_path,
      one_chat_call_per_case: report.one_chat_call_per_case,
      sensitive_audit: report.sensitive_audit
    })}\n`);
  } finally {
    await closeRagEvaluationFixture(db);
  }
}

main().catch((error) => {
  process.stderr.write(`Phase 10 shadow probe failed: ${error.message}\n`);
  process.exitCode = 1;
});
