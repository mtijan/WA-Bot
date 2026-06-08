import os from 'os';
import { dbGet, dbAll, dbRun } from '../database.js';
import { getReadiness } from '../services/readiness.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

/**
 * GET /api/monitoring/status
 * Mengembalikan snapshot status sistem secara real-time untuk dashboard monitoring.
 */
export const getMonitoringStatus = async (req, res) => {
  try {
    const runtimeRole = req.app.locals.runtimeRole || 'all';

    // --- Health Readiness ---
    let readiness = { status: 'unknown' };
    try {
      readiness = await getReadiness(runtimeRole);
    } catch (e) {
      readiness = { status: 'error', error: e.message };
    }

    // --- WhatsApp Sessions ---
    const sessionStats = await dbGet(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as connected,
        SUM(CASE WHEN status = 'DISCONNECTED' THEN 1 ELSE 0 END) as disconnected,
        SUM(CASE WHEN status = 'CONNECTING' THEN 1 ELSE 0 END) as connecting
       FROM sessions`
    );

    // --- Campaigns ---
    const campaignStats = await dbGet(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) as paused
       FROM campaigns`
    );

    // --- Warmer ---
    const warmerStats = await dbGet(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running
       FROM warmer_campaigns`
    );

    // --- Delivery Logs Hari Ini (24 jam terakhir) ---
    const deliveryToday = await dbGet(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
       FROM delivery_logs
       WHERE created_at >= datetime('now', '-24 hours')`
    );

    // --- Delivery Logs Per Jam (12 jam terakhir, untuk mini chart) ---
    const deliveryByHour = await dbAll(
      `SELECT
        strftime('%H', created_at) as hour,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
       FROM delivery_logs
       WHERE created_at >= datetime('now', '-12 hours')
       GROUP BY strftime('%H', created_at)
       ORDER BY hour ASC`
    );

    // --- Database Info ---
    let dbSizeBytes = 0;
    try {
      const dbSizeRow = await dbGet("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
      dbSizeBytes = dbSizeRow?.size || 0;
    } catch (e) {
      dbSizeBytes = 0;
    }

    // --- Chatbot Flows ---
    // Kolom status berisi nilai 'ACTIVE' / lainnya (bukan is_active boolean)
    const chatbotStats = await dbGet(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
        COALESCE(SUM(trigger_count), 0) as total_triggers,
        COALESCE(SUM(sent_count), 0) as total_sent,
        COALESCE(SUM(failed_count), 0) as total_failed
       FROM chatbot_flows`
    );

    // --- Memory & Process Runtime ---
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());
    const sysTotalBytes = os.totalmem();
    const sysFreeBytes = os.freemem();
    const sysUsedBytes = sysTotalBytes - sysFreeBytes;

    return sendSuccess(res, {
      timestamp: new Date().toISOString(),
      uptime_seconds: uptimeSeconds,

      api: {
        status: readiness.status === 'ready' ? 'healthy' : 'degraded',
        readiness: readiness,
      },

      memory: {
        rss_bytes: mem.rss,
        heap_used_bytes: mem.heapUsed,
        heap_total_bytes: mem.heapTotal,
        external_bytes: mem.external,
        heap_used_pct: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0,
        system_total_bytes: sysTotalBytes,
        system_free_bytes: sysFreeBytes,
        system_used_bytes: sysUsedBytes,
        system_used_pct: Math.round((sysUsedBytes / sysTotalBytes) * 100),
      },

      sessions: {
        total: sessionStats?.total || 0,
        connected: sessionStats?.connected || 0,
        disconnected: sessionStats?.disconnected || 0,
        connecting: sessionStats?.connecting || 0,
      },

      campaigns: {
        total: campaignStats?.total || 0,
        running: campaignStats?.running || 0,
        completed: campaignStats?.completed || 0,
        failed: campaignStats?.failed || 0,
        paused: campaignStats?.paused || 0,
      },

      warmer: {
        total: warmerStats?.total || 0,
        running: warmerStats?.running || 0,
      },

      chatbot: {
        total_flows: chatbotStats?.total || 0,
        active_flows: chatbotStats?.active || 0,
        total_triggers: chatbotStats?.total_triggers || 0,
        total_sent: chatbotStats?.total_sent || 0,
        total_failed: chatbotStats?.total_failed || 0,
      },

      delivery_today: {
        total: deliveryToday?.total || 0,
        sent: deliveryToday?.sent || 0,
        failed: deliveryToday?.failed || 0,
        success_rate: deliveryToday?.total > 0
          ? Math.round(((deliveryToday?.sent || 0) / deliveryToday.total) * 100)
          : 100,
      },

      delivery_by_hour: deliveryByHour || [],

      database: {
        size_bytes: dbSizeBytes,
        size_mb: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
      },
    });
  } catch (err) {
    logError('getMonitoringStatus', err);
    return sendError(res, 500, 'MONITORING_STATUS_ERROR', 'Gagal mengambil status monitoring.');
  }
};

/**
 * GET /api/monitoring/repair-logs
 * Mengembalikan daftar riwayat perbaikan otomatis sesi.
 */
export const getRepairLogs = async (req, res) => {
  try {
    const logs = await dbAll(
      `SELECT * FROM session_repair_logs 
       ORDER BY triggered_at DESC 
       LIMIT 100`
    );
    return sendSuccess(res, logs);
  } catch (err) {
    logError('getRepairLogs', err);
    return sendError(res, 500, 'REPAIR_LOGS_ERROR', 'Gagal mengambil log perbaikan sesi.');
  }
};

/**
 * GET /api/monitoring/failed-replies
 * Mengembalikan daftar kegagalan respon chatbot/AI beserta nomor penerima.
 */
export const getFailedReplies = async (req, res) => {
  try {
    const logs = await dbAll(
      `SELECT * FROM chatbot_failed_replies 
       ORDER BY created_at DESC 
       LIMIT 100`
    );
    return sendSuccess(res, logs);
  } catch (err) {
    logError('getFailedReplies', err);
    return sendError(res, 500, 'FAILED_REPLIES_ERROR', 'Gagal mengambil log kegagalan chatbot.');
  }
};

/**
 * PATCH /api/monitoring/failed-replies/:id/status
 * Memperbarui status kegagalan respon chatbot (misal dari UNRESOLVED ke RESOLVED).
 */
export const updateFailedReplyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['UNRESOLVED', 'RESOLVED', 'MARKED'].includes(status)) {
      return sendError(res, 400, 'INVALID_STATUS', 'Status tidak valid.');
    }

    const existing = await dbGet('SELECT id FROM chatbot_failed_replies WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'NOT_FOUND', 'Log tidak ditemukan.');
    }

    await dbRun('UPDATE chatbot_failed_replies SET status = ? WHERE id = ?', [status, id]);
    return sendSuccess(res, { id, status }, 200, { message: 'Status log berhasil diperbarui.' });
  } catch (err) {
    logError('updateFailedReplyStatus', err);
    return sendError(res, 500, 'UPDATE_FAILED_REPLY_ERROR', 'Gagal memperbarui status log.');
  }
};
