import {
  createAIRequestContext,
  createAIRetryContext,
  recordChatbotAIUsageSafely
} from './chatbot_ai_usage.service.js';
import {
  finalizeAIBudgetSafely,
  guardAIProviderAttempt
} from './chatbot_ai_budget.service.js';

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

export function isRetryableAIProviderError(error) {
  const status = Number(error?.status);
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  return RETRYABLE_ERROR_CODES.has(String(error?.code || '').toUpperCase());
}

function validateMaxAttempts(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2) {
    throw new RangeError('AI provider maxAttempts harus berupa integer 1-2.');
  }
  return value;
}

export async function executeInstrumentedChatCompletion({
  openai,
  payload,
  requestKind,
  userId,
  sessionId = null,
  provider,
  model,
  retrievalType = null,
  chunkCount = null,
  databaseClient = null,
  maxAttempts = 2,
  retryDelayMs = 250,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
}) {
  validateMaxAttempts(maxAttempts);
  if (!openai?.chat?.completions?.create) {
    throw new TypeError('OpenAI-compatible chat client tidak valid.');
  }

  let context = createAIRequestContext({ requestKind });
  while (context.attemptNo <= maxAttempts) {
    let reservation = null;
    let providerAttemptStarted = false;
    const startedAtMs = Date.now();
    try {
      const budgetGuard = await guardAIProviderAttempt({ context, userId, provider });
      reservation = budgetGuard.reservation;
      providerAttemptStarted = true;
      const response = await openai.chat.completions.create(payload);
      const latencyMs = Date.now() - startedAtMs;
      await finalizeAIBudgetSafely({ reservation, responseReceived: true });
      return { response, context, latencyMs };
    } catch (error) {
      if (reservation) {
        await finalizeAIBudgetSafely({ reservation, responseReceived: false, error });
      }
      if (providerAttemptStarted) {
        await recordChatbotAIUsageSafely({
          context,
          userId,
          sessionId,
          provider,
          model,
          retrievalType,
          chunkCount,
          error,
          deliveryStatus: 'NOT_APPLICABLE',
          latencyMs: Date.now() - startedAtMs
        }, databaseClient);
      }

      if (
        !providerAttemptStarted
        || context.attemptNo >= maxAttempts
        || !isRetryableAIProviderError(error)
      ) {
        throw error;
      }
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      context = createAIRetryContext(context);
    }
  }

  throw new Error('AI provider attempt loop berakhir tanpa hasil.');
}
