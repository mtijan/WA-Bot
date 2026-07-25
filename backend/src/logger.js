import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: process.env.WA_BOT_LOG_LEVEL || 'info',
  base: {
    service: 's-bro-backend',
    role: config.runtime.role
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

const SENSITIVE_KEY_PATTERN = /(?:password|passphrase|secret|token|api[_-]?key|authorization|cookie|proxy[_-]?url|sender[_-]?id|phone[_-]?(?:number)?|target|recipient|jid)/i;

export function sanitizeLogContext(context = {}) {
  if (!context || typeof context !== 'object') return {};

  const sanitize = (value, key = '', depth = 0) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
    if (depth > 3) return '[TRUNCATED]';
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey, depth + 1)
      ])
    );
  };

  const sanitized = { ...context };
  if (sanitized.body && typeof sanitized.body === 'object') {
    sanitized.body = {
      fields: Object.keys(sanitized.body).sort()
    };
  }
  return sanitize(sanitized);
}

export function logError(scope, error, context = {}) {
  logger.error({
    scope,
    err: {
      message: error?.message,
      stack: config.nodeEnv === 'production' ? undefined : error?.stack,
      code: error?.code
    },
    ...sanitizeLogContext(context)
  }, error?.message || 'Unhandled error');
}
