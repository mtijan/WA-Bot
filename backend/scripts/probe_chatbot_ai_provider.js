import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { OpenAI } from 'openai';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../src/utils/outbound_url.js';
import { buildChatCompletionPayload } from '../src/services/chatbot_ai_runtime.service.js';

const DEFAULT_BASE_URL = 'https://ai.sumopod.com/v1';
const DEFAULT_MODEL = 'MiniMax-M2.7-highspeed';

const KNOWLEDGE_BASE = `
Gunakan hanya fakta sintetis berikut. Jawab pertanyaan faktual secara langsung dan pertahankan angka/kode persis.
1. Pendaftaran dibuka 14 Januari 2027.
2. Biaya formulir adalah Rp350.000.
3. Batas beasiswa adalah 28 Februari 2027.
4. Status akreditasi institusi adalah Unggul.
5. Nomor layanan admisi adalah 021-555-0142.
6. Email admisi adalah admisi@example.test.
7. Portal pendaftaran adalah https://portal.example.test/daftar.
8. Dokumen wajib adalah KTP dan ijazah.
9. Pembayaran ditujukan ke Bank Nusantara.
10. Pengembalian biaya diproses paling lama 7 hari kerja.
11. Jam layanan adalah Senin-Jumat 08.00-16.00 WIB.
12. Kelas malam berada di Kampus Selatan.
13. Kuota program adalah 120 mahasiswa.
14. Kode daftar ulang adalah REG-2027.
15. Program baru bernama Data Science.
Jika informasi tidak tersedia, nyatakan bahwa informasi belum tersedia dan arahkan ke customer service.
`.trim();

const CASES = [
  ['opening-date', 250, 'Kapan pendaftaran dibuka?', ['14 januari 2027']],
  ['form-fee', 250, 'Berapa biaya formulir?', ['350.000']],
  ['scholarship', 250, 'Kapan batas pendaftaran beasiswa?', ['28 februari 2027']],
  ['accreditation', 250, 'Apa status akreditasi institusi?', ['unggul']],
  ['phone', 250, 'Berapa nomor layanan admisi?', ['021-555-0142']],
  ['email', 250, 'Apa email admisi?', ['admisi@example.test']],
  ['portal', 512, 'Berikan portal pendaftaran.', ['https://portal.example.test/daftar']],
  ['documents', 512, 'Dokumen apa yang wajib?', ['ktp', 'ijazah']],
  ['bank', 512, 'Pembayaran ditujukan ke bank apa?', ['bank nusantara']],
  ['refund', 512, 'Berapa lama proses pengembalian biaya?', ['7 hari kerja']],
  ['hours', 512, 'Sebutkan jam layanan.', ['senin-jumat', '08.00-16.00']],
  ['evening-campus', 512, 'Kelas malam berada di mana?', ['kampus selatan']],
  ['quota', 2048, 'Berapa kuota program?', ['120 mahasiswa']],
  ['registration-code', 2048, 'Apa kode daftar ulang?', ['reg-2027']],
  ['program', 2048, 'Apa nama program baru?', ['data science']],
  ['multi-fact', 2048, 'Sebutkan tanggal pembukaan dan biaya formulir.', ['14 januari 2027', '350.000']],
  ['typo', 2048, 'Kapan batas beassiswa?', ['28 februari 2027']],
  ['cap-250', 250, 'Mulai dengan kode REG-2027, lalu buat 160 butir saran persiapan daftar ulang bernomor.', ['reg-2027']],
  ['cap-512', 512, 'Mulai dengan nama Data Science, lalu buat 320 butir manfaat belajar teknologi bernomor.', ['data science']],
  ['cap-2048', 2048, 'Mulai dengan Bank Nusantara, lalu buat 900 butir panduan pembayaran bernomor.', ['bank nusantara']]
].map(([id, cap, question, expected]) => ({ id, cap, question, expected }));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const [rawKey, inlineValue] = current.slice(2).split('=', 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    args[rawKey] = value;
  }
  return args;
}

function extractCredentialAndRates(raw, model) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const keyMatch = lines
    .map((line) => line.match(/^api\s*key\s*[:=]\s*(.+)$/i))
    .find(Boolean);
  const apiKey = keyMatch?.[1]?.trim();
  if (!apiKey) {
    const error = new Error('API key tidak ditemukan dalam credentials file.');
    error.code = 'CREDENTIAL_KEY_MISSING';
    throw error;
  }

  const modelIndex = lines.findIndex((line) => line.toLowerCase() === model.toLowerCase());
  if (modelIndex < 0) {
    const error = new Error(`Model ${model} tidak ditemukan dalam katalog credentials file.`);
    error.code = 'MODEL_MISSING';
    throw error;
  }

  const priceValues = lines
    .slice(modelIndex + 1, modelIndex + 15)
    .map((line) => line.match(/^\$([0-9]+(?:\.[0-9]+)?)/)?.[1])
    .filter(Boolean)
    .map(Number);
  if (priceValues.length < 3) {
    const error = new Error(`Struktur harga ${model} tidak dapat dibaca.`);
    error.code = 'PRICE_PARSE_FAILED';
    throw error;
  }
  const discountedLayout = priceValues.length >= 5;
  return {
    apiKey,
    rates: {
      inputUsdPerMillion: discountedLayout ? priceValues[1] : priceValues[0],
      cachedInputUsdPerMillion: discountedLayout ? priceValues[2] : priceValues[1],
      outputUsdPerMillion: discountedLayout ? priceValues[4] : priceValues[2]
    }
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1];
}

function average(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarizeByCap(records) {
  return Object.fromEntries([250, 512, 2048].map((cap) => {
    const scoped = records.filter((record) => record.cap === cap);
    const successful = scoped.filter((record) => record.status === 'SUCCEEDED');
    const finishReasons = {};
    for (const record of successful) {
      finishReasons[record.finishReason || 'UNKNOWN'] = (finishReasons[record.finishReason || 'UNKNOWN'] || 0) + 1;
    }
    return [String(cap), {
      attempts: scoped.length,
      succeeded: successful.length,
      failed: scoped.length - successful.length,
      input_tokens_avg: average(successful.map((record) => record.inputTokens).filter(Number.isInteger)),
      output_tokens_avg: average(successful.map((record) => record.outputTokens).filter(Number.isInteger)),
      output_tokens_max: successful.reduce((maximum, record) => Math.max(maximum, record.outputTokens || 0), 0),
      latency_ms_p95: percentile(successful.map((record) => record.latencyMs), 95),
      finish_reasons: finishReasons
    }];
  }));
}

let probeStage = 'parse_arguments';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentialPath = resolve(args['credentials-file'] || '../apiDevelopment.txt');
  const model = args.model || DEFAULT_MODEL;
  const requestedRuns = Number.parseInt(args.runs || '20', 10);
  const temperature = Number(args.temperature ?? 0.3);
  if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > CASES.length) {
    throw new Error(`--runs harus berupa integer 1-${CASES.length}.`);
  }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('--temperature harus berupa angka 0-2.');
  }

  probeStage = 'read_credentials';
  const raw = await readFile(credentialPath, 'utf8');
  probeStage = 'parse_credentials_catalog';
  const { apiKey, rates } = extractCredentialAndRates(raw, model);
  probeStage = 'validate_provider_url';
  const safeBaseUrl = await assertSafeOutboundUrl(args['base-url'] || DEFAULT_BASE_URL);
  const client = new OpenAI({
    apiKey,
    baseURL: safeBaseUrl,
    timeout: 45000,
    maxRetries: 0,
    fetch: createSafeOutboundFetch()
  });

  probeStage = 'provider_requests';
  const selectedCases = CASES.slice(0, requestedRuns);
  const records = [];
  for (const testCase of selectedCases) {
    const startedAt = Date.now();
    try {
      const response = await client.chat.completions.create(buildChatCompletionPayload({
        model,
        messages: [
          { role: 'system', content: KNOWLEDGE_BASE },
          { role: 'user', content: testCase.question }
        ],
        maxOutputTokens: testCase.cap,
        temperature,
        requestKind: 'sandbox'
      }));
      const content = response.choices?.[0]?.message?.content || '';
      const normalized = content.toLowerCase();
      records.push({
        id: testCase.id,
        caseKind: testCase.id.startsWith('cap-') ? 'CAP_STRESS' : 'GROUNDED_FACT',
        cap: testCase.cap,
        status: 'SUCCEEDED',
        qualityPass: testCase.expected.every((value) => normalized.includes(value)),
        finishReason: response.choices?.[0]?.finish_reason || null,
        inputTokens: response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? response.usage?.output_tokens ?? null,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens
          ?? response.usage?.input_tokens_details?.cached_tokens
          ?? null,
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens
          ?? response.usage?.output_tokens_details?.reasoning_tokens
          ?? null,
        latencyMs: Date.now() - startedAt
      });
    } catch (error) {
      records.push({
        id: testCase.id,
        caseKind: testCase.id.startsWith('cap-') ? 'CAP_STRESS' : 'GROUNDED_FACT',
        cap: testCase.cap,
        status: 'FAILED',
        qualityPass: false,
        latencyMs: Date.now() - startedAt,
        error: {
          status: Number.isInteger(error?.status) ? error.status : null,
          code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
          type: typeof error?.type === 'string' ? error.type.slice(0, 80) : error?.name || 'Error'
        }
      });
    }
  }

  const successful = records.filter((record) => record.status === 'SUCCEEDED');
  const qualityRecords = records.filter((record) => record.caseKind === 'GROUNDED_FACT');
  const capStressRecords = records.filter((record) => record.caseKind === 'CAP_STRESS');
  const knownUsage = successful.filter((record) => Number.isInteger(record.inputTokens) && Number.isInteger(record.outputTokens));
  const totals = knownUsage.reduce((result, record) => ({
    inputTokens: result.inputTokens + record.inputTokens,
    outputTokens: result.outputTokens + record.outputTokens,
    cachedTokens: result.cachedTokens + (record.cachedTokens || 0),
    reasoningTokens: result.reasoningTokens + (record.reasoningTokens || 0)
  }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 });
  const uncachedInputTokens = Math.max(0, totals.inputTokens - totals.cachedTokens);
  const estimatedCostUsd = (
    uncachedInputTokens * rates.inputUsdPerMillion
    + totals.cachedTokens * rates.cachedInputUsdPerMillion
    + totals.outputTokens * rates.outputUsdPerMillion
  ) / 1_000_000;

  const summary = {
    evidence_kind: 'SANITIZED_SYNTHETIC_PROVIDER_PROBE',
    executed_at_utc: new Date().toISOString(),
    credential_source: basename(credentialPath),
    credential_logged: false,
    response_content_logged: false,
    provider_host: new URL(safeBaseUrl).hostname,
    model,
    sdk_max_retries: 0,
    temperature,
    dataset_digest_sha256: createHash('sha256')
      .update(JSON.stringify({ knowledge: KNOWLEDGE_BASE, cases: selectedCases }))
      .digest('hex'),
    attempts: records.length,
    succeeded: successful.length,
    failed: records.length - successful.length,
    grounded_fact_checks: {
      passed: qualityRecords.filter((record) => record.qualityPass).length,
      denominator: qualityRecords.length,
      failed_case_ids: qualityRecords.filter((record) => !record.qualityPass).map((record) => record.id)
    },
    cap_stress_instruction_checks: {
      passed: capStressRecords.filter((record) => record.qualityPass).length,
      denominator: capStressRecords.length,
      failed_case_ids: capStressRecords.filter((record) => !record.qualityPass).map((record) => record.id)
    },
    usage_known: knownUsage.length,
    cached_detail_known: successful.filter((record) => Number.isInteger(record.cachedTokens)).length,
    reasoning_detail_known: successful.filter((record) => Number.isInteger(record.reasoningTokens)).length,
    token_totals: {
      input: totals.inputTokens,
      output: totals.outputTokens,
      cached_input: totals.cachedTokens,
      reasoning_output: totals.reasoningTokens
    },
    latency_ms: {
      average: average(successful.map((record) => record.latencyMs)),
      p95: percentile(successful.map((record) => record.latencyMs), 95)
    },
    by_output_cap: summarizeByCap(records),
    rate_snapshot_from_local_catalog: rates,
    estimated_chat_cost_usd: Number(estimatedCostUsd.toFixed(9)),
    billing_reconciled: false,
    failures: records.filter((record) => record.status === 'FAILED').map((record) => ({
      case_id: record.id,
      cap: record.cap,
      ...record.error
    }))
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: 'PROVIDER_PROBE_FAILED',
    stage: probeStage,
    type: error?.name || 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    status: Number.isInteger(error?.status) ? error.status : null
  })}\n`);
  process.exitCode = 1;
});
