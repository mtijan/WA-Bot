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
    const isAdmin = req.auth.role === 'admin';
    const userId = req.auth.userId;

    // --- Health Readiness ---
    let readiness = { status: 'unknown' };
    try {
      readiness = await getReadiness(runtimeRole);
    } catch (e) {
      readiness = { status: 'error', error: e.message };
    }

    // --- WhatsApp Sessions ---
    const sessionStats = await dbGet(
      isAdmin
        ? `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as connected,
            SUM(CASE WHEN status = 'DISCONNECTED' THEN 1 ELSE 0 END) as disconnected,
            SUM(CASE WHEN status = 'CONNECTING' THEN 1 ELSE 0 END) as connecting
           FROM sessions`
        : `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as connected,
            SUM(CASE WHEN status = 'DISCONNECTED' THEN 1 ELSE 0 END) as disconnected,
            SUM(CASE WHEN status = 'CONNECTING' THEN 1 ELSE 0 END) as connecting
           FROM sessions WHERE user_id = ?`,
      isAdmin ? [] : [userId]
    );

    // --- Campaigns ---
    const campaignStats = await dbGet(
      isAdmin
        ? `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) as paused
           FROM campaigns`
        : `SELECT
            COUNT(c.id) as total,
            SUM(CASE WHEN c.status = 'RUNNING' THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN c.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN c.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN c.status = 'PAUSED' THEN 1 ELSE 0 END) as paused
           FROM campaigns c
           INNER JOIN sessions s ON c.session_id = s.session_id
           WHERE s.user_id = ?`,
      isAdmin ? [] : [userId]
    );

    // --- Warmer ---
    const warmerStats = await dbGet(
      isAdmin
        ? `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running
           FROM warmer_campaigns`
        : `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running
           FROM warmer_campaigns WHERE user_id = ?`,
      isAdmin ? [] : [userId]
    );

    // --- Delivery Logs Hari Ini (24 jam terakhir) ---
    const deliveryToday = await dbGet(
      isAdmin
        ? `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
           FROM delivery_logs
           WHERE created_at >= datetime('now', '-24 hours')`
        : `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
           FROM delivery_logs
           WHERE created_at >= datetime('now', '-24 hours') AND user_id = ?`,
      isAdmin ? [] : [userId]
    );

    // --- Delivery Logs Per Jam (12 jam terakhir, untuk mini chart) ---
    const deliveryByHour = await dbAll(
      isAdmin
        ? `SELECT
            strftime('%H', created_at) as hour,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
           FROM delivery_logs
           WHERE created_at >= datetime('now', '-12 hours')
           GROUP BY strftime('%H', created_at)
           ORDER BY hour ASC`
        : `SELECT
            strftime('%H', created_at) as hour,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
           FROM delivery_logs
           WHERE created_at >= datetime('now', '-12 hours') AND user_id = ?
           GROUP BY strftime('%H', created_at)
           ORDER BY hour ASC`,
      isAdmin ? [] : [userId]
    );

    // --- Database Info & Users Resource Usage (Admin-only) ---
    let dbSizeBytes = 0;
    let usersUsage = [];
    if (isAdmin) {
      try {
        const dbSizeRow = await dbGet("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
        dbSizeBytes = dbSizeRow?.size || 0;
      } catch (e) {
        dbSizeBytes = 0;
      }

      try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        usersUsage = await dbAll(`
          SELECT 
            u.id, 
            u.username, 
            u.display_name,
            p.name as plan_name,
            COALESCE(p.max_sessions, 0) as max_sessions,
            COALESCE(p.max_campaigns_per_month, 0) as max_campaigns_per_month,
            COALESCE(p.max_flows, 0) as max_flows,
            (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) as current_sessions,
            (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND status = 'CONNECTED') as active_sessions,
            (SELECT COUNT(*) FROM campaigns WHERE user_id = u.id AND created_at >= ?) as current_campaigns,
            (SELECT COUNT(*) FROM chatbot_flows WHERE user_id = u.id) as current_flows
          FROM users u
          LEFT JOIN subscription_plans p ON u.plan_id = p.id
          ORDER BY u.username ASC
        `, [startOfMonth.toISOString()]);
      } catch (e) {
        usersUsage = [];
      }
    }

    // --- Chatbot Flows ---
    const chatbotStats = await dbGet(
      isAdmin
        ? `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
            COALESCE(SUM(trigger_count), 0) as total_triggers,
            COALESCE(SUM(sent_count), 0) as total_sent,
            COALESCE(SUM(failed_count), 0) as total_failed
           FROM chatbot_flows`
        : `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
            COALESCE(SUM(trigger_count), 0) as total_triggers,
            COALESCE(SUM(sent_count), 0) as total_sent,
            COALESCE(SUM(failed_count), 0) as total_failed
           FROM chatbot_flows WHERE user_id = ?`,
      isAdmin ? [] : [userId]
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

      users_usage: usersUsage
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
    const isAdmin = req.auth.role === 'admin';
    const userId = req.auth.userId;

    let targetUserId = userId;
    const isFiltered = req.query.target_user_id && isAdmin;
    if (isFiltered) {
      targetUserId = Number(req.query.target_user_id);
    }

    const logs = (!isAdmin || isFiltered)
      ? await dbAll(
          `SELECT l.* FROM session_repair_logs l
           INNER JOIN sessions s ON l.session_id = s.session_id
           WHERE s.user_id = ?
           ORDER BY l.triggered_at DESC 
           LIMIT 100`,
          [targetUserId]
        )
      : await dbAll(
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
    const isAdmin = req.auth.role === 'admin';
    const userId = req.auth.userId;

    let targetUserId = userId;
    const isFiltered = req.query.target_user_id && isAdmin;
    if (isFiltered) {
      targetUserId = Number(req.query.target_user_id);
    }

    const logs = (!isAdmin || isFiltered)
      ? await dbAll(
          `SELECT r.* FROM chatbot_failed_replies r
           INNER JOIN sessions s ON r.session_id = s.session_id
           WHERE s.user_id = ?
           ORDER BY r.created_at DESC 
           LIMIT 100`,
          [targetUserId]
        )
      : await dbAll(
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
    const isAdmin = req.auth.role === 'admin';
    const userId = req.auth.userId;

    if (!status || !['UNRESOLVED', 'RESOLVED', 'MARKED'].includes(status)) {
      return sendError(res, 400, 'INVALID_STATUS', 'Status tidak valid.');
    }

    const existing = await dbGet('SELECT id FROM chatbot_failed_replies WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'NOT_FOUND', 'Log tidak ditemukan.');
    }

    if (!isAdmin) {
      const reply = await dbGet(
        `SELECT s.user_id FROM chatbot_failed_replies r
         INNER JOIN sessions s ON r.session_id = s.session_id
         WHERE r.id = ?`,
        [id]
      );
      if (!reply || reply.user_id !== userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke log kegagalan respon ini.');
      }
    }

    await dbRun('UPDATE chatbot_failed_replies SET status = ? WHERE id = ?', [status, id]);
    return sendSuccess(res, { id, status }, 200, { message: 'Status log berhasil diperbarui.' });
  } catch (err) {
    logError('updateFailedReplyStatus', err);
    return sendError(res, 500, 'UPDATE_FAILED_REPLY_ERROR', 'Gagal memperbarui status log.');
  }
};
