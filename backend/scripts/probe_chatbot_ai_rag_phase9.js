import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { OpenAI } from 'openai';

import {
  auditRagEvaluationEvidence,
  evaluateRagGenerationOutcomes,
  sanitizeRagEvaluationTranscript
} from '../src/services/chatbot_ai_rag_evaluation.service.js';
import {
  buildProductionMessages,
  buildRagProductionMessages
} from '../src/services/chatbot_ai_prompt.service.js';
import { CS_FALLBACK_MESSAGE } from '../src/services/chatbot_ai_rag_runtime.service.js';
import { buildChatCompletionPayload } from '../src/services/chatbot_ai_runtime.service.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import {
  closeRagEvaluationFixture,
  createRagEvaluationFixture,
  EVALUATION_CASES,
  EVALUATION_DATASET_SHA256,
  EVALUATION_SOURCES,
  retrieveRagEvaluationContext,
  verifyRagEvaluationDatasetDigest
} from '../test/helpers/rag_retrieval_evaluation_fixture.js';

const DEFAULT_BASE_URL = 'https://ai.sumopod.com/v1';
const DEFAULT_MODEL = 'MiniMax-M2.7-highspeed';
const SYSTEM_INSTRUCTION = [
  'Anda adalah AdmisiBot, asisten informasi penerimaan mahasiswa.',
  'Gunakan bahasa Indonesia yang ramah, ringkas, dan mudah dipahami.'
].join(' ');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const [rawKey, inlineValue] = current.slice(2).split('=', 2);
    const value = inlineValue ?? (argv[index + 1]?.startsWith('--') ? 'true' : argv[index + 1]);
    if (inlineValue === undefined && value !== 'true') index += 1;
    args[rawKey] = value;
  }
  return args;
}

function parseCredentialAndRates(raw, model) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const keyMatch = lines.map((line) => line.match(/^api\s*key\s*[:=]\s*(.+)$/i)).find(Boolean);
  const apiKey = keyMatch?.[1]?.trim();
  if (!apiKey) throw Object.assign(new Error('API key tidak ditemukan.'), { code: 'CREDENTIAL_KEY_MISSING' });
  const modelIndex = lines.findIndex((line) => line.toLowerCase() === model.toLowerCase());
  if (modelIndex < 0) throw Object.assign(new Error('Model tidak ditemukan.'), { code: 'MODEL_MISSING' });
  const values = lines.slice(modelIndex + 1, modelIndex + 15)
    .map((line) => line.match(/^\$([0-9]+(?:\.[0-9]+)?)/)?.[1])
    .filter(Boolean)
    .map(Number);
  if (values.length < 3) throw Object.assign(new Error('Harga tidak dapat dibaca.'), { code: 'PRICE_PARSE_FAILED' });
  const discounted = values.length >= 5;
  return {
    apiKey,
    rates: {
      input_usd_per_million: discounted ? values[1] : values[0],
      cached_input_usd_per_million: discounted ? values[2] : values[1],
      output_usd_per_million: discounted ? values[4] : values[2]
    }
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function parseJudgeResult(content) {
  const match = String(content || '').match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const groundedness = Number(parsed.groundedness);
    if (!Number.isInteger(groundedness) || groundedness < 1 || groundedness > 5
        || typeof parsed.unsupported_claim !== 'boolean') return null;
    return {
      groundedness,
      unsupported_claim: parsed.unsupported_claim,
      note: sanitizeRagEvaluationTranscript(parsed.note).slice(0, 240)
    };
  } catch {
    return null;
  }
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID');
}

function negativeBehaviorPass(item, answer) {
  const normalized = normalize(answer);
  if (item.expected_behavior === 'clarify') {
    return /maksud|pertanyaan.*lebih jelas|jelaskan.*dimaksud|yang mana/iu.test(normalized);
  }
  if (item.expected_behavior === 'out_of_scope') {
    return /belum (?:memiliki|tersedia|bisa)|customer service|di luar/iu.test(normalized);
  }
  if (item.expected_behavior === 'deny_tenant_data') {
    return /belum (?:memiliki|tersedia|bisa)|customer service|tidak dapat|tidak bisa/iu.test(normalized)
      && !/sembilan puluh sembilan|nomor privat|promo rahasia sesi/iu.test(normalized);
  }
  return false;
}

function responseUsage(response) {
  return {
    input_tokens: response?.usage?.prompt_tokens ?? response?.usage?.input_tokens ?? null,
    output_tokens: response?.usage?.completion_tokens ?? response?.usage?.output_tokens ?? null,
    cached_tokens: response?.usage?.prompt_tokens_details?.cached_tokens
      ?? response?.usage?.input_tokens_details?.cached_tokens
      ?? null,
    reasoning_tokens: response?.usage?.completion_tokens_details?.reasoning_tokens
      ?? response?.usage?.output_tokens_details?.reasoning_tokens
      ?? null
  };
}

function estimateCost(records, rates) {
  return records.reduce((sum, record) => {
    if (!Number.isInteger(record.input_tokens) || !Number.isInteger(record.output_tokens)) return sum;
    const cached = Math.min(record.input_tokens, Number.isInteger(record.cached_tokens) ? record.cached_tokens : 0);
    return sum + (
      (record.input_tokens - cached) * rates.input_usd_per_million
      + cached * rates.cached_input_usd_per_million
      + record.output_tokens * rates.output_usd_per_million
    ) / 1_000_000;
  }, 0);
}

let stage = 'arguments';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentialPath = resolve(args['credentials-file'] || '../apiDevelopment.txt');
  const outputPath = args.output ? resolve(args.output) : null;
  const model = args.model || DEFAULT_MODEL;
  const concurrency = Number.parseInt(args.concurrency || '4', 10);
  const answerCap = Number.parseInt(args['answer-cap'] || '512', 10);
  const judgeCap = Number.parseInt(args['judge-cap'] || '512', 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw Object.assign(new Error('Concurrency tidak valid.'), { code: 'INVALID_CONCURRENCY' });
  }
  if (!Number.isInteger(answerCap) || answerCap < 64 || answerCap > 2048
      || !Number.isInteger(judgeCap) || judgeCap < 64 || judgeCap > 2048) {
    throw Object.assign(new Error('Output cap tidak valid.'), { code: 'INVALID_OUTPUT_CAP' });
  }
  if (!verifyRagEvaluationDatasetDigest()) {
    throw Object.assign(new Error('Digest dataset berubah.'), { code: 'DATASET_DIGEST_MISMATCH' });
  }

  stage = 'read_credentials';
  const credentialRaw = await readFile(credentialPath, 'utf8');
  const { apiKey, rates } = parseCredentialAndRates(credentialRaw, model);
  stage = 'validate_provider_url';
  const safeBaseUrl = await assertSafeOutboundUrl(args['base-url'] || DEFAULT_BASE_URL);
  const client = new OpenAI({
    apiKey,
    baseURL: safeBaseUrl,
    timeout: 45000,
    maxRetries: 0,
    fetch: createSafeOutboundFetch()
  });

  stage = 'retrieve_actual_contexts';
  const fixture = await createRagEvaluationFixture();
  const retrievals = [];
  try {
    for (const item of EVALUATION_CASES) {
      const startedAt = performance.now();
      const result = await retrieveRagEvaluationContext(item, fixture.client);
      retrievals.push({
        item,
        result,
        latency_ms: performance.now() - startedAt
      });
    }
  } finally {
    await closeRagEvaluationFixture(fixture.db);
  }

  const fullKnowledge = EVALUATION_SOURCES
    .map((source) => `Sumber ${source.id}: ${source.text}`)
    .join('\n');
  const answerRequests = [];
  const generationRecords = [];
  for (const retrieval of retrievals) {
    answerRequests.push({
      retrieval,
      profile: 'CURRENT_FULL_KB',
      messages: buildProductionMessages({
        systemInstruction: SYSTEM_INSTRUCTION,
        knowledgeBase: fullKnowledge,
        userMessage: retrieval.item.query
      })
    });
    if (retrieval.result.selected_count > 0) {
      answerRequests.push({
        retrieval,
        profile: 'RAG_HYBRID',
        messages: buildRagProductionMessages({
          systemInstruction: SYSTEM_INSTRUCTION,
          ragContext: retrieval.result.context,
          userMessage: retrieval.item.query
        })
      });
    } else {
      generationRecords.push({
        id: retrieval.item.id,
        profile: 'RAG_HYBRID',
        category: retrieval.item.category,
        answerable: false,
        required_claims: [],
        answer: CS_FALLBACK_MESSAGE,
        status: 'CS_FALLBACK',
        provider_called: false,
        provider_attempts: 0,
        behavior_pass: negativeBehaviorPass(retrieval.item, CS_FALLBACK_MESSAGE),
        retrieval_latency_ms: retrieval.latency_ms,
        provider_latency_ms: null,
        total_latency_ms: retrieval.latency_ms,
        retrieved_source_ids: []
      });
    }
  }

  stage = 'answer_provider_requests';
  const providerAnswers = await mapLimit(answerRequests, concurrency, async (request) => {
    const providerStartedAt = performance.now();
    try {
      const response = await client.chat.completions.create(buildChatCompletionPayload({
        model,
        messages: request.messages,
        maxOutputTokens: answerCap,
        temperature: 0.3,
        requestKind: 'sandbox'
      }));
      const answer = String(response.choices?.[0]?.message?.content || '').trim();
      const providerLatencyMs = performance.now() - providerStartedAt;
      return {
        id: request.retrieval.item.id,
        profile: request.profile,
        category: request.retrieval.item.category,
        answerable: request.retrieval.item.gold_source_ids.length > 0,
        required_claims: request.retrieval.item.required_claims,
        answer,
        status: answer && response.choices?.[0]?.finish_reason === 'stop' ? 'SUCCEEDED' : 'FAILED',
        finish_reason: response.choices?.[0]?.finish_reason || null,
        provider_called: true,
        provider_attempts: 1,
        behavior_pass: request.retrieval.item.gold_source_ids.length === 0
          ? negativeBehaviorPass(request.retrieval.item, answer) : true,
        retrieval_latency_ms: request.profile === 'RAG_HYBRID' ? request.retrieval.latency_ms : 0,
        provider_latency_ms: providerLatencyMs,
        total_latency_ms: providerLatencyMs
          + (request.profile === 'RAG_HYBRID' ? request.retrieval.latency_ms : 0),
        retrieved_source_ids: request.retrieval.result.results.map((candidate) => candidate.source_id),
        reference_context: request.retrieval.result.context,
        ...responseUsage(response)
      };
    } catch (error) {
      const providerLatencyMs = performance.now() - providerStartedAt;
      return {
        id: request.retrieval.item.id,
        profile: request.profile,
        category: request.retrieval.item.category,
        answerable: request.retrieval.item.gold_source_ids.length > 0,
        required_claims: request.retrieval.item.required_claims,
        answer: '',
        status: 'FAILED',
        provider_called: true,
        provider_attempts: 1,
        behavior_pass: false,
        retrieval_latency_ms: request.profile === 'RAG_HYBRID' ? request.retrieval.latency_ms : 0,
        provider_latency_ms: providerLatencyMs,
        total_latency_ms: providerLatencyMs
          + (request.profile === 'RAG_HYBRID' ? request.retrieval.latency_ms : 0),
        retrieved_source_ids: request.retrieval.result.results.map((candidate) => candidate.source_id),
        reference_context: request.retrieval.result.context,
        error_code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
        error_status: Number.isInteger(error?.status) ? error.status : null
      };
    }
  });
  generationRecords.push(...providerAnswers);

  stage = 'judge_provider_requests';
  const judgeTargets = generationRecords.filter((record) => record.answerable && record.status === 'SUCCEEDED');
  const judgeRecords = await mapLimit(judgeTargets, concurrency, async (record) => {
    const startedAt = performance.now();
    try {
      const response = await client.chat.completions.create(buildChatCompletionPayload({
        model,
        messages: [
          {
            role: 'system',
            content: [
              'Anda evaluator groundedness jawaban chatbot.',
              'Nilai jawaban hanya terhadap konteks referensi.',
              'Arahan generik untuk menghubungi customer service, pertanyaan klarifikasi, dan emoji bukan klaim fakta yang memerlukan dukungan konteks.',
              'Kembalikan JSON valid tanpa markdown: groundedness integer 1-5, unsupported_claim boolean, note maksimal 20 kata.'
            ].join(' ')
          },
          {
            role: 'user',
            content: [
              `KONTEKS REFERENSI:\n${record.reference_context}`,
              `PERTANYAAN:\n${EVALUATION_CASES.find((item) => item.id === record.id)?.query || ''}`,
              `JAWABAN:\n${record.answer}`
            ].join('\n\n')
          }
        ],
        maxOutputTokens: judgeCap,
        temperature: 0,
        requestKind: 'sandbox'
      }));
      return {
        id: record.id,
        profile: record.profile,
        status: 'SUCCEEDED',
        judgement: parseJudgeResult(response.choices?.[0]?.message?.content),
        latency_ms: performance.now() - startedAt,
        ...responseUsage(response)
      };
    } catch (error) {
      return {
        id: record.id,
        profile: record.profile,
        status: 'FAILED',
        judgement: null,
        latency_ms: performance.now() - startedAt,
        error_code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
        error_status: Number.isInteger(error?.status) ? error.status : null
      };
    }
  });
  const judgementMap = new Map(judgeRecords.map((record) => [
    `${record.id}:${record.profile}`,
    record.judgement
  ]));
  for (const record of generationRecords) {
    record.judgement = judgementMap.get(`${record.id}:${record.profile}`) || null;
  }

  stage = 'summarize_and_audit';
  const evaluation = evaluateRagGenerationOutcomes(generationRecords, {
    rates,
    embeddingCostUsd: { CURRENT_FULL_KB: 0, RAG_HYBRID: 0 }
  });
  const transcript = EVALUATION_CASES.map((item) => ({
    case_id: item.id,
    category: item.category,
    chat_sent: sanitizeRagEvaluationTranscript(item.query),
    expected_behavior: item.expected_behavior,
    replies: ['CURRENT_FULL_KB', 'RAG_HYBRID'].map((profile) => {
      const record = generationRecords.find((entry) => entry.id === item.id && entry.profile === profile);
      return {
        profile,
        status: record?.status || 'MISSING',
        chat_replied: sanitizeRagEvaluationTranscript(record?.answer),
        retrieved_source_ids: profile === 'RAG_HYBRID' ? record?.retrieved_source_ids || [] : [],
        input_tokens: record?.input_tokens ?? null,
        output_tokens: record?.output_tokens ?? null,
        cached_tokens: record?.cached_tokens ?? null,
        reasoning_tokens: record?.reasoning_tokens ?? null,
        retrieval_latency_ms: record?.retrieval_latency_ms ?? null,
        provider_latency_ms: record?.provider_latency_ms ?? null,
        total_latency_ms: record?.total_latency_ms ?? null,
        finish_reason: record?.finish_reason ?? null,
        judgement: record?.judgement || null,
        behavior_pass: record?.behavior_pass === true
      };
    })
  }));
  const report = {
    evidence_kind: 'SANITIZED_PHASE9_ACTUAL_GENERATION_EVALUATION',
    executed_at_utc: new Date().toISOString(),
    environment: 'LOCAL_PROVIDER_WITH_SQLITE_IN_MEMORY',
    dataset_sha256: EVALUATION_DATASET_SHA256,
    dataset_cases: EVALUATION_CASES.length,
    provider_host: new URL(safeBaseUrl).hostname,
    model,
    temperature: 0.3,
    answer_output_cap: answerCap,
    judge_output_cap: judgeCap,
    sdk_max_retries: 0,
    credential_source: basename(credentialPath),
    credential_logged: false,
    retrieval: {
      engine: 'application SQLite lexical + deterministic semantic vectors + RRF/context selection',
      real_embedding_provider_calls: 0,
      limitation: 'Deterministic vectors isolate generation quality; real query embedding cost/latency remains outside this run.'
    },
    evaluation,
    judge: {
      provider_calls: judgeRecords.length,
      successful_calls: judgeRecords.filter((record) => record.status === 'SUCCEEDED').length,
      valid_judgements: judgeRecords.filter((record) => record.judgement).length,
      token_totals: {
        input: judgeRecords.reduce((sum, record) => sum + (record.input_tokens || 0), 0),
        output: judgeRecords.reduce((sum, record) => sum + (record.output_tokens || 0), 0)
      },
      estimated_evaluation_cost_usd: Number(estimateCost(judgeRecords, rates).toFixed(9)),
      limitation: 'Model provider yang sama menjadi judge; hasil adalah indikator development, bukan review independen.'
    },
    billing_reconciled: false,
    transcript
  };
  const generalAudit = auditRagEvaluationEvidence(report, [
    { label: 'api_key', value: apiKey },
    { label: 'raw_phone', value: '0812-0000-1234' }
  ]);
  const replyAudit = auditRagEvaluationEvidence(
    transcript.flatMap((item) => item.replies.map((reply) => reply.chat_replied)),
    [
      { label: 'cross_tenant_source', value: 'memberi diskon khusus sembilan puluh sembilan persen' },
      { label: 'cross_session_source', value: 'hanya berlaku pada sesi lain milik tenant yang sama' }
    ]
  );
  report.sensitive_audit = {
    passed: generalAudit.passed && replyAudit.passed,
    detected_labels: [...generalAudit.detected_labels, ...replyAudit.detected_labels]
  };
  if (!report.sensitive_audit.passed) {
    throw Object.assign(new Error('Evidence masih mengandung nilai sensitif.'), {
      code: 'SENSITIVE_EVIDENCE_AUDIT_FAILED'
    });
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    evidence_kind: report.evidence_kind,
    executed_at_utc: report.executed_at_utc,
    output_file: outputPath ? basename(outputPath) : null,
    output_sha256: createHash('sha256').update(serialized).digest('hex'),
    evaluation: report.evaluation,
    judge: report.judge,
    sensitive_audit: report.sensitive_audit
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: 'RAG_PHASE9_PROBE_FAILED',
    stage,
    type: error?.name || 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    status: Number.isInteger(error?.status) ? error.status : null
  })}\n`);
  process.exitCode = 1;
});
