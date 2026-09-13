import { estimateRagTokens } from './chatbot_ai_rag_extractor.service.js';
import {
  RAG_RETRIEVAL_DEFAULTS,
  createRagRetrievalError,
  deduplicateAndDiversifyRagResults,
  reciprocalRankFusion,
  searchRagLexical,
  searchRagSemantic
} from './chatbot_ai_rag_retriever.service.js';

export const RAG_CONTEXT_DEFAULTS = Object.freeze({
  TOP_K: 4,
  MAX_TOP_K: 5,
  CONTEXT_TOKEN_BUDGET: 1000,
  TARGET_TOTAL_INPUT_TOKENS: 1200,
  HARD_TOTAL_INPUT_TOKENS: 2200,
  // Calibrated on the fixed 2026-09-11 retrieval fixture; recalibrate when the corpus changes.
  RELEVANCE_THRESHOLD: 0.7571067
});

const SAFE_METADATA_FIELDS = Object.freeze([
  'document_id',
  'flow_id',
  'flow_name',
  'node_id',
  'node_name',
  'node_type',
  'branch_path'
]);

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      `${field} harus berupa integer non-negatif.`
    );
  }
  return value;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function requireThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_THRESHOLD',
      'Ambang relevansi harus berada pada rentang 0 sampai 1.'
    );
  }
  return threshold;
}

function sanitizeProvenanceValue(value) {
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeProvenanceValue(item))
      .filter((item) => item !== null);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200);
}

function requireCandidateIdentity(candidate) {
  const sourceId = Number(candidate?.source_id);
  const sourceRevision = Number(candidate?.source_revision);
  const chunkIndex = Number(candidate?.chunk_index);
  const sourceType = String(candidate?.source_type || '').trim().toLowerCase();
  if (!Number.isInteger(sourceId) || sourceId <= 0
      || !Number.isInteger(sourceRevision) || sourceRevision <= 0
      || !Number.isInteger(chunkIndex) || chunkIndex < 0
      || !['flow', 'manual'].includes(sourceType)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_CANDIDATE',
      'Kandidat context tidak memiliki identitas sumber yang valid.'
    );
  }
  return { sourceId, sourceRevision, chunkIndex, sourceType };
}

export function buildRagProvenance(candidate) {
  const { sourceId, sourceRevision, chunkIndex, sourceType } = requireCandidateIdentity(candidate);
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object'
    && !Array.isArray(candidate.metadata)
    ? candidate.metadata
    : {};
  const provenance = {
    source_id: sourceId,
    source_type: sourceType,
    source_revision: sourceRevision,
    chunk_index: chunkIndex
  };
  for (const field of SAFE_METADATA_FIELDS) {
    const safeValue = sanitizeProvenanceValue(metadata[field]);
    if (safeValue !== null && safeValue !== '') provenance[field] = safeValue;
  }
  return Object.freeze(provenance);
}

export function filterRagResultsByRelevance(results = [], {
  threshold = RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD
} = {}) {
  if (!Array.isArray(results)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      'results harus berupa array hasil retrieval.'
    );
  }
  const safeThreshold = requireThreshold(threshold);
  return results.filter((candidate) => {
    const score = Number(candidate?.relevance_score);
    return Number.isFinite(score) && score >= safeThreshold;
  });
}

function formatContextBlock(candidate, position) {
  const provenance = buildRagProvenance(candidate);
  const labels = [
    `source=${provenance.source_type}:${provenance.source_id}`,
    `revision=${provenance.source_revision}`,
    `chunk=${provenance.chunk_index}`
  ];
  for (const field of SAFE_METADATA_FIELDS) {
    if (provenance[field] !== undefined) {
      const value = Array.isArray(provenance[field])
        ? provenance[field].join(' > ')
        : provenance[field];
      labels.push(`${field}=${value}`);
    }
  }
  return [
    `--- RAG CHUNK ${position} ---`,
    `[${labels.join(' | ')}]`,
    String(candidate.chunk_text || '').trim(),
    `--- END RAG CHUNK ${position} ---`
  ].join('\n');
}

export function selectRagContext(results = [], {
  topK = RAG_CONTEXT_DEFAULTS.TOP_K,
  contextTokenBudget = RAG_CONTEXT_DEFAULTS.CONTEXT_TOKEN_BUDGET,
  baseInputTokens = 0,
  targetTotalInputTokens = RAG_CONTEXT_DEFAULTS.TARGET_TOTAL_INPUT_TOKENS,
  hardTotalInputTokens = RAG_CONTEXT_DEFAULTS.HARD_TOTAL_INPUT_TOKENS
} = {}) {
  if (!Array.isArray(results)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      'results harus berupa array hasil retrieval.'
    );
  }
  const safeTopK = clampInteger(
    topK,
    RAG_CONTEXT_DEFAULTS.TOP_K,
    1,
    RAG_CONTEXT_DEFAULTS.MAX_TOP_K
  );
  const safeContextBudget = requireNonNegativeInteger(contextTokenBudget, 'contextTokenBudget');
  const safeBaseInput = requireNonNegativeInteger(baseInputTokens, 'baseInputTokens');
  const safeTargetInput = requireNonNegativeInteger(targetTotalInputTokens, 'targetTotalInputTokens');
  const safeHardInput = requireNonNegativeInteger(hardTotalInputTokens, 'hardTotalInputTokens');
  if (safeHardInput < safeBaseInput) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INPUT_BUDGET_EXCEEDED',
      'Token input dasar sudah melampaui hard input budget.'
    );
  }

  const effectiveContextBudget = Math.min(
    safeContextBudget,
    safeHardInput - safeBaseInput
  );
  const selected = [];
  let contextTokens = 0;
  for (const candidate of results) {
    if (selected.length >= safeTopK) break;
    const contextText = formatContextBlock(candidate, selected.length + 1);
    const contextTokenCount = estimateRagTokens(contextText);
    if (contextTokens + contextTokenCount > effectiveContextBudget) continue;
    selected.push({
      ...candidate,
      provenance: buildRagProvenance(candidate),
      context_text: contextText,
      context_tokens: contextTokenCount
    });
    contextTokens += contextTokenCount;
  }

  const estimatedTotalInputTokens = safeBaseInput + contextTokens;
  const context = selected.map((candidate) => candidate.context_text).join('\n\n');
  let reason = 'ready';
  if (results.length === 0) reason = 'no_relevant_chunks';
  else if (selected.length === 0) reason = 'context_budget_exhausted';
  return Object.freeze({
    results: Object.freeze(selected),
    context,
    context_tokens: contextTokens,
    selected_count: selected.length,
    requested_top_k: topK,
    applied_top_k: safeTopK,
    context_token_budget: effectiveContextBudget,
    base_input_tokens: safeBaseInput,
    estimated_total_input_tokens: estimatedTotalInputTokens,
    target_total_input_tokens: safeTargetInput,
    hard_total_input_tokens: safeHardInput,
    within_target: estimatedTotalInputTokens <= safeTargetInput,
    within_hard_budget: estimatedTotalInputTokens <= safeHardInput,
    reason
  });
}

export async function retrieveRagContext({
  userId,
  sessionId,
  query,
  queryVector = null,
  mode = 'hybrid',
  sourceTypes = null,
  relevanceThreshold = RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD,
  lexicalCandidateLimit = RAG_RETRIEVAL_DEFAULTS.LEXICAL_CANDIDATE_LIMIT,
  semanticCandidateLimit = RAG_RETRIEVAL_DEFAULTS.SEMANTIC_CANDIDATE_LIMIT,
  topK = RAG_CONTEXT_DEFAULTS.TOP_K,
  contextTokenBudget = RAG_CONTEXT_DEFAULTS.CONTEXT_TOKEN_BUDGET,
  baseInputTokens = 0,
  targetTotalInputTokens = RAG_CONTEXT_DEFAULTS.TARGET_TOTAL_INPUT_TOKENS,
  hardTotalInputTokens = RAG_CONTEXT_DEFAULTS.HARD_TOTAL_INPUT_TOKENS
}, databaseClient = null) {
  const safeMode = String(mode || '').trim().toLowerCase();
  if (!['fts', 'hybrid'].includes(safeMode)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_MODE',
      'Mode retrieval hanya boleh fts atau hybrid.'
    );
  }
  const lexicalResults = await searchRagLexical({
    userId,
    sessionId,
    query,
    sourceTypes,
    candidateLimit: lexicalCandidateLimit
  }, databaseClient);
  const semanticResults = safeMode === 'hybrid' && queryVector !== null
    ? await searchRagSemantic({
      userId,
      sessionId,
      queryVector,
      sourceTypes,
      candidateLimit: semanticCandidateLimit
    }, databaseClient)
    : [];
  const fused = reciprocalRankFusion({ lexicalResults, semanticResults });
  const diversified = deduplicateAndDiversifyRagResults(fused);
  const relevant = filterRagResultsByRelevance(diversified, {
    threshold: relevanceThreshold
  });
  const selection = selectRagContext(relevant, {
    topK,
    contextTokenBudget,
    baseInputTokens,
    targetTotalInputTokens,
    hardTotalInputTokens
  });
  return Object.freeze({
    retrieval_mode: safeMode,
    relevance_threshold: Number(relevanceThreshold),
    lexical_candidate_count: lexicalResults.length,
    semantic_candidate_count: semanticResults.length,
    fused_candidate_count: fused.length,
    relevant_candidate_count: relevant.length,
    ...selection
  });
}
