import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { OpenAI } from 'openai';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import { buildProductionMessages, buildProductionSystemPrompt } from '../src/services/chatbot_ai_prompt.service.js';
import { buildChatCompletionPayload } from '../src/services/chatbot_ai_runtime.service.js';
import {
  chunkKnowledgeDocuments,
  estimateRagTokens,
  extractFlowKnowledgeSource
} from '../src/services/chatbot_ai_rag_extractor.service.js';

const DEFAULT_BASE_URL = 'https://ai.sumopod.com/v1';
const DEFAULT_MODEL = 'MiniMax-M2.7-highspeed';
const STOP_WORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'pada', 'adalah', 'ini', 'itu',
  'anda', 'kami', 'akan', 'dapat', 'bisa', 'silakan', 'tentang', 'informasi', 'lebih',
  'jika', 'ke', 'di', 'sebagai', 'oleh', 'dalam', 'tidak', 'sudah', 'agar', 'saat'
]);

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeRecordedText(value) {
  return String(value || '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[EMAIL]')
    .replace(/\b\d{5,}@s\.whatsapp\.net\b/giu, '[JID]')
    .replace(/([?&](?:nim|student_id|user_id|phone|wa|whatsapp)=)[^&#\s]+/giu, '$1[REDACTED]')
    .replace(/(?:\+?62|0)\s*8\d(?:[\s().-]*\d){6,12}/gu, '[PHONE]')
    .replace(/[A-Za-z]:\\[^\r\n]+/g, '[LOCAL_PATH]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/giu, '[SECRET]')
    .trim();
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
      inputUsdPerMillion: discounted ? values[1] : values[0],
      cachedInputUsdPerMillion: discounted ? values[2] : values[1],
      outputUsdPerMillion: discounted ? values[4] : values[2]
    }
  };
}

function isActiveFlow(flow) {
  if (flow?.is_active !== undefined) return Number(flow.is_active) === 1;
  return String(flow?.status || '').toUpperCase() === 'ACTIVE';
}

function tokenizeForQuality(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}.-]*/gu) || [])
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function normalizeFreeformTopic(source) {
  const keywords = source.documents[0]?.metadata?.flow_keywords || [];
  const cleanName = String(source.flowName || '')
    .replace(/^\s*(?:menu|nomor|no\.?|flow)?\s*\d+\s*[-.):]*\s*/iu, '')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^A\s+(?=biaya\b)/iu, '')
    .replace(/\bBIaya\b/gu, 'Biaya')
    .replace(/pendafatran/giu, 'pendaftaran')
    .replace(/tranking/giu, 'tracking')
    .trim();
  if (/^salut$/iu.test(cleanName)) return 'layanan SALUT Awwabin';
  if (/^prodi$/iu.test(cleanName)) return 'pilihan program studi';
  if (/[\p{L}\p{M}]{3}/u.test(cleanName)) return cleanName;
  const keyword = keywords.find((value) => /[\p{L}\p{M}]{3}/u.test(String(value || '')));
  return String(keyword || 'layanan untuk calon mahasiswa').trim();
}

function makeCases(sources, requestedCases, { questionMode = 'trigger', randomSeed = '20260910' } = {}) {
  const eligibleSources = sources.filter((source) => {
    if (source.documents.length === 0) return false;
    if (questionMode !== 'freeform') return true;
    const topic = normalizeFreeformTopic(source).toLowerCase();
    return topic !== 'menu' && topic !== 'main menu';
  });
  const candidates = eligibleSources
    .sort((left, right) => {
      if (questionMode === 'freeform') {
        return sha256(`${randomSeed}:${left.contentHash}`).localeCompare(sha256(`${randomSeed}:${right.contentHash}`));
      }
      return left.flowId - right.flowId;
    })
    .slice(0, requestedCases);
  const documentFrequency = new Map();
  for (const source of candidates) {
    const words = new Set(tokenizeForQuality(source.documents.map((document) => document.text).join('\n')));
    for (const word of words) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }

  return candidates.map((source, index) => {
    const knowledge = serializeSourceKnowledge(source);
    const words = [...new Set(tokenizeForQuality(knowledge))]
      .sort((left, right) => {
        const frequencyDelta = (documentFrequency.get(left) || 0) - (documentFrequency.get(right) || 0);
        return frequencyDelta || right.length - left.length || left.localeCompare(right);
      });
    const structured = knowledge.match(
      /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:Rp\.?\s*)?\d[\d.,/-]*|\+?\d[\d\s().-]{5,}\d/giu
    ) || [];
    const structuredTokens = structured.flatMap(tokenizeForQuality);
    const anchors = [...new Set([...structuredTokens, ...words])].slice(0, 6);
    const keywords = source.documents[0]?.metadata?.flow_keywords || [];
    const question = String(keywords[0] || source.flowName || '').trim();
    return {
      id: sha256(`${source.contentHash}:${index}`).slice(0, 12),
      cap: [250, 512, 2048][index % 3],
      question,
      flowName: source.flowName,
      freeformTopic: normalizeFreeformTopic(source),
      knowledge,
      anchors
    };
  }).filter((testCase) => testCase.question && testCase.anchors.length > 0);
}

function makeConversationQuestion(testCase, { questionMode = 'trigger', randomSeed = '20260910' } = {}) {
  if (questionMode === 'freeform') {
    const topic = String(testCase.freeformTopic || '').trim().replace(/[?.!]+$/u, '');
    const embeddedTopic = `${topic.charAt(0).toLocaleLowerCase('id-ID')}${topic.slice(1)}`
      .replace(/\bRiwayat Hidup\b/gu, 'riwayat hidup')
      .replace(/\bWisuda\b/gu, 'wisuda');
    if (/^(?:apakah|kapan|bagaimana|berapa|bisakah|bolehkah)\b/iu.test(topic)) {
      return `Kak, ${embeddedTopic.replace(/^kapan Mulai Kuliah$/u, 'kapan mulai kuliah')}? Saya ingin penjelasan yang mudah dipahami.`;
    }
    const templates = [
      `Kak, saya sedang mempertimbangkan kuliah dan ingin tahu soal ${embeddedTopic}. Bisa dijelaskan?`,
      `Bisa jelaskan informasi ${embeddedTopic} dengan bahasa yang mudah dipahami?`,
      `Saya masih bingung soal ${embeddedTopic}. Apa yang perlu saya ketahui?`,
      `Kalau saya ingin tahu tentang ${embeddedTopic}, informasi pentingnya apa saja ya?`,
      `Boleh bantu jelaskan ${embeddedTopic} untuk calon mahasiswa seperti saya?`
    ];
    const selector = Number.parseInt(sha256(`${randomSeed}:${testCase.id}`).slice(0, 8), 16);
    return templates[selector % templates.length];
  }
  return `Saya ingin bertanya tentang ${testCase.question}. Bisa dijelaskan dengan singkat dan jelas?`;
}

function serializeSourceKnowledge(source) {
  const keywords = source.documents[0]?.metadata?.flow_keywords || [];
  return [
    `Alur: ${source.flowName}`,
    keywords.length > 0 ? `Kata Kunci: ${keywords.join(', ')}` : '',
    `Isi Pesan:\n${source.documents.map((document) => `- ${document.text}`).join('\n')}`
  ].filter(Boolean).join('\n');
}

function serializeFullKnowledge(sources) {
  return sources.map(serializeSourceKnowledge).join('\n\n');
}

function qualityResult(content, anchors) {
  const responseTokens = new Set(tokenizeForQuality(content));
  const matched = anchors.filter((anchor) => responseTokens.has(anchor)).length;
  const recall = anchors.length > 0 ? matched / anchors.length : 0;
  return { pass: recall >= 0.5, recall };
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length === 0 ? null : Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function percentile(values, target) {
  const usable = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (usable.length === 0) return null;
  return usable[Math.max(0, Math.ceil((target / 100) * usable.length) - 1)];
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

function summarizeRecords(records) {
  const successful = records.filter((record) => record.status === 'SUCCEEDED');
  const known = successful.filter((record) => Number.isInteger(record.inputTokens) && Number.isInteger(record.outputTokens));
  const totals = known.reduce((result, record) => ({
    input: result.input + record.inputTokens,
    output: result.output + record.outputTokens,
    cached: result.cached + (record.cachedTokens || 0),
    reasoning: result.reasoning + (record.reasoningTokens || 0)
  }), { input: 0, output: 0, cached: 0, reasoning: 0 });
  const finishReasons = {};
  for (const record of successful) {
    const reason = record.finishReason || 'UNKNOWN';
    finishReasons[reason] = (finishReasons[reason] || 0) + 1;
  }
  return {
    attempts: records.length,
    succeeded: successful.length,
    failed: records.length - successful.length,
    quality_passed: successful.filter((record) => record.qualityPass).length,
    quality_denominator: successful.length,
    anchor_recall_average_milli: average(successful.map((record) => Math.round(record.anchorRecall * 1000))),
    usage_known: known.length,
    cached_detail_known: successful.filter((record) => Number.isInteger(record.cachedTokens)).length,
    reasoning_detail_known: successful.filter((record) => Number.isInteger(record.reasoningTokens)).length,
    input_tokens_average: average(known.map((record) => record.inputTokens)),
    output_tokens_average: average(known.map((record) => record.outputTokens)),
    token_totals: totals,
    latency_ms_average: average(successful.map((record) => record.latencyMs)),
    latency_ms_p95: percentile(successful.map((record) => record.latencyMs), 95),
    finish_reasons: finishReasons,
    failed_case_hashes: records.filter((record) => record.status === 'FAILED').map((record) => record.id)
  };
}

function estimateCost(records, rates) {
  return records.reduce((sum, record) => {
    if (!Number.isInteger(record.inputTokens) || !Number.isInteger(record.outputTokens)) return sum;
    const cached = Number.isInteger(record.cachedTokens) ? record.cachedTokens : 0;
    return sum + (
      Math.max(0, record.inputTokens - cached) * rates.inputUsdPerMillion
      + cached * rates.cachedInputUsdPerMillion
      + record.outputTokens * rates.outputUsdPerMillion
    ) / 1_000_000;
  }, 0);
}

function parseJudgeResult(content) {
  const match = String(content || '').match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const score = (name) => {
      const value = Number(parsed[name]);
      return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
    };
    const result = {
      groundedness: score('groundedness'),
      relevance: score('relevance'),
      completeness: score('completeness'),
      persona_adherence: score('persona_adherence'),
      naturalness: score('naturalness'),
      unsupported_claim: parsed.unsupported_claim === true,
      note: sanitizeRecordedText(parsed.note).slice(0, 300)
    };
    if (Object.values(result).slice(0, 5).some((value) => value === null)) return null;
    result.pass = result.groundedness >= 4
      && result.relevance >= 4
      && result.persona_adherence >= 4
      && result.naturalness >= 4
      && !result.unsupported_claim;
    return result;
  } catch {
    return null;
  }
}

function summarizeJudgements(records) {
  const valid = records.filter((record) => record.judgement);
  const fields = ['groundedness', 'relevance', 'completeness', 'persona_adherence', 'naturalness'];
  return {
    evaluated: records.length,
    valid_judgements: valid.length,
    passed: valid.filter((record) => record.judgement.pass).length,
    unsupported_claims: valid.filter((record) => record.judgement.unsupported_claim).length,
    score_average_milli: Object.fromEntries(fields.map((field) => [
      field,
      average(valid.map((record) => record.judgement[field] * 1000))
    ]))
  };
}

let stage = 'arguments';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const flowPath = resolve(args['flow-file'] || '../ChatBot-Flow (2).json');
  const personaPath = resolve(args['persona-file'] || '../PersonaChatBot.txt');
  const credentialsPath = resolve(args['credentials-file'] || '../apiDevelopment.txt');
  const requestedCases = Number.parseInt(args.cases || '20', 10);
  const concurrency = Number.parseInt(args.concurrency || '4', 10);
  const useProvider = String(args.provider || 'false').toLowerCase() === 'true';
  const conversationMode = String(args.conversation || 'false').toLowerCase() === 'true';
  const useJudge = conversationMode && String(args.judge || 'true').toLowerCase() === 'true';
  const questionMode = String(args['question-mode'] || 'trigger').toLowerCase();
  const randomSeed = String(args.seed || '20260910').slice(0, 64);
  const conversationOutputCap = Number.parseInt(args['answer-cap'] || '512', 10);
  const judgeOutputCap = Number.parseInt(args['judge-cap'] || '512', 10);
  const model = args.model || DEFAULT_MODEL;
  const temperature = Number(args.temperature ?? 0.3);
  if (!Number.isInteger(requestedCases) || requestedCases < 1 || requestedCases > 50) {
    throw Object.assign(new Error('Jumlah case tidak valid.'), { code: 'INVALID_CASE_COUNT' });
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw Object.assign(new Error('Concurrency tidak valid.'), { code: 'INVALID_CONCURRENCY' });
  }
  if (conversationMode && (!Number.isInteger(conversationOutputCap) || conversationOutputCap < 64 || conversationOutputCap > 2048)) {
    throw Object.assign(new Error('Answer cap percakapan tidak valid.'), { code: 'INVALID_CONVERSATION_OUTPUT_CAP' });
  }
  if (useJudge && (!Number.isInteger(judgeOutputCap) || judgeOutputCap < 64 || judgeOutputCap > 2048)) {
    throw Object.assign(new Error('Judge cap percakapan tidak valid.'), { code: 'INVALID_JUDGE_OUTPUT_CAP' });
  }
  if (!['trigger', 'freeform'].includes(questionMode) || (questionMode === 'freeform' && !conversationMode)) {
    throw Object.assign(new Error('Question mode tidak valid untuk konfigurasi ini.'), { code: 'INVALID_QUESTION_MODE' });
  }

  stage = 'read_development_sources';
  const [flowBuffer, personaBuffer] = await Promise.all([readFile(flowPath), readFile(personaPath)]);
  const parsed = JSON.parse(flowBuffer.toString('utf8'));
  const flows = Array.isArray(parsed) ? parsed : parsed.flows;
  if (!Array.isArray(flows)) throw Object.assign(new Error('Format Flow tidak didukung.'), { code: 'INVALID_FLOW_EXPORT' });
  const persona = personaBuffer.toString('utf8').trim();
  const activeFlows = flows.filter(isActiveFlow);
  const activeSources = activeFlows
    .map((flow) => extractFlowKnowledgeSource(flow, { userId: 1 }))
    .filter((source) => source.documents.length > 0);
  const testCases = makeCases(activeSources, requestedCases, { questionMode, randomSeed })
    .map((testCase) => ({
      ...testCase,
      conversationQuestion: conversationMode
        ? makeConversationQuestion(testCase, { questionMode, randomSeed })
        : testCase.question
    }));
  if (questionMode === 'freeform' && testCases.some((testCase) => (
    !testCase.conversationQuestion.includes('?')
    || /\b(?:menu|nomor|no\.?)\s*\d+\b|\btentang\s+\d+\b/iu.test(testCase.conversationQuestion)
  ))) {
    throw Object.assign(new Error('Pertanyaan freeform masih bergantung pada nomor Flow.'), { code: 'INVALID_FREEFORM_QUESTION' });
  }
  if (testCases.length < requestedCases) {
    throw Object.assign(new Error('Case aktual yang dapat diuji tidak mencukupi.'), { code: 'INSUFFICIENT_ACTUAL_CASES' });
  }
  const fullKnowledge = serializeFullKnowledge(activeSources);
  const fullPromptEstimate = estimateRagTokens(buildProductionSystemPrompt({
    systemInstruction: persona,
    knowledgeBase: fullKnowledge
  }));
  const oraclePromptEstimates = testCases.map((testCase) => estimateRagTokens(buildProductionSystemPrompt({
    systemInstruction: persona,
    knowledgeBase: testCase.knowledge
  })));
  const chunks = activeSources.flatMap((source) => chunkKnowledgeDocuments(source.documents));
  const baseSummary = {
    evidence_kind: useProvider
      ? 'SANITIZED_DEVELOPMENT_STAGING_LIKE_PROVIDER_PROBE'
      : 'SANITIZED_DEVELOPMENT_STAGING_LIKE_OFFLINE_CHECK',
    executed_at_utc: new Date().toISOString(),
    development_only: true,
    content_logged: conversationMode ? 'REDACTED_CHAT_TRANSCRIPT_ONLY' : false,
    response_content_logged: conversationMode ? 'REDACTED_CHAT_TRANSCRIPT_ONLY' : false,
    flow_source: {
      filename: basename(flowPath),
      sha256: sha256(flowBuffer),
      bytes: flowBuffer.length,
      total_flows: flows.length,
      active_flows: activeFlows.length,
      indexable_active_sources: activeSources.length,
      skipped_active_sources_without_indexable_text: activeFlows.length - activeSources.length,
      extracted_documents: activeSources.reduce((sum, source) => sum + source.documents.length, 0),
      chunks: chunks.length
    },
    persona_source: {
      filename: basename(personaPath),
      sha256: sha256(personaBuffer),
      bytes: personaBuffer.length,
      estimated_tokens: estimateRagTokens(persona)
    },
    selected_cases: testCases.length,
    selected_case_digest_sha256: sha256(JSON.stringify(testCases.map((testCase) => ({
      id: testCase.id,
      cap: testCase.cap,
      source: sha256(testCase.knowledge),
      question: testCase.conversationQuestion
    })))),
    ...(conversationMode ? {
      conversation_configuration: {
        question_mode: questionMode,
        random_seed: randomSeed,
        planned_questions: testCases.map((testCase) => ({
          case_id: testCase.id,
          chat_sent: sanitizeRecordedText(testCase.conversationQuestion),
          gold_source_hash: sha256(testCase.knowledge).slice(0, 16)
        }))
      }
    } : {}),
    local_prompt_estimates: {
      current_full_kb_tokens: fullPromptEstimate,
      oracle_rag_tokens_average: average(oraclePromptEstimates),
      oracle_rag_tokens_max: Math.max(...oraclePromptEstimates),
      estimated_reduction_percent: Number((100 * (1 - average(oraclePromptEstimates) / fullPromptEstimate)).toFixed(2)),
      note: 'Oracle source selection measures generation context only and does not prove retrieval accuracy.'
    }
  };

  if (!useProvider) {
    process.stdout.write(`${JSON.stringify(baseSummary, null, 2)}\n`);
    return;
  }

  stage = 'read_credentials';
  const credentialRaw = await readFile(credentialsPath, 'utf8');
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

  const requests = testCases.flatMap((testCase) => [
    {
      ...testCase,
      question: testCase.conversationQuestion,
      cap: conversationMode ? conversationOutputCap : testCase.cap,
      profile: 'CURRENT_FULL_KB',
      knowledge: fullKnowledge,
      oracleKnowledge: testCase.knowledge
    },
    {
      ...testCase,
      question: testCase.conversationQuestion,
      cap: conversationMode ? conversationOutputCap : testCase.cap,
      profile: 'ORACLE_RAG',
      knowledge: testCase.knowledge,
      oracleKnowledge: testCase.knowledge
    }
  ]);
  stage = 'provider_requests';
  const records = await mapLimit(requests, concurrency, async (request) => {
    const startedAt = Date.now();
    try {
      const response = await client.chat.completions.create(buildChatCompletionPayload({
        model,
        messages: buildProductionMessages({
          systemInstruction: persona,
          knowledgeBase: request.knowledge,
          userMessage: request.question
        }),
        maxOutputTokens: request.cap,
        temperature,
        requestKind: 'sandbox'
      }));
      const content = response.choices?.[0]?.message?.content || '';
      const quality = qualityResult(content, request.anchors);
      return {
        id: request.id,
        profile: request.profile,
        cap: request.cap,
        status: 'SUCCEEDED',
        qualityPass: quality.pass,
        anchorRecall: quality.recall,
        finishReason: response.choices?.[0]?.finish_reason || null,
        inputTokens: response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? response.usage?.output_tokens ?? null,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens
          ?? response.usage?.input_tokens_details?.cached_tokens
          ?? null,
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens
          ?? response.usage?.output_tokens_details?.reasoning_tokens
          ?? null,
        latencyMs: Date.now() - startedAt,
        question: request.question,
        content,
        oracleKnowledge: request.oracleKnowledge
      };
    } catch (error) {
      return {
        id: request.id,
        profile: request.profile,
        cap: request.cap,
        status: 'FAILED',
        qualityPass: false,
        anchorRecall: 0,
        latencyMs: Date.now() - startedAt,
        errorStatus: Number.isInteger(error?.status) ? error.status : null,
        errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
      };
    }
  });

  const fullRecords = records.filter((record) => record.profile === 'CURRENT_FULL_KB');
  const ragRecords = records.filter((record) => record.profile === 'ORACLE_RAG');

  let judgeRecords = [];
  if (useJudge) {
    stage = 'judge_requests';
    judgeRecords = await mapLimit(records.filter((record) => record.status === 'SUCCEEDED'), concurrency, async (record) => {
      const startedAt = Date.now();
      try {
        const judgeResponse = await client.chat.completions.create(buildChatCompletionPayload({
          model,
          messages: [
            {
              role: 'system',
              content: [
                'Anda adalah evaluator jawaban chatbot berbahasa Indonesia.',
                'Nilai hanya berdasarkan persona, knowledge rujukan, pertanyaan, dan jawaban yang diberikan.',
                'Kembalikan JSON valid tanpa markdown dengan field integer 1-5: groundedness, relevance, completeness, persona_adherence, naturalness; boolean unsupported_claim; dan note maksimal 25 kata.',
                'Skor 5 berarti sangat baik. Tandai unsupported_claim=true bila jawaban membuat fakta spesifik yang tidak didukung knowledge.'
              ].join(' ')
            },
            {
              role: 'user',
              content: [
                `PERSONA:\n${persona}`,
                `KNOWLEDGE RUJUKAN:\n${record.oracleKnowledge}`,
                `CHAT DIKIRIM:\n${record.question}`,
                `CHAT DIBALAS:\n${record.content}`
              ].join('\n\n')
            }
          ],
          maxOutputTokens: judgeOutputCap,
          temperature: 0,
          requestKind: 'sandbox'
        }));
        return {
          id: record.id,
          profile: record.profile,
          status: 'SUCCEEDED',
          judgement: parseJudgeResult(judgeResponse.choices?.[0]?.message?.content),
          inputTokens: judgeResponse.usage?.prompt_tokens ?? judgeResponse.usage?.input_tokens ?? null,
          outputTokens: judgeResponse.usage?.completion_tokens ?? judgeResponse.usage?.output_tokens ?? null,
          cachedTokens: judgeResponse.usage?.prompt_tokens_details?.cached_tokens
            ?? judgeResponse.usage?.input_tokens_details?.cached_tokens
            ?? null,
          reasoningTokens: judgeResponse.usage?.completion_tokens_details?.reasoning_tokens
            ?? judgeResponse.usage?.output_tokens_details?.reasoning_tokens
            ?? null,
          finishReason: judgeResponse.choices?.[0]?.finish_reason || null,
          latencyMs: Date.now() - startedAt
        };
      } catch (error) {
        return {
          id: record.id,
          profile: record.profile,
          status: 'FAILED',
          judgement: null,
          latencyMs: Date.now() - startedAt,
          errorStatus: Number.isInteger(error?.status) ? error.status : null,
          errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
        };
      }
    });
    const judgementByRecord = new Map(judgeRecords.map((record) => [`${record.id}:${record.profile}`, record.judgement]));
    for (const record of records) record.judgement = judgementByRecord.get(`${record.id}:${record.profile}`) || null;
  }
  const fullSummary = summarizeRecords(fullRecords);
  const ragSummary = summarizeRecords(ragRecords);
  const actualReduction = fullSummary.input_tokens_average && ragSummary.input_tokens_average
    ? Number((100 * (1 - ragSummary.input_tokens_average / fullSummary.input_tokens_average)).toFixed(2))
    : null;
  const output = {
    ...baseSummary,
    credential_source: basename(credentialsPath),
    credential_logged: false,
    provider_host: new URL(safeBaseUrl).hostname,
    model,
    temperature,
    sdk_max_retries: 0,
    concurrency,
    profiles: {
      current_full_kb: fullSummary,
      oracle_rag: ragSummary
    },
    actual_input_token_reduction_percent: actualReduction,
    rate_snapshot_from_local_catalog: rates,
    estimated_total_chat_cost_usd: Number(estimateCost(records, rates).toFixed(9)),
    ...(conversationMode ? {
      conversation_experiment: {
        question_source: questionMode === 'freeform'
          ? 'Seeded-random active Flow topics rendered as natural customer questions without menu-number invocation.'
          : 'Deterministic natural-language prompts derived from active Flow trigger keywords.',
        question_mode: questionMode,
        random_seed: randomSeed,
        answer_output_cap: conversationOutputCap,
        judge_output_cap: judgeOutputCap,
        conversation_case_digest_sha256: sha256(JSON.stringify(records.map((record) => ({
          id: record.id,
          profile: record.profile,
          question: record.question,
          oracle_source: sha256(record.oracleKnowledge)
        })))),
        transcript_redaction: ['email', 'phone', 'JID', 'local path', 'secret-like value'],
        judge_enabled: useJudge,
        judge_usage: summarizeRecords(judgeRecords),
        estimated_judge_cost_usd: Number(estimateCost(judgeRecords, rates).toFixed(9)),
        profile_judgements: {
          current_full_kb: summarizeJudgements(fullRecords),
          oracle_rag: summarizeJudgements(ragRecords)
        },
        conversations: testCases.map((testCase) => {
          const variants = records.filter((record) => record.id === testCase.id);
          return {
            case_id: testCase.id,
            chat_sent: sanitizeRecordedText(variants[0]?.question),
            replies: variants.map((record) => ({
              profile: record.profile,
              chat_replied: sanitizeRecordedText(record.content),
              input_tokens: record.inputTokens,
              output_tokens: record.outputTokens,
              cached_tokens: record.cachedTokens,
              reasoning_tokens: record.reasoningTokens,
              latency_ms: record.latencyMs,
              finish_reason: record.finishReason,
              judgement: record.judgement
            }))
          };
        })
      },
      estimated_total_experiment_cost_usd: Number(estimateCost([...records, ...judgeRecords], rates).toFixed(9))
    } : {}),
    billing_reconciled: false,
    limitations: [
      'Oracle source selection does not prove retrieval accuracy.',
      ...(useJudge ? ['The provider model also acts as judge; scores are development indicators, not independent review.'] : []),
      ...(conversationMode ? ['Only redacted synthetic test chat/reply transcripts may be recorded; source files and credentials remain excluded.'] : []),
      'Development snapshots are not runtime, staging deployment, or UAT evidence.'
    ]
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: 'RAG_DEVELOPMENT_PROBE_FAILED',
    stage,
    type: error?.name || 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    status: Number.isInteger(error?.status) ? error.status : null
  })}\n`);
  process.exitCode = 1;
});
