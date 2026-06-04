import whatsappService from './services/whatsapp.service.js';
import campaignService from './services/campaign.service.js';
import warmerService from './services/warmer.service.js';
import { startInternalServer } from './internal_server.js';
import { config } from './config.js';
import { logger } from './logger.js';

export const getRuntimeRole = () => {
  return config.runtime.role;
};

export const shouldStartHttpServer = (role = getRuntimeRole()) => {
  return role === 'all' || role === 'api';
};

export const shouldStartSessionManager = (role = getRuntimeRole()) => {
  return role === 'all' || role === 'worker' || role === 'sessions' || role === 'campaign-worker' || role === 'warmer-worker';
};

export const shouldStartCampaignWorker = (role = getRuntimeRole()) => {
  return role === 'all' || role === 'worker' || role === 'campaign-worker';
};

export const shouldStartWarmerWorker = (role = getRuntimeRole()) => {
  return role === 'all' || role === 'worker' || role === 'warmer-worker';
};

export const shouldRunInlineWorkers = (role = getRuntimeRole()) => {
  return role === 'all';
};

const startHeartbeat = (role) => {
  const heartbeatMs = config.runtime.heartbeatMs;
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) return null;

  return setInterval(() => {
    logger.info({ role }, 'Runtime heartbeat');
  }, heartbeatMs);
};

export const startRuntimeServices = async (role = getRuntimeRole()) => {
  logger.info({ role }, 'Runtime services starting');

  if (shouldStartSessionManager(role)) {
    await whatsappService.initAllSessions();
  }

  if (shouldStartCampaignWorker(role)) {
    await campaignService.startPollingWorker();
  }

  if (shouldStartWarmerWorker(role)) {
    await warmerService.startPollingWorker();
  }

  if (!shouldStartHttpServer(role)) {
    startInternalServer(role);
    startHeartbeat(role);
  }
};
