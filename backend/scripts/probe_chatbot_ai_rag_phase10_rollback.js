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
  CS_FALLBACK_MESSAGE,
  processInboundAIMessage
} from '../src/services/chatbot_ai_rag_runtime.service.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  EVALUATION_SESSION_ID
} from '../test/helpers/rag_retrieval_evaluation_fixture.js';

const MODEL = 'MiniMax-M2.7-highspeed';
const BASE_URL = 'https://ai.sumopod.com/v1';
const CASES = Object.freeze([
  { id: 'RB-01', pattern: 'rollback_fts_knowledge', query: 'Berapa biaya pendaftaran program reguler?', rollbackMode: 'fts', expectedCalls: 1 },
  { id: 'RB-02', pattern: 'rollback_fts_social', query: 'Halo admin, semoga harimu menyenangkan.', rollbackMode: 'fts', expectedCalls: 1 },
  { id: 'RB-03', pattern: 'rollback_cs', query: 'Apa saja syarat pendaftaran?', rollbackMode: 'cs', expectedCalls: 0 },
  { id: 'RT-01', pattern: 'retired_full_kb_knowledge', query: 'Apakah tersedia beasiswa prestasi?', legacyFullKbEnabled: false, expectedCalls: 0 },
  { id: 'RT-02', pattern: 'retired_full_kb_social', query: 'Selamat pagi admin, apa kabar?', legacyFullKbEnabled: false, expectedCalls: 1 }
]);

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
    input_tokens: response?.usage?.prompt_tokens ?? response?.usage?.input_tokens ?? 0,
    output_tokens: response?.usage?.completion_tokens ?? response?.usage?.output_tokens ?? 0,
    cached_tokens: response?.usage?.prompt_tokens_details?.cached_tokens
      ?? response?.usage?.input_tokens_details?.cached_tokens ?? 0
  };
}

function estimateCost(records, rates) {
  return records.reduce((total, record) => {
    const cached = Math.min(record.input_tokens, record.cached_tokens);
    return total
      + ((record.input_tokens - cached) * rates.input / 1_000_000)
      + (cached * rates.cached / 1_000_000)
      + (record.output_tokens * rates.output / 1_000_000);
  }, 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentialsPath = resolve(args.credentials || '../apiDevelopment.txt');
  const outputPath = resolve(args.output || '../scratch/rag_phase10_rollback_chat_report.json');
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
  const bannedPromptValues = ['0812-0000-1234', 'Kode rahasia tenant omega'];

  try {
    for (const item of CASES) {
      let providerCalls = 0;
      let cacheLookupCalls = 0;
      let providerUsage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
      let finishReason = 'not_called';
      const startedAt = performance.now();
      const result = await processInboundAIMessage({
        sessionId: EVALUATION_SESSION_ID,
        userId: 1,
        cleanText: item.query,
        aiSettings: {
          is_active: 1,
          rag_mode: 'hybrid',
          rag_top_k: 4,
          rag_context_tokens: 1000,
          rag_input_budget_tokens: 2200,
          max_output_tokens: 256,
          cache_enabled: 1,
          direct_answer_enabled: 1,
          system_instruction: 'Anda adalah AdmisiBot. Jawab singkat dan konsisten dalam Bahasa Indonesia.'
        },
        credentials: { apiKey, baseUrl: safeBaseUrl, model: MODEL },
        databaseClient: client
      }, {
        rolloutMode: 'disabled',
        rollbackMode: item.rollbackMode,
        legacyFullKbEnabled: item.legacyFullKbEnabled,
        assertSafeOutboundUrl: async () => safeBaseUrl,
        createChatClient: async () => openai,
        executeChatCompletion: async ({ payload }) => {
          const serializedPayload = JSON.stringify(payload);
          if (bannedPromptValues.some((value) => serializedPayload.includes(value))) {
            throw new Error(`${item.id}: payload provider memuat fixture sensitif.`);
          }
          providerCalls += 1;
          const response = await openai.chat.completions.create(payload);
          providerUsage = readUsage(response);
          finishReason = response?.choices?.[0]?.finish_reason ?? 'unknown';
          return {
            response,
            context: {
              requestId: randomUUID(),
              attemptNo: 1,
              requestKind: 'development_rollback_probe',
              operation: 'chat',
              startedAtMs: Date.now()
            },
            latencyMs: performance.now() - startedAt
          };
        },
        lookupCachedResponse: async () => {
          cacheLookupCalls += 1;
          throw new Error(`${item.id}: rollback/retirement tidak boleh membaca cache.`);
        },
        recordUsage: async () => true,
        recordRuntimeEvent: async () => {},
        resolveAIProvider: () => 'development-provider',
        resolveKnowledgeBase: async () => {
          throw new Error(`${item.id}: full-KB tidak boleh dibaca.`);
        }
      });
      if (providerCalls !== item.expectedCalls) {
        throw new Error(`${item.id}: provider call ${providerCalls}, expected ${item.expectedCalls}.`);
      }
      if (cacheLookupCalls !== 0) {
        throw new Error(`${item.id}: cache lookup terpanggil ${cacheLookupCalls} kali.`);
      }
      if (item.expectedCalls === 0 && result.reply !== CS_FALLBACK_MESSAGE) {
        throw new Error(`${item.id}: jalur tanpa provider wajib memakai CS fallback.`);
      }
      records.push({
        id: item.id,
        pattern: item.pattern,
        query: sanitizeRagEvaluationTranscript(item.query),
        reply: sanitizeRagEvaluationTranscript(result.reply),
        status: result.status,
        effective_mode: result.ragMetadata?.effective_mode ?? null,
        rollback_mode: result.ragMetadata?.rollback_mode ?? null,
        retrieval_reason: result.ragMetadata?.retrieval_reason ?? null,
        provider_calls: providerCalls,
        finish_reason: finishReason,
        total_latency_ms: Number((performance.now() - startedAt).toFixed(2)),
        ...providerUsage
      });
    }

    const report = {
      generated_at: new Date().toISOString(),
      environment: 'LOCAL_PAID_PROVIDER_DISPOSABLE_SQLITE',
      purpose: 'RAG-1008/1009 rollback and full-KB retirement development evidence; bukan staging/UAT',
      model: MODEL,
      cases: records,
      provider_requests: records.reduce((sum, record) => sum + record.provider_calls, 0),
      embedding_provider_requests: 0,
      whatsapp_sends: 0,
      estimated_chat_cost_usd: estimateCost(records, rates)
    };
    report.sensitive_audit = auditRagEvaluationEvidence(report, [
      { label: 'api_key', value: apiKey },
      { label: 'fixture_phone', value: bannedPromptValues[0] },
      { label: 'cross_tenant_secret', value: bannedPromptValues[1] }
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
      estimated_chat_cost_usd: report.estimated_chat_cost_usd,
      sensitive_audit: report.sensitive_audit
    })}\n`);
  } finally {
    await closeRagEvaluationFixture(db);
  }
}

main().catch((error) => {
  process.stderr.write(`Phase 10 rollback probe failed: ${error.message}\n`);
  process.exitCode = 1;
});
