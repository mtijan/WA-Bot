import { logger } from '../logger.js';

const MODES = new Set(['off', 'fts', 'hybrid', 'legacy', 'cache', 'direct_answer', 'conversation']);
const STATUSES = new Set(['REPLIED', 'EMPTY_REPLY', 'CS_FALLBACK', 'ERROR', 'SKIPPED']);
const REASONS = new Set([
  'ready', 'index_not_ready', 'no_relevant_chunks', 'retrieval_failed',
  'input_budget_exceeded', 'final_input_budget_exceeded',
  'output_truncated', 'output_rejected', 'runtime_failed', 'conversational_fallback'
]);
const THRESHOLD_SOURCES = new Set(['lexical', 'explicit', 'calibrated_hybrid', 'conversational_bypass']);
const QUERY_KINDS = new Set(['knowledge', 'social']);

function duration(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// Explicit allowlist: never spread result/metadata/error/provider objects into logs.
export function buildRagRuntimeEvent({ userId, result, totalLatencyMs }) {
  const metadata = result?.ragMetadata || {};
  return {
    event: 'chatbot_ai_runtime_outcome',
    user_id: Number.isInteger(userId) && userId > 0 ? userId : null,
    request_id: /^[a-f0-9-]{36}$/i.test(result?.usageContext?.requestId || '')
      ? result.usageContext.requestId : null,
    status: STATUSES.has(result?.status) ? result.status : 'ERROR',
    delivered: result?.delivered === true,
    rag_mode: MODES.has(metadata.rag_mode) ? metadata.rag_mode : null,
    retrieval_type: MODES.has(metadata.effective_mode) ? metadata.effective_mode : null,
    retrieval_reason: REASONS.has(metadata.retrieval_reason) ? metadata.retrieval_reason : null,
    query_kind: QUERY_KINDS.has(metadata.query_kind) ? metadata.query_kind : null,
    relevance_threshold: Number.isFinite(metadata.relevance_threshold)
      && metadata.relevance_threshold >= 0 && metadata.relevance_threshold <= 1
      ? Number(metadata.relevance_threshold) : null,
    threshold_source: THRESHOLD_SOURCES.has(metadata.threshold_source)
      ? metadata.threshold_source : null,
    conversational_fallback: metadata.conversational_fallback === true,
    embedding_fallback: metadata.embedding_fallback === true,
    cache_hit: metadata.cache_hit === true,
    direct_answer: metadata.direct_answer === true,
    debounced: metadata.debounced === true,
    debounced_count: Number.isInteger(metadata.debounced_count) && metadata.debounced_count >= 0
      ? metadata.debounced_count : 0,
    ai_call_avoided: metadata.cache_hit === true || metadata.direct_answer === true || metadata.ai_call_avoided === true,
    chunk_count: Number.isInteger(metadata.selected_count) && metadata.selected_count >= 0
      ? metadata.selected_count : 0,
    shadow_enabled: metadata.shadow_enabled === true,
    shadow_retrieval_type: MODES.has(metadata.shadow_effective_mode)
      ? metadata.shadow_effective_mode : null,
    shadow_retrieval_reason: REASONS.has(metadata.shadow_retrieval_reason)
      || metadata.shadow_retrieval_reason === 'conversational_bypass'
      ? metadata.shadow_retrieval_reason : null,
    shadow_query_kind: QUERY_KINDS.has(metadata.shadow_query_kind)
      ? metadata.shadow_query_kind : null,
    shadow_relevance_threshold: Number.isFinite(metadata.shadow_relevance_threshold)
      && metadata.shadow_relevance_threshold >= 0 && metadata.shadow_relevance_threshold <= 1
      ? Number(metadata.shadow_relevance_threshold) : null,
    shadow_threshold_source: THRESHOLD_SOURCES.has(metadata.shadow_threshold_source)
      ? metadata.shadow_threshold_source : null,
    shadow_embedding_fallback: metadata.shadow_embedding_fallback === true,
    shadow_chunk_count: Number.isInteger(metadata.shadow_selected_count)
      && metadata.shadow_selected_count >= 0 ? metadata.shadow_selected_count : 0,
    shadow_retrieval_latency_ms: duration(metadata.shadow_retrieval_latency_ms),
    retrieval_latency_ms: duration(metadata.retrieval_latency_ms),
    provider_latency_ms: duration(metadata.provider_latency_ms),
    total_latency_ms: duration(totalLatencyMs)
  };
}

export function recordRagRuntimeEvent(input) {
  logger.info(buildRagRuntimeEvent(input), 'Chatbot AI runtime outcome');
}
