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
