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
