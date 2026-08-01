import { logError, logger } from '../logger.js';

let handlersInstalled = false;

export function isTransientBaileysConnectionClosed(error) {
  const statusCode = error?.output?.statusCode || error?.statusCode;
  const stack = String(error?.stack || '');
  return error?.message === 'Connection Closed'
    && Number(statusCode) === 428
    && stack.includes('@whiskeysockets/baileys');
}

function logIgnoredBaileysDisconnect(error, scope) {
  logger.warn({
    scope,
    err: {
      message: error?.message,
      statusCode: error?.output?.statusCode || error?.statusCode
    }
  }, 'Ignored transient Baileys connection closed error after socket reconnect.');
}

export function installRuntimeErrorHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  process.on('unhandledRejection', (reason) => {
    if (isTransientBaileysConnectionClosed(reason)) {
      logIgnoredBaileysDisconnect(reason, 'runtime.unhandledRejection.baileys');
      return;
    }

    logError('runtime.unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });

  process.on('uncaughtException', (error) => {
    if (isTransientBaileysConnectionClosed(error)) {
      logIgnoredBaileysDisconnect(error, 'runtime.uncaughtException.baileys');
      return;
    }

    logError('runtime.uncaughtException', error);
    process.exit(1);
  });
}
