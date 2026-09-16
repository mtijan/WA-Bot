import { databaseReady, dbGet } from '../database.js';
import whatsappService from './whatsapp.service.js';
import campaignService from './campaign.service.js';
import warmerService from './warmer.service.js';
import ragIndexPollingWorker from './chatbot_ai_rag_worker.service.js';
import { config } from '../config.js';

const startedAt = new Date();
const getCurrentRole = () => (process.env.WA_BOT_PROCESS_ROLE || 'all').trim().toLowerCase();

export const getReadiness = async (role = getCurrentRole()) => {
  const checks = {
    database: 'unknown',
    process: 'ok'
  };

  try {
    await databaseReady;
    await dbGet('SELECT 1 as ok');
    checks.database = 'ok';
  } catch (err) {
    checks.database = 'error';
    checks.databaseError = err.message;
  }

  const activeSessions = Object.keys(whatsappService.sockets || {}).length;
  const activeCampaigns = campaignService.activeCampaigns?.size || 0;
  const activeWarmerCampaigns = warmerService.activeCampaigns?.size || 0;

  const ready = checks.database === 'ok';

  return {
    status: ready ? 'ready' : 'not_ready',
    release_id: config.releaseId,
    role,
    started_at: startedAt.toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    checks,
    metrics: {
      active_sessions: activeSessions,
      active_campaigns: activeCampaigns,
      active_warmer_campaigns: activeWarmerCampaigns,
      campaign_worker_polling: Boolean(campaignService.pollingTimer),
      warmer_worker_polling: Boolean(warmerService.pollingTimer),
      rag_index_worker_enabled: config.runtime.ragIndexWorkerEnabled,
      rag_index_worker_polling: Boolean(ragIndexPollingWorker.pollingTimer)
    }
  };
};
