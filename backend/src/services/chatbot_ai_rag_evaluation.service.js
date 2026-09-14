import { createRagRetrievalError } from './chatbot_ai_rag_retriever.service.js';

function requireRate(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} harus berada pada rentang 0 sampai 1.`
    );
  }
  return parsed;
}

const GENERATION_PROFILES = Object.freeze(['CURRENT_FULL_KB', 'RAG_HYBRID']);

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('id-ID')
    .replace(/(\d)\s*%/gu, '$1 persen')
    .replace(/[*_#`~]/gu, '')
    .replace(/[\u2010-\u2015]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isRequiredClaimSupported(answer, claim) {
  const normalizedAnswer = normalizeComparableText(answer);
  const normalizedClaim = normalizeComparableText(claim);
  if (normalizedAnswer.includes(normalizedClaim)) return true;
  const claimTokens = normalizedClaim.match(
    /https?:\/\/\S+|(?:\+?\d[\d.,:/-]*\d)|[\p{L}\p{M}\p{N}]+/gu
  ) || [];
  return claimTokens.length > 0 && claimTokens.every((token) => normalizedAnswer.includes(token));
}

function percentile(values, target) {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (usable.length === 0) return null;
  return usable[Math.max(0, Math.ceil((target / 100) * usable.length) - 1)];
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function normalizeTokenCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeLatency(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeJudgement(value) {
  if (!value || typeof value !== 'object') return null;
  const groundedness = Number(value.groundedness);
  const unsupportedClaim = value.unsupported_claim;
  if (!Number.isInteger(groundedness) || groundedness < 1 || groundedness > 5
      || typeof unsupportedClaim !== 'boolean') return null;
  return {
    groundedness,
    unsupported_claim: unsupportedClaim,
    pass: groundedness >= 4 && unsupportedClaim === false
  };
}

function calculateChatCost(record, rates) {
  if (record.input_tokens === null || record.output_tokens === null) return null;
  const cached = Math.min(record.input_tokens, record.cached_tokens || 0);
  return (
    (record.input_tokens - cached) * rates.input_usd_per_million
    + cached * rates.cached_input_usd_per_million
    + record.output_tokens * rates.output_usd_per_million
  ) / 1_000_000;
}

function summarizeGenerationProfile(records, rates, embeddingCostUsd) {
  const providerRecords = records.filter((record) => record.provider_called);
  const knownCostRecords = providerRecords.filter((record) => record.chat_cost_usd !== null);
  const answerableProviderRecords = providerRecords.filter((record) => record.answerable);
  const judgedAnswerable = answerableProviderRecords.filter((record) => record.judgement);
  const usefulOutcomes = records.filter((record) => record.useful_outcome);
  const chatCostUsd = knownCostRecords.reduce((sum, record) => sum + record.chat_cost_usd, 0);
  const retryAttempts = providerRecords.reduce(
    (sum, record) => sum + Math.max(0, record.provider_attempts - 1),
    0
  );
  const safeEmbeddingCostUsd = Number.isFinite(embeddingCostUsd) && embeddingCostUsd >= 0
    ? embeddingCostUsd : 0;
  const allInCostUsd = chatCostUsd + safeEmbeddingCostUsd;
  const latency = (field) => ({
    p50_ms: percentile(records.map((record) => record[field]), 50),
    p95_ms: percentile(records.map((record) => record[field]), 95)
  });
  return Object.freeze({
    cases: records.length,
    provider_calls: providerRecords.length,
    provider_attempts: providerRecords.reduce((sum, record) => sum + record.provider_attempts, 0),
    retry_attempts: retryAttempts,
    successful_provider_calls: providerRecords.filter((record) => record.status === 'SUCCEEDED').length,
    useful_outcomes: usefulOutcomes.length,
    useful_coverage_rate: records.length === 0 ? 0 : usefulOutcomes.length / records.length,
    required_claim_coverage_rate: answerableProviderRecords.length === 0 ? 0
      : answerableProviderRecords.filter((record) => record.required_claims_pass).length
        / answerableProviderRecords.length,
    judge_coverage_rate: answerableProviderRecords.length === 0 ? 0
      : judgedAnswerable.length / answerableProviderRecords.length,
    groundedness_rate: answerableProviderRecords.length === 0 ? 0
      : judgedAnswerable.filter((record) => record.judgement.pass).length
        / answerableProviderRecords.length,
    groundedness_rate_valid_judgements: judgedAnswerable.length === 0 ? 0
      : judgedAnswerable.filter((record) => record.judgement.pass).length / judgedAnswerable.length,
    hallucination_rate: judgedAnswerable.length === 0 ? 0
      : judgedAnswerable.filter((record) => record.judgement.unsupported_claim).length
        / judgedAnswerable.length,
    valid_judgements: judgedAnswerable.length,
    input_tokens: Object.freeze({
      total: providerRecords.reduce((sum, record) => sum + (record.input_tokens || 0), 0),
      average_per_provider_call: average(providerRecords.map((record) => record.input_tokens)),
      average_answerable_call: average(answerableProviderRecords.map((record) => record.input_tokens)),
      p95_per_provider_call: percentile(providerRecords.map((record) => record.input_tokens), 95)
    }),
    output_tokens: Object.freeze({
      total: providerRecords.reduce((sum, record) => sum + (record.output_tokens || 0), 0),
      average_per_provider_call: average(providerRecords.map((record) => record.output_tokens)),
      p95_per_provider_call: percentile(providerRecords.map((record) => record.output_tokens), 95)
    }),
    latency_ms: Object.freeze({
      retrieval: Object.freeze(latency('retrieval_latency_ms')),
      provider: Object.freeze({
        p50_ms: percentile(providerRecords.map((record) => record.provider_latency_ms), 50),
        p95_ms: percentile(providerRecords.map((record) => record.provider_latency_ms), 95)
      }),
      total: Object.freeze(latency('total_latency_ms'))
    }),
    cost_usd: Object.freeze({
      chat: chatCostUsd,
      embedding: safeEmbeddingCostUsd,
      retry_incremental: retryAttempts === 0 ? 0 : null,
      all_in: allInCostUsd,
      all_in_per_useful_outcome: usefulOutcomes.length === 0 ? null
        : allInCostUsd / usefulOutcomes.length,
      usage_known_calls: knownCostRecords.length,
      rate_snapshot: Object.freeze({ ...rates })
    }),
    failed_case_ids: Object.freeze(records.filter((record) => !record.useful_outcome)
      .map((record) => record.id))
  });
}

export function sanitizeRagEvaluationTranscript(value) {
  return String(value || '')
    .replace(/\b\d{5,}@s\.whatsapp\.net\b/giu, '[JID]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[EMAIL]')
    .replace(/([?&](?:nim|student_id|user_id|phone|wa|whatsapp)=)[^&#\s]+/giu, '$1[REDACTED]')
    .replace(/(?:\+?62|0)\s*8\d(?:[\s().-]*\d){6,12}/gu, '[PHONE]')
    .replace(/[A-Za-z]:\\[^\r\n]+/g, '[LOCAL_PATH]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/giu, '[SECRET]')
    .trim();
}

export function auditRagEvaluationEvidence(value, sensitiveValues = []) {
  const serialized = JSON.stringify(value);
  const detectedLabels = [];
  for (const item of sensitiveValues) {
    const label = requireEvaluationString(item?.label, 'sensitiveValues.label');
    const secretValue = requireEvaluationString(item?.value, `sensitiveValues.${label}.value`);
    if (serialized.includes(secretValue)) detectedLabels.push(label);
  }
  return Object.freeze({
    passed: detectedLabels.length === 0,
    detected_labels: Object.freeze(detectedLabels)
  });
}

export function evaluateRagGenerationOutcomes(outcomes, {
  rates = {},
  embeddingCostUsd = {}
} = {}) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'Hasil evaluasi generatif wajib berupa array non-kosong.'
    );
  }
  const safeRates = Object.freeze({
    input_usd_per_million: Number(rates.input_usd_per_million) || 0,
    cached_input_usd_per_million: Number(rates.cached_input_usd_per_million) || 0,
    output_usd_per_million: Number(rates.output_usd_per_million) || 0
  });
  if (Object.values(safeRates).some((value) => value < 0)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'Tarif evaluasi tidak boleh negatif.'
    );
  }

  const seen = new Set();
  const normalized = outcomes.map((outcome, index) => {
    const id = requireEvaluationString(outcome?.id, `outcomes[${index}].id`);
    const profile = requireEvaluationString(outcome?.profile, `${id}.profile`);
    if (!GENERATION_PROFILES.includes(profile)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.profile tidak didukung.`
      );
    }
    const uniqueKey = `${id}:${profile}`;
    if (seen.has(uniqueKey)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `Hasil generatif '${uniqueKey}' duplikat.`
      );
    }
    seen.add(uniqueKey);
    const answerable = outcome?.answerable === true;
    const requiredClaims = normalizeUniqueStrings(outcome?.required_claims || [], `${uniqueKey}.required_claims`);
    const answer = String(outcome?.answer || '').trim();
    const requiredClaimsPass = answerable && requiredClaims.length > 0
      ? requiredClaims.every((claim) => isRequiredClaimSupported(answer, claim))
      : !answerable;
    const providerCalled = outcome?.provider_called === true;
    const normalizedRecord = {
      id,
      profile,
      category: requireEvaluationString(outcome?.category, `${uniqueKey}.category`),
      answerable,
      status: requireEvaluationString(outcome?.status, `${uniqueKey}.status`),
      provider_called: providerCalled,
      provider_attempts: providerCalled
        ? Math.max(1, Number.isInteger(outcome?.provider_attempts) ? outcome.provider_attempts : 1)
        : 0,
      required_claims_pass: requiredClaimsPass,
      behavior_pass: answerable ? true : outcome?.behavior_pass === true,
      judgement: normalizeJudgement(outcome?.judgement),
      input_tokens: normalizeTokenCount(outcome?.input_tokens),
      output_tokens: normalizeTokenCount(outcome?.output_tokens),
      cached_tokens: normalizeTokenCount(outcome?.cached_tokens),
      retrieval_latency_ms: normalizeLatency(outcome?.retrieval_latency_ms),
      provider_latency_ms: normalizeLatency(outcome?.provider_latency_ms),
      total_latency_ms: normalizeLatency(outcome?.total_latency_ms)
    };
    normalizedRecord.chat_cost_usd = calculateChatCost(normalizedRecord, safeRates);
    normalizedRecord.useful_outcome = answerable
      ? normalizedRecord.status === 'SUCCEEDED'
        && normalizedRecord.required_claims_pass
        && normalizedRecord.judgement?.pass === true
      : normalizedRecord.behavior_pass;
    return Object.freeze(normalizedRecord);
  });

  const profiles = Object.fromEntries(GENERATION_PROFILES.map((profile) => [
    profile,
    summarizeGenerationProfile(
      normalized.filter((record) => record.profile === profile),
      safeRates,
      Number(embeddingCostUsd?.[profile]) || 0
    )
  ]));
  const before = profiles.CURRENT_FULL_KB;
  const after = profiles.RAG_HYBRID;
  const reduction = (beforeValue, afterValue) => beforeValue > 0
    ? 1 - (afterValue / beforeValue) : null;

  return Object.freeze({
    cases: new Set(normalized.map((record) => record.id)).size,
    records: normalized.length,
    profiles: Object.freeze(profiles),
    comparison: Object.freeze({
      answerable_input_token_reduction_rate: reduction(
        before.input_tokens.average_answerable_call,
        after.input_tokens.average_answerable_call
      ),
      total_input_token_reduction_rate: reduction(
        before.input_tokens.total,
        after.input_tokens.total
      ),
      all_in_cost_reduction_rate: reduction(before.cost_usd.all_in, after.cost_usd.all_in),
      groundedness_delta: after.groundedness_rate - before.groundedness_rate,
      useful_coverage_delta: after.useful_coverage_rate - before.useful_coverage_rate
    })
  });
}

const EVALUATION_CATEGORIES = Object.freeze([
  'exact',
  'synonym',
  'typo',
  'multi_source',
  'follow_up',
  'out_of_scope',
  'adversarial_tenant'
]);

const ANSWERABLE_CATEGORIES = new Set(['exact', 'synonym', 'typo', 'multi_source']);
const NEGATIVE_BEHAVIORS = Object.freeze({
  follow_up: 'clarify',
  out_of_scope: 'out_of_scope',
  adversarial_tenant: 'deny_tenant_data'
});

function requireEvaluationString(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} wajib berupa teks non-kosong.`
    );
  }
  return normalized;
}

function normalizeUniquePositiveIntegers(value, field) {
  if (!Array.isArray(value)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} wajib berupa array.`
    );
  }
  const normalized = value.map((item) => Number(item));
  if (normalized.some((item) => !Number.isInteger(item) || item <= 0)
      || new Set(normalized).size !== normalized.length) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} hanya boleh berisi ID positif yang unik.`
    );
  }
  return normalized;
}

function normalizeUniqueStrings(value, field) {
  if (!Array.isArray(value)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} wajib berupa array.`
    );
  }
  const normalized = value.map((item, index) => requireEvaluationString(item, `${field}[${index}]`));
  if (new Set(normalized.map((item) => item.toLocaleLowerCase('id-ID'))).size !== normalized.length) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `${field} tidak boleh berisi nilai duplikat.`
    );
  }
  return normalized;
}

export function validateRagEvaluationDataset(cases, { expectedCaseCount = 50 } = {}) {
  if (!Number.isInteger(expectedCaseCount) || expectedCaseCount <= 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'expectedCaseCount wajib berupa integer positif.'
    );
  }
  if (!Array.isArray(cases) || cases.length !== expectedCaseCount) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      `Dataset evaluasi wajib berisi tepat ${expectedCaseCount} kasus.`
    );
  }

  const seenIds = new Set();
  let vectorDimensions = null;
  const normalized = cases.map((item, index) => {
    const id = requireEvaluationString(item?.id, `cases[${index}].id`);
    if (seenIds.has(id)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `ID kasus evaluasi '${id}' duplikat.`
      );
    }
    seenIds.add(id);

    const category = requireEvaluationString(item?.category, `${id}.category`);
    if (!EVALUATION_CATEGORIES.includes(category)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.category tidak didukung.`
      );
    }
    const goldSourceIds = normalizeUniquePositiveIntegers(item?.gold_source_ids, `${id}.gold_source_ids`);
    const requiredClaims = normalizeUniqueStrings(item?.required_claims, `${id}.required_claims`);
    const claimTypes = normalizeUniqueStrings(item?.claim_types, `${id}.claim_types`);
    const expectedBehavior = requireEvaluationString(item?.expected_behavior, `${id}.expected_behavior`);
    const answerable = ANSWERABLE_CATEGORIES.has(category);
    if (answerable
        && (goldSourceIds.length === 0 || requiredClaims.length === 0 || claimTypes.length === 0)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id} wajib memiliki gold source, klaim wajib, dan tipe klaim.`
      );
    }
    if (!answerable && (goldSourceIds.length > 0 || requiredClaims.length > 0)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id} adalah negative case dan tidak boleh memiliki gold source atau klaim wajib.`
      );
    }
    if (category === 'multi_source' && goldSourceIds.length < 2) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id} wajib memiliki sedikitnya dua gold source.`
      );
    }
    const requiredBehavior = answerable ? 'answer' : NEGATIVE_BEHAVIORS[category];
    if (expectedBehavior !== requiredBehavior) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.expected_behavior wajib '${requiredBehavior}'.`
      );
    }
    if (!Array.isArray(item?.vector)
        || item.vector.length === 0
        || item.vector.some((value) => !Number.isFinite(Number(value)))) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.vector wajib berupa array angka non-kosong.`
      );
    }
    if (vectorDimensions === null) vectorDimensions = item.vector.length;
    if (item.vector.length !== vectorDimensions) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.vector wajib memiliki ${vectorDimensions} dimensi.`
      );
    }
    if (typeof item?.calibration !== 'boolean') {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.calibration wajib berupa boolean.`
      );
    }

    return Object.freeze({
      ...item,
      id,
      category,
      query: requireEvaluationString(item?.query, `${id}.query`),
      gold_source_ids: Object.freeze(goldSourceIds),
      required_claims: Object.freeze(requiredClaims),
      claim_types: Object.freeze(claimTypes),
      expected_behavior: expectedBehavior,
      vector: Object.freeze(item.vector.map((value) => Number(value)))
    });
  });
  return Object.freeze(normalized);
}

export function evaluateRagRetrievalOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'Hasil evaluasi retrieval wajib berupa array non-kosong.'
    );
  }

  const seenIds = new Set();
  const normalized = outcomes.map((outcome, index) => {
    const id = requireEvaluationString(outcome?.id, `outcomes[${index}].id`);
    if (seenIds.has(id)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `ID hasil evaluasi '${id}' duplikat.`
      );
    }
    seenIds.add(id);
    const category = requireEvaluationString(outcome?.category, `${id}.category`);
    if (!EVALUATION_CATEGORIES.includes(category)) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `${id}.category tidak didukung.`
      );
    }
    const goldSourceIds = normalizeUniquePositiveIntegers(
      outcome?.gold_source_ids,
      `${id}.gold_source_ids`
    );
    const retrievedSourceIds = normalizeUniquePositiveIntegers(
      outcome?.retrieved_source_ids,
      `${id}.retrieved_source_ids`
    );
    const answerable = goldSourceIds.length > 0;
    const topOneHit = answerable && goldSourceIds.includes(retrievedSourceIds[0]);
    const topThree = retrievedSourceIds.slice(0, 3);
    const topThreeComplete = answerable
      && goldSourceIds.every((sourceId) => topThree.includes(sourceId));
    const negativeRejected = !answerable && retrievedSourceIds.length === 0;
    return {
      id,
      category,
      answerable,
      top_one_hit: topOneHit,
      top_three_complete: topThreeComplete,
      negative_rejected: negativeRejected,
      passed: answerable ? topThreeComplete : negativeRejected
    };
  });

  const answerable = normalized.filter((item) => item.answerable);
  const negative = normalized.filter((item) => !item.answerable);
  const ratio = (items, predicate) => items.length === 0
    ? 0
    : items.filter(predicate).length / items.length;
  const byCategory = Object.fromEntries(EVALUATION_CATEGORIES.map((category) => {
    const categoryItems = normalized.filter((item) => item.category === category);
    return [category, Object.freeze({
      passed: categoryItems.filter((item) => item.passed).length,
      total: categoryItems.length
    })];
  }));

  return Object.freeze({
    cases: normalized.length,
    answerable_cases: answerable.length,
    negative_cases: negative.length,
    top_1_accuracy: ratio(answerable, (item) => item.top_one_hit),
    top_3_accuracy: ratio(answerable, (item) => item.top_three_complete),
    negative_rejection_rate: ratio(negative, (item) => item.negative_rejected),
    overall_pass_rate: ratio(normalized, (item) => item.passed),
    failed_case_ids: Object.freeze(normalized.filter((item) => !item.passed).map((item) => item.id)),
    by_category: Object.freeze(byCategory)
  });
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length < 2) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'Kalibrasi membutuhkan sedikitnya dua kasus evaluasi.'
    );
  }
  const normalized = cases.map((item, index) => {
    const score = Number(item?.top_score);
    if (typeof item?.expected_relevant !== 'boolean'
        || !Number.isFinite(score) || score < 0 || score > 1) {
      throw createRagRetrievalError(
        'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
        `Kasus evaluasi indeks ${index} tidak valid.`
      );
    }
    return { expectedRelevant: item.expected_relevant, score };
  });
  if (!normalized.some((item) => item.expectedRelevant)
      || !normalized.some((item) => !item.expectedRelevant)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_EVALUATION_INPUT',
      'Kalibrasi membutuhkan kasus relevan dan tidak relevan.'
    );
  }
  return normalized;
}

function calculateMetrics(cases, threshold) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const item of cases) {
    const predictedRelevant = item.score >= threshold;
    if (predictedRelevant && item.expectedRelevant) truePositive += 1;
    else if (predictedRelevant) falsePositive += 1;
    else if (item.expectedRelevant) falseNegative += 1;
    else trueNegative += 1;
  }
  const precision = truePositive + falsePositive === 0
    ? 0
    : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0
    ? 0
    : truePositive / (truePositive + falseNegative);
  const falsePositiveRate = falsePositive + trueNegative === 0
    ? 0
    : falsePositive / (falsePositive + trueNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    true_positive: truePositive,
    false_positive: falsePositive,
    true_negative: trueNegative,
    false_negative: falseNegative,
    precision,
    recall,
    false_positive_rate: falsePositiveRate,
    f1,
    accuracy: (truePositive + trueNegative) / cases.length
  };
}

export function calibrateRagRelevanceThreshold(cases, {
  minimumRecall = 0.9,
  maximumFalsePositiveRate = 0
} = {}) {
  const normalizedCases = validateCases(cases);
  const safeMinimumRecall = requireRate(minimumRecall, 'minimumRecall');
  const safeMaximumFalsePositiveRate = requireRate(
    maximumFalsePositiveRate,
    'maximumFalsePositiveRate'
  );
  const thresholds = [...new Set(normalizedCases.map((item) => item.score))]
    .sort((left, right) => left - right);
  const candidates = thresholds
    .map((threshold) => ({ threshold, metrics: calculateMetrics(normalizedCases, threshold) }))
    .filter(({ metrics }) => metrics.recall >= safeMinimumRecall
      && metrics.false_positive_rate <= safeMaximumFalsePositiveRate)
    .sort((left, right) => right.metrics.f1 - left.metrics.f1
      || right.metrics.recall - left.metrics.recall
      || right.threshold - left.threshold);
  if (candidates.length === 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_THRESHOLD_UNSATISFIED',
      'Tidak ada ambang relevansi yang memenuhi batas recall dan false-positive.'
    );
  }
  return Object.freeze({
    threshold: candidates[0].threshold,
    metrics: Object.freeze(candidates[0].metrics),
    evaluated_cases: normalizedCases.length,
    minimum_recall: safeMinimumRecall,
    maximum_false_positive_rate: safeMaximumFalsePositiveRate
  });
}
