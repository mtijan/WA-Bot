import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { OpenAI } from 'openai';

import {
  auditRagEvaluationEvidence,
  sanitizeRagEvaluationTranscript
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import {
  buildRagConversationalFallbackMessages,
  buildRagProductionMessages
} from '../src/services/chatbot_ai_prompt.service.js';
import {
  classifyRagConversationQuery,
  resolveRagQueryPolicy
} from '../src/services/chatbot_ai_rag_policy.service.js';
import { CS_FALLBACK_MESSAGE } from '../src/services/chatbot_ai_rag_runtime.service.js';
import { buildChatCompletionPayload } from '../src/services/chatbot_ai_runtime.service.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  retrieveRagEvaluationContext
} from '../test/helpers/rag_retrieval_evaluation_fixture.js';

const DEFAULT_MODEL = 'MiniMax-M2.7-highspeed';
const DEFAULT_BASE_URL = 'https://ai.sumopod.com/v1';
const CALIBRATED_THRESHOLD = 0.7571067;
const PERMISSIVE_THRESHOLD = 0.4;
const SYSTEM_INSTRUCTION = 'Anda adalah AdmisiBot, asisten admisi yang ramah, singkat, dan sopan.';

const SOCIAL_CASES = Object.freeze([
  'Halo!', 'Hai!', 'Selamat pagi kak', 'Apa kabar?', 'Makasih ya',
  'Terima kasih admin', 'Assalamualaikum', 'Kamu siapa?', 'Hello', 'Selamat malam min'
].map((query, index) => Object.freeze({ id: `SOC-${String(index + 1).padStart(2, '0')}`, query })));

const CONTEXTUAL_CASES = Object.freeze([
  ['CTX-01', 'Halo, biaya pendaftaran program reguler berapa?', 301],
  ['CTX-02', 'Selamat pagi, kapan pendaftaran ditutup?', 302],
  ['CTX-03', 'Hai kak, syarat daftarnya apa?', 303],
  ['CTX-04', 'Permisi, ada beasiswa prestasi?', 304],
  ['CTX-05', 'Halo, kelas daring pakai apa dan hari apa?', 305],
  ['CTX-06', 'Kak, kontak admisi WhatsApp berapa?', 306],
  ['CTX-07', 'Selamat siang, pembayarannya lewat bank apa?', 307],
  ['CTX-08', 'Halo, program studinya apa saja?', 308],
  ['CTX-09', 'Hi, formulir resminya di mana?', 301],
  ['CTX-10', 'Hai, kuliah daringnya hari apa?', 305]
].map(([id, query, sourceId]) => {
  const vector = Array(8).fill(0);
  vector[sourceId - 301] = 1;
  return Object.freeze({ id, query, sourceId, vector: Object.freeze(vector) });
}));

const WEAK_CASES = Object.freeze([
  'Halo, saya ingin tahu info itu',
  'Boleh jelaskan yang tadi?',
  'Saya penasaran soal hal tersebut',
  'Info lengkapnya bagaimana ya?',
  'Yang itu maksudnya apa kak?'
].map((query, index) => {
  const primary = index % 5;
  const remainder = Math.sqrt((1 - (0.45 ** 2)) / 7);
  const vector = Array(8).fill(remainder);
  vector[primary] = 0.45;
  return Object.freeze({ id: `WEAK-${String(index + 1).padStart(2, '0')}`, query, vector: Object.freeze(vector) });
}));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const [key, inline] = current.slice(2).split('=', 2);
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    args[key] = value;
  }
  return args;
}

function parseCredentialAndRates(raw, model) {
  const lines = raw.split(/\r?\n/u).map((line) => line.trim());
  const keyMatch = lines.map((line) => line.match(/^api\s*key\s*[:=]\s*(.+)$/iu)).find(Boolean);
  const apiKey = keyMatch?.[1]?.trim();
  if (!apiKey) throw Object.assign(new Error('API key tidak ditemukan.'), { code: 'CREDENTIAL_KEY_MISSING' });
  const modelIndex = lines.findIndex((line) => line.toLowerCase() === model.toLowerCase());
  if (modelIndex < 0) throw Object.assign(new Error('Model tidak ditemukan.'), { code: 'MODEL_MISSING' });
  const values = lines.slice(modelIndex + 1, modelIndex + 15)
    .map((line) => line.match(/^\$([0-9]+(?:\.[0-9]+)?)/u)?.[1])
    .filter(Boolean)
    .map(Number);
  if (values.length < 3) throw Object.assign(new Error('Harga tidak dapat dibaca.'), { code: 'PRICE_PARSE_FAILED' });
  const discounted = values.length >= 5;
  return {
    apiKey,
    rates: {
      input: discounted ? values[1] : values[0],
      cached: discounted ? values[2] : values[1],
      output: discounted ? values[4] : values[2]
    }
  };
}

function usageOf(response) {
  return {
    input_tokens: response?.usage?.prompt_tokens ?? response?.usage?.input_tokens ?? null,
    output_tokens: response?.usage?.completion_tokens ?? response?.usage?.output_tokens ?? null,
    cached_tokens: response?.usage?.prompt_tokens_details?.cached_tokens
      ?? response?.usage?.input_tokens_details?.cached_tokens ?? 0
  };
}

function estimatedCost(records, rates) {
  return records.reduce((total, item) => {
    if (!Number.isInteger(item.input_tokens) || !Number.isInteger(item.output_tokens)) return total;
    const cached = Math.min(item.input_tokens, Number(item.cached_tokens) || 0);
    return total
      + (((item.input_tokens - cached) * rates.input) / 1_000_000)
      + ((cached * rates.cached) / 1_000_000)
      + ((item.output_tokens * rates.output) / 1_000_000);
  }, 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentialPath = resolve(args.credentials || '..', args.credentials ? '' : 'apiDevelopment.txt');
  const outputPath = resolve(args.output || '..', args.output ? '' : 'scratch/rag_phase9_completion_report.json');
  const model = args.model || DEFAULT_MODEL;
  const credentialRaw = await readFile(credentialPath, 'utf8');
  const { apiKey, rates } = parseCredentialAndRates(credentialRaw, model);
  const safeBaseUrl = await assertSafeOutboundUrl(args['base-url'] || DEFAULT_BASE_URL);
  const openai = new OpenAI({
    apiKey,
    baseURL: safeBaseUrl,
    timeout: 30000,
    maxRetries: 0,
    fetch: createSafeOutboundFetch()
  });
  const { db, client } = await createRagEvaluationFixture();
  const providerRecords = [];

  const complete = async ({ id, pattern, query, messages, threshold = null, sourceIds = [] }) => {
    const startedAt = performance.now();
    const response = await openai.chat.completions.create(buildChatCompletionPayload({
      model,
      messages,
      maxOutputTokens: 256,
      temperature: 0.3
    }));
    const usage = usageOf(response);
    const record = {
      id,
      pattern,
      query: sanitizeRagEvaluationTranscript(query),
      reply: sanitizeRagEvaluationTranscript(response?.choices?.[0]?.message?.content),
      threshold,
      selected_source_ids: sourceIds,
      finish_reason: response?.choices?.[0]?.finish_reason ?? null,
      latency_ms: Number((performance.now() - startedAt).toFixed(2)),
      ...usage
    };
    providerRecords.push(record);
    return record;
  };

  try {
    for (const item of SOCIAL_CASES) {
      if (classifyRagConversationQuery(item.query).kind !== 'social') {
        throw new Error(`Social classification gagal: ${item.id}`);
      }
      await complete({
        ...item,
        pattern: 'social_persona',
        messages: buildRagConversationalFallbackMessages({
          systemInstruction: SYSTEM_INSTRUCTION,
          userMessage: item.query
        })
      });
    }

    for (const item of CONTEXTUAL_CASES) {
      const policy = resolveRagQueryPolicy({ query: item.query, mode: 'hybrid', hasQueryVector: true });
      const retrieval = await retrieveRagEvaluationContext(item, client, {
        relevanceThreshold: policy.relevance_threshold
      });
      await complete({
        ...item,
        pattern: 'contextual_business',
        threshold: policy.relevance_threshold,
        sourceIds: retrieval.results.map((row) => row.source_id),
        messages: buildRagProductionMessages({
          systemInstruction: SYSTEM_INSTRUCTION,
          ragContext: retrieval.context,
          userMessage: item.query
        })
      });
    }

    const weakComparisons = [];
    for (const item of WEAK_CASES) {
      const permissive = await retrieveRagEvaluationContext(item, client, { relevanceThreshold: PERMISSIVE_THRESHOLD });
      const calibrated = await retrieveRagEvaluationContext(item, client, { relevanceThreshold: CALIBRATED_THRESHOLD });
      const permissiveRecord = permissive.selected_count > 0
        ? await complete({
            ...item,
            pattern: 'weak_permissive',
            threshold: PERMISSIVE_THRESHOLD,
            sourceIds: permissive.results.map((row) => row.source_id),
            messages: buildRagProductionMessages({
              systemInstruction: SYSTEM_INSTRUCTION,
              ragContext: permissive.context,
              userMessage: item.query
            })
          })
        : null;
      weakComparisons.push({
        id: item.id,
        query: sanitizeRagEvaluationTranscript(item.query),
        permissive_selected_source_ids: permissive.results.map((row) => row.source_id),
        permissive_reply: permissiveRecord?.reply || CS_FALLBACK_MESSAGE,
        calibrated_selected_source_ids: calibrated.results.map((row) => row.source_id),
        calibrated_reply: calibrated.selected_count > 0 ? 'PROVIDER_NOT_RUN' : CS_FALLBACK_MESSAGE,
        false_positive_avoided: permissive.selected_count > 0 && calibrated.selected_count === 0
      });
    }

    const report = {
      evidence_kind: 'SANITIZED_PHASE9_COMPLETION_ACTUAL_CHAT_EVALUATION',
      executed_at_utc: new Date().toISOString(),
      environment: 'LOCAL_PROVIDER_WITH_SQLITE_IN_MEMORY',
      provider_host: new URL(safeBaseUrl).hostname,
      model,
      sdk_max_retries: 0,
      credential_source: basename(credentialPath),
      credential_logged: false,
      thresholds: { permissive: PERMISSIVE_THRESHOLD, calibrated: CALIBRATED_THRESHOLD },
      summary: {
        provider_requests: providerRecords.length,
        social_replies: SOCIAL_CASES.length,
        contextual_replies: CONTEXTUAL_CASES.length,
        weak_permissive_replies: providerRecords.filter((row) => row.pattern === 'weak_permissive').length,
        social_false_cs_fallback: providerRecords.filter((row) => row.pattern === 'social_persona' && row.reply === CS_FALLBACK_MESSAGE).length,
        contextual_gold_source_hits: providerRecords.filter((row) => row.pattern === 'contextual_business'
          && row.selected_source_ids.includes(CONTEXTUAL_CASES.find((item) => item.id === row.id)?.sourceId)).length,
        weak_false_positives_avoided: weakComparisons.filter((row) => row.false_positive_avoided).length,
        input_tokens: providerRecords.reduce((sum, row) => sum + (row.input_tokens || 0), 0),
        output_tokens: providerRecords.reduce((sum, row) => sum + (row.output_tokens || 0), 0),
        estimated_cost_usd: Number(estimatedCost(providerRecords, rates).toFixed(9))
      },
      provider_records: providerRecords,
      weak_threshold_comparisons: weakComparisons,
      limitations: [
        'Vector query tetap deterministik untuk mengisolasi keputusan threshold; bukan bukti real embedding provider.',
        'Jawaban dikirim ke provider chat tetapi tidak dikirim ke WhatsApp.',
        'Billing dihitung dari usage provider dan rate lokal; belum direkonsiliasi dengan invoice.'
      ]
    };
    const audit = auditRagEvaluationEvidence(report, [
      { label: 'api_key', value: apiKey },
      { label: 'raw_phone', value: '0812-0000-1234' },
      { label: 'cross_tenant', value: 'sembilan puluh sembilan persen' },
      { label: 'cross_session', value: 'promo rahasia sesi bayangan' }
    ]);
    report.sensitive_audit = audit;
    if (!audit.passed) throw Object.assign(new Error('Audit evidence gagal.'), { code: 'SENSITIVE_AUDIT_FAILED' });

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, 'utf8');
    process.stdout.write(`${JSON.stringify({
      output_file: basename(outputPath),
      output_sha256: createHash('sha256').update(serialized).digest('hex'),
      summary: report.summary,
      sensitive_audit: report.sensitive_audit
    }, null, 2)}\n`);
  } finally {
    await closeRagEvaluationFixture(db);
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: 'RAG_PHASE9_COMPLETION_PROBE_FAILED',
    type: error?.name || 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    status: Number.isInteger(error?.status) ? error.status : null
  })}\n`);
  process.exitCode = 1;
});
