import { dbAll, dbGet } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

/**
 * GET /api/audit-logs
 *
 * Query params:
 *   - event_type  {string}  Filter by exact event type (e.g. AUTH_LOGIN)
 *   - target_type {string}  Filter by target entity type (e.g. session, user)
 *   - result      {string}  Filter by result: 'success' | 'failure'
 *   - page        {number}  Page number, 1-based (default: 1)
 *   - limit       {number}  Rows per page, max 200 (default: 50)
 *
 * Admin:  sees all log entries.
 * Non-admin: sees only entries where actor_user_id = own userId.
 */
export const listAuditLogs = async (req, res) => {
  try {
    const isAdmin = req.auth.role === 'admin';
    const userId = req.auth.userId;

    const rawPage = parseInt(req.query.page, 10);
    const rawLimit = parseInt(req.query.limit, 10);
    const page = rawPage > 0 ? rawPage : 1;
    const limit = rawLimit > 0 && rawLimit <= 200 ? rawLimit : 50;
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    let targetUserId = userId;
    const isFiltered = req.query.target_user_id && isAdmin;
    if (isFiltered) {
      targetUserId = Number(req.query.target_user_id);
    }

    if (!isAdmin || isFiltered) {
      conditions.push('actor_user_id = ?');
      params.push(targetUserId);
    }

    if (req.query.event_type) {
      conditions.push('event_type = ?');
      params.push(String(req.query.event_type).toUpperCase());
    }

    if (req.query.target_type) {
      conditions.push('target_type = ?');
      params.push(String(req.query.target_type));
    }

    if (req.query.result) {
      conditions.push('result = ?');
      params.push(String(req.query.result));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await dbGet(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    );
    const total = countRow?.total ?? 0;

    const rows = await dbAll(
      `SELECT id, actor_user_id, actor_username, actor_role, event_type,
              target_type, target_id, ip_address, result, metadata, created_at
       FROM audit_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Parse metadata JSON string back to object for API consumers.
    const data = rows.map((row) => ({
      ...row,
      metadata: row.metadata ? (() => { try { return JSON.parse(row.metadata); } catch { return null; } })() : null,
    }));

    return sendSuccess(res, data, 200, {
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('listAuditLogs', error);
    return sendError(res, 500, 'LIST_AUDIT_LOGS_ERROR', 'Gagal memuat log audit.');
  }
};