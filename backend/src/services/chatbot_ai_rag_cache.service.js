import crypto from 'crypto';
import { protectSecret, revealSecret } from './secret.service.js';
import { logger } from '../logger.js';

export const CACHE_BOUNDS = Object.freeze({
  MIN_TTL_SECONDS: 60,
  MAX_TTL_SECONDS: 86_400,
  DEFAULT_TTL_SECONDS: 86_400
});

let defaultDbClient = null;

async function resolveDatabaseClient(databaseClient = null) {
  if (databaseClient) {
    if (typeof databaseClient.get !== 'function' || typeof databaseClient.all !== 'function') {
      throw new Error('Database client must provide get, all, and run functions.');
    }
    return databaseClient;
  }
  if (!defaultDbClient) {
    const db = await import('../database.js');
    defaultDbClient = { get: db.dbGet, all: db.dbAll, run: db.dbRun };
  }
  return defaultDbClient;
}

export function normalizeQueryForCache(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function computeCacheKey({
  userId,
  sessionId,
  query,
  promptVersion = 1,
  configRevision = 1,
  model = 'gpt-4o-mini',
  temperature = 0.3
}) {
  if (!userId || !sessionId) {
    throw new Error('userId and sessionId are required to compute cache key.');
  }
  const normalizedQuery = normalizeQueryForCache(query);
  if (!normalizedQuery) {
    throw new Error('query must not be empty.');
  }

  const payload = [
    `uid:${userId}`,
    `sess:${sessionId}`,
    `q:${normalizedQuery}`,
    `pv:${promptVersion}`,
    `cr:${configRevision}`,
    `m:${model}`,
    `t:${Number(temperature).toFixed(2)}`
  ].join('|');

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export async function computeSourceRevisionDigest(
  userId,
  sessionId,
  databaseClient = null
) {
  const client = await resolveDatabaseClient(databaseClient);
  try {
    const rows = await client.all(
      `SELECT s.id, s.current_revision
       FROM sessions AS sess
       JOIN rag_session_sources AS rss
         ON rss.session_id = sess.session_id AND rss.user_id = sess.user_id
       JOIN rag_sources AS s
         ON s.id = rss.source_id AND s.user_id = rss.user_id
       WHERE sess.session_id = ? AND sess.user_id = ? AND s.is_active = 1
       ORDER BY s.id ASC`,
      [sessionId, userId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return 'empty_sources';
    }

    const digestInput = rows
      .map((row) => `${row.id}:${row.current_revision}`)
      .join(';');

    return crypto.createHash('sha256').update(digestInput, 'utf8').digest('hex');
  } catch (err) {
    logger.error({ err, userId, sessionId }, 'Failed to compute source revision digest');
    return 'digest_error';
  }
}

export function shouldCacheResult(result) {
  if (!result || typeof result !== 'object') {
    return false;
  }
  if (result.status !== 'REPLIED') {
    return false;
  }
  if (!result.reply || typeof result.reply !== 'string' || !result.reply.trim()) {
    return false;
  }
  if (result.error) {
    return false;
  }
  if (result.ragMetadata?.cs_fallback === true) {
    return false;
  }

  const finishReason = result.finishReason
    || result.providerResponse?.choices?.[0]?.finish_reason
    || result.finish_reason;

  if (finishReason && finishReason !== 'stop') {
    return false;
  }

  return true;
}

export async function lookupCachedResponse({
  userId,
  sessionId,
  query,
  promptVersion = 1,
  configRevision = 1,
  model = 'gpt-4o-mini',
  temperature = 0.3,
  databaseClient = null,
  now = Date.now()
}) {
  const client = await resolveDatabaseClient(databaseClient);
  const cacheKey = computeCacheKey({
    userId,
    sessionId,
    query,
    promptVersion,
    configRevision,
    model,
    temperature
  });

  try {
    const row = await client.get(
      `SELECT id, response_ciphertext, source_revision_digest, expires_at, created_at
       FROM rag_response_cache
       WHERE user_id = ? AND session_id = ? AND cache_key = ?`,
      [userId, sessionId, cacheKey]
    );

    if (!row) {
      return null;
    }

    const expiryTime = new Date(row.expires_at).getTime();
    if (expiryTime <= now) {
      if (typeof client.run === 'function') {
        await client.run(
          `DELETE FROM rag_response_cache WHERE id = ?`,
          [row.id]
        );
      }
      return null;
    }

    const currentDigest = await computeSourceRevisionDigest(userId, sessionId, databaseClient);
    if (row.source_revision_digest !== currentDigest) {
      if (typeof client.run === 'function') {
        await client.run(
          `DELETE FROM rag_response_cache WHERE id = ?`,
          [row.id]
        );
      }
      return null;
    }

    const rawCiphertext = typeof row.response_ciphertext === 'string'
      ? row.response_ciphertext
      : Buffer.isBuffer(row.response_ciphertext)
        ? row.response_ciphertext.toString('utf8')
        : String(row.response_ciphertext || '');

    const decryptedReply = revealSecret(rawCiphertext);

    return Object.freeze({
      cacheHit: true,
      reply: decryptedReply,
      cacheKey,
      sourceRevisionDigest: row.source_revision_digest,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    });
  } catch (err) {
    logger.warn({ err, userId, sessionId }, 'Error looking up RAG response cache');
    return null;
  }
}

export async function storeCachedResponse({
  userId,
  sessionId,
  query,
  promptVersion = 1,
  configRevision = 1,
  model = 'gpt-4o-mini',
  temperature = 0.3,
  reply,
  ttlSeconds = CACHE_BOUNDS.DEFAULT_TTL_SECONDS,
  databaseClient = null,
  now = Date.now()
}) {
  const safeReply = String(reply || '').trim();
  if (!safeReply) return false;

  const client = await resolveDatabaseClient(databaseClient);
  const cacheKey = computeCacheKey({
    userId,
    sessionId,
    query,
    promptVersion,
    configRevision,
    model,
    temperature
  });

  const currentDigest = await computeSourceRevisionDigest(userId, sessionId, databaseClient);
  const safeTtl = Math.max(
    CACHE_BOUNDS.MIN_TTL_SECONDS,
    Math.min(Number(ttlSeconds) || CACHE_BOUNDS.DEFAULT_TTL_SECONDS, CACHE_BOUNDS.MAX_TTL_SECONDS)
  );
  const expiresAt = new Date(now + safeTtl * 1000).toISOString();
  const encryptedText = protectSecret(safeReply);

  try {
    if (typeof client.run === 'function') {
      await client.run(
        `INSERT INTO rag_response_cache (user_id, session_id, cache_key, source_revision_digest, response_ciphertext, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, session_id, cache_key) DO UPDATE SET
           source_revision_digest = excluded.source_revision_digest,
           response_ciphertext = excluded.response_ciphertext,
           expires_at = excluded.expires_at,
           created_at = CURRENT_TIMESTAMP`,
        [userId, sessionId, cacheKey, currentDigest, encryptedText, expiresAt]
      );
      return true;
    }
    return false;
  } catch (err) {
    logger.error({ err, userId, sessionId }, 'Error storing response into RAG cache');
    return false;
  }
}

export async function invalidateSessionCache(
  userId,
  sessionId,
  databaseClient = null
) {
  const client = await resolveDatabaseClient(databaseClient);
  if (typeof client.run !== 'function') return 0;

  try {
    const result = await client.run(
      `DELETE FROM rag_response_cache WHERE user_id = ? AND session_id = ?`,
      [userId, sessionId]
    );
    return result?.changes || 0;
  } catch (err) {
    logger.error({ err, userId, sessionId }, 'Failed to invalidate session RAG cache');
    return 0;
  }
}

export async function pruneExpiredCache(
  databaseClient = null,
  nowIso = new Date().toISOString()
) {
  const client = await resolveDatabaseClient(databaseClient);
  if (typeof client.run !== 'function') return 0;

  try {
    const result = await client.run(
      `DELETE FROM rag_response_cache WHERE expires_at <= ?`,
      [nowIso]
    );
    return result?.changes || 0;
  } catch (err) {
    logger.error({ err }, 'Failed to prune expired RAG response cache');
    return 0;
  }
}
