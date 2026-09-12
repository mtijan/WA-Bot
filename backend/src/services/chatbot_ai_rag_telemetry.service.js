import { logger } from '../logger.js';

const MODES = new Set(['off', 'fts', 'hybrid', 'legacy']);
const STATUSES = new Set(['REPLIED', 'EMPTY_REPLY', 'CS_FALLBACK', 'ERROR', 'SKIPPED']);
const REASONS = new Set([
  'ready', 'index_not_ready', 'no_relevant_chunks', 'retrieval_failed',
  'input_budget_exceeded', 'final_input_budget_exceeded',
  'output_truncated', 'output_rejected', 'runtime_failed'
]);

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
    embedding_fallback: metadata.embedding_fallback === true,
    chunk_count: Number.isInteger(metadata.selected_count) && metadata.selected_count >= 0
      ? metadata.selected_count : 0,
    retrieval_latency_ms: duration(metadata.retrieval_latency_ms),
    provider_latency_ms: duration(metadata.provider_latency_ms),
    total_latency_ms: duration(totalLatencyMs)
  };
}

export function recordRagRuntimeEvent(input) {
  logger.info(buildRagRuntimeEvent(input), 'Chatbot AI runtime outcome');
}
