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

export function logError(scope, error, context = {}) {
  logger.error({
    scope,
    err: {
      message: error?.message,
      stack: config.nodeEnv === 'production' ? undefined : error?.stack,
      code: error?.code
    },
    ...context
  }, error?.message || 'Unhandled error');
}
