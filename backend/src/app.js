import express from 'express';
import cors from 'cors';
import sessionRoutes from './routes/session.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import chatbotRoutes from './routes/chatbot.routes.js';
import contactRoutes from './routes/contact.routes.js';
import templateRoutes from './routes/template.routes.js';
import warmerRoutes from './routes/warmer.routes.js';
import singleMessageRoutes from './routes/single_message.routes.js';
import groupGrabberRoutes from './routes/group_grabber.routes.js';
import proxyRoutes from './routes/proxy.routes.js';
import chatbotAiRoutes from './routes/chatbot_ai.routes.js';
import optOutRoutes from './routes/opt_out.routes.js';
import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import monitoringRoutes from './routes/monitoring.routes.js';
import { dbGet, dbAll } from './database.js';
import { config } from './config.js';
import { logError } from './logger.js';
import { createCorsOptions, createRateLimiter, createSecurityHeaders } from './middleware/security.middleware.js';
import { createAdminAuthMiddleware } from './middleware/admin_auth.middleware.js';
import { getReadiness } from './services/readiness.service.js';
import { sendError } from './utils/http_response.js';

/**
 * Membuat dan mengembalikan instance Express app yang sudah dikonfigurasi.
 * Fungsi ini diekstrak agar bisa digunakan oleh test suite tanpa menjalankan server.
 * @param {object} options - Opsi opsional.
 * @param {string} options.runtimeRole - Role runtime, default 'all'.
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const runtimeRole = options.runtimeRole || (process.env.WA_BOT_PROCESS_ROLE || 'all').trim().toLowerCase();
  const app = express();

  if (config.trustProxyHops) {
    app.set('trust proxy', config.trustProxyHops);
  }

  app.disable('x-powered-by');
  app.use(createSecurityHeaders());
  app.use(cors(createCorsOptions()));

  const defaultBodyLimit = config.security.jsonBodyLimit;
  const importBodyLimit = config.security.importBodyLimit;

  app.use('/api/chatbot-flows/import', express.json({ limit: importBodyLimit }));
  app.use('/api/contacts/bulk', express.json({ limit: importBodyLimit }));
  app.use(express.json({ limit: defaultBodyLimit }));
  app.use(express.urlencoded({ limit: defaultBodyLimit, extended: true }));
  app.use('/api', createRateLimiter());
  app.use('/api/auth', authRoutes);
  app.use('/api', createAdminAuthMiddleware());

  // Mapping Rute API
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/chatbot-flows', chatbotRoutes);
  app.use('/api/contacts', contactRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/warmer', warmerRoutes);
  app.use('/api/single-message', singleMessageRoutes);
  app.use('/api/group-grabber', groupGrabberRoutes);
  app.use('/api/proxies', proxyRoutes);
  app.use('/api/chatbot-ai', chatbotAiRoutes);
  app.use('/api/opt-outs', optOutRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/monitoring', monitoringRoutes);

  // Endpoint statistik dashboard real-time
  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const sessionStats = await dbGet("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as active FROM sessions");
      const campaignSent = await dbGet("SELECT COUNT(*) as count FROM delivery_logs WHERE status = 'SENT' AND campaign_id IS NOT NULL");
      const campaignFailed = await dbGet("SELECT COUNT(*) as count FROM delivery_logs WHERE status = 'FAILED' AND campaign_id IS NOT NULL");
      const singleSent = await dbGet("SELECT COUNT(*) as count FROM delivery_logs WHERE status = 'SENT' AND campaign_id IS NULL");
      
      const chatbotSent = await dbGet("SELECT SUM(sent_count) as total FROM chatbot_flows");
      const chatbotTriggered = await dbGet("SELECT SUM(trigger_count) as total FROM chatbot_flows");
      const totalContacts = await dbGet("SELECT COUNT(DISTINCT target_number) as total FROM delivery_logs");
      const activeCampaigns = await dbGet("SELECT COUNT(*) as active FROM campaigns WHERE status = 'RUNNING'");
      const totalFlows = await dbGet("SELECT COUNT(*) as total FROM chatbot_flows");
      const totalTemplates = await dbGet("SELECT COUNT(*) as total FROM message_templates");
      
      // Hitung total node chatbot
      let totalNodes = 0;
      const flows = await dbAll("SELECT nodes FROM chatbot_flows");
      for (const f of flows) {
        try {
          totalNodes += JSON.parse(f.nodes || '[]').length;
        } catch (e) {}
      }

      const totalSent = (campaignSent?.count || 0) + (chatbotSent?.total || 0) + (singleSent?.count || 0);

      // Hitung persentase kesuksesan pengiriman pesan massal
      const totalCampaignLogs = (campaignSent?.count || 0) + (campaignFailed?.count || 0);
      let successRate = 100;
      if (totalCampaignLogs > 0) {
        successRate = Math.round(((campaignSent?.count || 0) / totalCampaignLogs) * 100);
      }

      let chatbotAiErrors = [];
      try {
        chatbotAiErrors = await dbAll(
          `SELECT session_id, last_error, last_error_at 
           FROM chatbot_ai_settings 
           WHERE last_error IS NOT NULL`
        );
      } catch (e) {
        chatbotAiErrors = [];
      }

      res.json({
        status: 'success',
        data: {
          activeSessions: sessionStats?.active || 0,
          totalSessions: sessionStats?.total || 0,
          messagesSent: totalSent,
          bulkSent: campaignSent?.count || 0,
          chatbotSent: chatbotSent?.total || 0,
          singleSent: singleSent?.count || 0,
          autoReplySent: 0,
          totalContacts: totalContacts?.total || 0,
          totalTemplates: totalTemplates?.total || 0,
          activeCampaigns: activeCampaigns?.active || 0,
          chatbotInteractions: chatbotTriggered?.total || 0,
          totalNodes: totalNodes,
          successRate: successRate,
          chatbotAiErrors
        }
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date() });
  });

  app.get('/health/ready', async (req, res) => {
    const result = await getReadiness(runtimeRole);
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  });

  // Middleware penanganan galat global
  app.use((err, req, res, next) => {
    logError('global_error_router', err, { path: req.path, method: req.method });
    if (err.type === 'entity.too.large') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Ukuran request melebihi batas yang diizinkan.');
    }

    return sendError(
      res,
      err.statusCode || 500,
      err.errorCode || 'INTERNAL_SERVER_ERROR',
      err.message || 'Terjadi kesalahan sistem internal.'
    );
  });

  return app;
}
