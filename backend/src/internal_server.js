import express from 'express';
import internalRoutes from './routes/internal.routes.js';
import { config } from './config.js';
import { logger, logError } from './logger.js';
import { sendError } from './utils/http_response.js';

const ROLE_PORTS = {
  sessions: 3002,
  worker: 3002,
  'campaign-worker': 3003,
  'warmer-worker': 3004
};

export const getInternalPort = (role) => {
  if (config.internal.port) return config.internal.port;
  return ROLE_PORTS[role] || 3002;
};

export const startInternalServer = (role) => {
  const port = getInternalPort(role);
  const app = express();

  app.disable('x-powered-by');
  app.locals.runtimeRole = role;
  app.use(express.json({ limit: '2mb' }));
  app.use('/internal', internalRoutes);

  app.use((err, req, res, next) => {
    logError('internal_error_router', err, { role, path: req.path, method: req.method });
    return sendError(
      res,
      err.statusCode || 500,
      err.errorCode || 'INTERNAL_PROCESS_ERROR',
      err.message || 'Terjadi kesalahan internal process API.'
    );
  });

  return app.listen(port, '127.0.0.1', () => {
    logger.info({ role, port }, 'Internal process API started');
  });
};
