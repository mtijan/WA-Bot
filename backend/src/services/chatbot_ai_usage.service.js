import { randomUUID } from 'node:crypto';
import { logError } from '../logger.js';

let runtimeDbRunPromise = null;
async function getRuntimeDbRun() {
  if (!runtimeDbRunPromise) {
    runtimeDbRunPromise = import('../database.js').then(({ dbRun }) => dbRun);
  }
  return runtimeDbRunPromise;
}

const REQUEST_KINDS = new Set(['production', 'sandbox', 'test', 'embedding']);
const OPERATIONS = new Set(['chat', 'query_embedding', 'source_embedding']);
const DELIVERY_STATUSES = new Set(['NOT_APPLICABLE', 'PENDING', 'SENT', 'FAILED', 'UNKNOWN']);
const RETRIEVAL_TYPES = new Set(['legacy', 'fts', 'hybrid']);

function nonNegativeIntegerOrNull(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function boundedText(value, maxLength = 255) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, maxLength);
}

export function createAIRequestContext({ requestKind, operation = 'chat' }) {
  if (!REQUEST_KINDS.has(requestKind)) throw new TypeError(`Unsupported AI request kind: ${requestKind}`);
  if (!OPERATIONS.has(operation)) throw new TypeError(`Unsupported AI operation: ${operation}`);

  return {
    requestId: randomUUID(),
    attemptNo: 1,
    requestKind,
    operation,
    startedAtMs: Date.now()
  };
}

export function createAIRetryContext(context) {
  if (!context?.requestId || !Number.isInteger(context.attemptNo) || context.attemptNo < 1) {
    throw new TypeError('Invalid AI request context for retry.');
  }
  return {
    ...context,
    attemptNo: context.attemptNo + 1,
    startedAtMs: Date.now()
  };
}

export function resolveAIProvider(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

export function normalizeProviderUsage(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      usageStatus: 'UNKNOWN'
    };
  }

  return {
    inputTokens: nonNegativeIntegerOrNull(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: nonNegativeIntegerOrNull(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: nonNegativeIntegerOrNull(usage.total_tokens),
    cachedTokens: nonNegativeIntegerOrNull(
      usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens
    ),
    reasoningTokens: nonNegativeIntegerOrNull(
      usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens
    ),
    usageStatus: 'KNOWN'
  };
}

export function buildAIUsageRecord({
  context,
  userId,
  sessionId = null,
  provider,
  model,
  response = null,
  error = null,
  retrievalType = null,
  chunkCount = null,
  deliveryStatus = 'NOT_APPLICABLE',
  latencyMs = Date.now() - context.startedAtMs
}) {
  if (!context?.requestId || !REQUEST_KINDS.has(context.requestKind)) {
    throw new TypeError('Invalid AI request context.');
  }
  if (!DELIVERY_STATUSES.has(deliveryStatus)) {
    throw new TypeError(`Unsupported delivery status: ${deliveryStatus}`);
  }

  const normalizedUsage = normalizeProviderUsage(response);
  const finishReason = response?.choices?.[0]?.finish_reason;

  return {
    userId,
    sessionId,
    requestId: context.requestId,
    attemptNo: context.attemptNo,
    requestKind: context.requestKind,
    operation: context.operation,
    provider: boundedText(provider),
    model: boundedText(response?.model || model),
    providerResponseId: boundedText(response?.id),
    ...normalizedUsage,
    latencyMs: nonNegativeIntegerOrNull(Math.round(latencyMs)),
    httpStatus: nonNegativeIntegerOrNull(error?.status),
    errorCode: boundedText(error?.code),
    finishReason: boundedText(finishReason),
    retrievalType: RETRIEVAL_TYPES.has(retrievalType) ? retrievalType : null,
    chunkCount: nonNegativeIntegerOrNull(chunkCount),
    requestStatus: error ? 'FAILED' : 'SUCCEEDED',
    deliveryStatus
  };
}

export async function recordChatbotAIUsage(input, databaseClient = null) {
  const record = buildAIUsageRecord(input);
  const runFn = databaseClient?.run ? databaseClient.run.bind(databaseClient) : await getRuntimeDbRun();
  await runFn(
    `INSERT INTO chatbot_ai_usage (
       user_id, session_id, request_id, attempt_no, request_kind, operation,
       provider, model, provider_response_id, input_tokens, output_tokens,
       total_tokens, cached_tokens, reasoning_tokens, latency_ms, http_status,
       error_code, finish_reason, request_status, delivery_status, usage_status,
       retrieval_type, chunk_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.userId,
      record.sessionId,
      record.requestId,
      record.attemptNo,
      record.requestKind,
      record.operation,
      record.provider,
      record.model,
      record.providerResponseId,
      record.inputTokens,
      record.outputTokens,
      record.totalTokens,
      record.cachedTokens,
      record.reasoningTokens,
      record.latencyMs,
      record.httpStatus,
      record.errorCode,
      record.finishReason,
      record.requestStatus,
      record.deliveryStatus,
      record.usageStatus,
      record.retrievalType,
      record.chunkCount
    ]
  );
  return record;
}

export async function recordChatbotAIUsageSafely(input, databaseClient = null) {
  try {
    await recordChatbotAIUsage(input, databaseClient);
    return true;
  } catch (error) {
    logError('recordChatbotAIUsage', error, {
      requestKind: input?.context?.requestKind,
      operation: input?.context?.operation,
      sessionId: input?.sessionId
    });
    return false;
  }
}
