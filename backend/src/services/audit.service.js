import { dbRun } from '../database.js';
import { logError } from '../logger.js';

/**
 * Metadata fields that must never be persisted verbatim.
 * Values under these keys are replaced with '[REDACTED]'.
 */
const SENSITIVE_KEYS = new Set([
  'password', 'old_password', 'new_password',
  'token', 'access_token', 'refresh_token',
  'api_key', 'secret', 'encryption_key', 'backup_key',
  'proxy_url', 'proxy_credentials',
]);

/**
 * Recursively mask sensitive fields in a plain object.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function maskMetadata(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskMetadata(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Extract the real client IP from the request, respecting trusted proxy headers.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIp(req) {
  return (
    req.ip ||
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Write one audit log entry. Designed to be fire-and-forget — do not await
 * this call in request handlers so it never delays the HTTP response.
 *
 * @param {import('express').Request} req  - Express request (used for actor info and IP).
 * @param {string}  eventType   - Uppercase snake_case event name, e.g. 'AUTH_LOGIN'.
 * @param {string|null}  targetType   - Entity type affected, e.g. 'user', 'session'.
 * @param {string|null}  targetId     - String ID of the target entity.
 * @param {'success'|'failure'}  result       - Outcome of the action.
 * @param {Record<string, unknown>}  [metadata]  - Additional context (auto-masked for secrets).
 */
export async function auditLog(req, eventType, targetType, targetId, result, metadata = {}) {
  try {
    const auth = req?.auth;
    const actorUserId = auth?.userId ?? null;
    const actorUsername = auth?.username ?? null;
    const actorRole = auth?.role ?? 'anonymous';
    const ip = getClientIp(req);
    const maskedMeta = maskMetadata(metadata);
    const metaJson = Object.keys(maskedMeta).length > 0
      ? JSON.stringify(maskedMeta)
      : null;

    await dbRun(
      `INSERT INTO audit_logs
        (actor_user_id, actor_username, actor_role, event_type, target_type, target_id, ip_address, result, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        actorUsername,
        actorRole,
        eventType,
        targetType ?? null,
        targetId !== undefined && targetId !== null ? String(targetId) : null,
        ip,
        result,
        metaJson,
      ]
    );
  } catch (err) {
    // Audit failure must never break the main request flow.
    logError('auditLog', err, { eventType, targetType, targetId, result });
  }
}