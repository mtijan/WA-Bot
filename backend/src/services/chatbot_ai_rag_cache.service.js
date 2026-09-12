import crypto from 'crypto';
import { protectSecret, revealSecret } from './secret.service.js';
import { logger } from '../logger.js';

export const CACHE_BOUNDS = Object.freeze({
  MIN_TTL_SECONDS: 60,
  MAX_TTL_SECONDS: 86_400,
  DEFAULT_TTL_SECONDS: 86_400,
  MAX_ENTRIES_PER_SESSION: 1000
});

export const DIRECT_ANSWER_DEFAULTS = Object.freeze({
  CONFIDENCE_THRESHOLD: 0.85,
  MIN_CONFIDENCE_THRESHOLD: 0.70
});

// PII patterns: email, Indonesian phone, 16-digit card/NIK, OTP/passwords
const PII_PATTERNS = Object.freeze([
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  /\b(?:08|\+?628)[0-9]{8,12}\b/,
  /\b\d{16}\b/,
  /\b(?:otp|kode verifikasi|password|pin rahasia)\b/i
]);

export function containsPersonalData(text) {
  if (!text || typeof text !== 'string') return false;
  return PII_PATTERNS.some((pattern) => pattern.test(text));
}

let defaultDbClient = null;

async function resolveDatabaseClient(databaseClient = null) {
  if (databaseClient) {
    return {
      get: typeof databaseClient.get === 'function' ? databaseClient.get.bind(databaseClient) : async () => null,
      all: typeof databaseClient.all === 'function' ? databaseClient.all.bind(databaseClient) : async () => [],
      run: typeof databaseClient.run === 'function' ? databaseClient.run.bind(databaseClient) : async () => ({ changes: 0 })
    };
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

export function validateCacheTtl(ttlSeconds) {
  const numeric = Number(ttlSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return CACHE_BOUNDS.DEFAULT_TTL_SECONDS;
  }
  return Math.max(
    CACHE_BOUNDS.MIN_TTL_SECONDS,
    Math.min(Math.round(numeric), CACHE_BOUNDS.MAX_TTL_SECONDS)
  );
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

export function shouldCacheResult(result, options = {}) {
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

  // RAG-0710: Prohibit caching personal responses or queries containing PII
  if (options.isPersonal === true) {
    return false;
  }
  if (containsPersonalData(result.reply) || containsPersonalData(options.query)) {
    return false;
  }

  return true;
}

export function resolveDirectAnswerCandidate(ragResult, options = {}) {
  if (!ragResult || !Array.isArray(ragResult.results) || ragResult.results.length === 0) {
    return null;
  }
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : DIRECT_ANSWER_DEFAULTS.CONFIDENCE_THRESHOLD;

  const topCandidate = ragResult.results[0];
  if (!topCandidate || typeof topCandidate.chunk_text !== 'string') {
    return null;
  }

  const isExplicitCanonical =
    topCandidate.metadata?.canonical === true ||
    topCandidate.metadata?.is_canonical === true ||
    topCandidate.metadata?.direct_answer === true ||
    topCandidate.canonical === true;

  const score = Number(topCandidate.relevance_score ?? topCandidate.score ?? 0);

  const qualifies = (isExplicitCanonical && score >= DIRECT_ANSWER_DEFAULTS.MIN_CONFIDENCE_THRESHOLD) ||
                    (score >= threshold);

  if (!qualifies) {
    return null;
  }

  const directReply = String(
    topCandidate.metadata?.direct_answer_text || topCandidate.chunk_text
  ).trim();

  if (!directReply) {
    return null;
  }

  return Object.freeze({
    isDirectAnswer: true,
    candidate: topCandidate,
    confidence: score,
    directReply,
    sourceId: topCandidate.source_id,
    sourceRevision: topCandidate.source_revision
  });
}

export async function enforceSessionCacheEntryLimit(
  userId,
  sessionId,
  maxEntries = CACHE_BOUNDS.MAX_ENTRIES_PER_SESSION,
  databaseClient = null
) {
  const client = await resolveDatabaseClient(databaseClient);
  if (typeof client.get !== 'function' || typeof client.run !== 'function') return 0;
  try {
    const countRow = await client.get(
      'SELECT COUNT(*) AS total FROM rag_response_cache WHERE user_id = ? AND session_id = ?',
      [userId, sessionId]
    );
    const total = countRow?.total || 0;
    if (total >= maxEntries) {
      const excess = total - maxEntries + 1;
      const deleteResult = await client.run(
        `DELETE FROM rag_response_cache
         WHERE id IN (
           SELECT id FROM rag_response_cache
           WHERE user_id = ? AND session_id = ?
           ORDER BY created_at ASC, id ASC
           LIMIT ?
         )`,
        [userId, sessionId, excess]
      );
      return deleteResult?.changes || 0;
    }
    return 0;
  } catch (err) {
    logger.warn({ err, userId, sessionId }, 'Failed to enforce session cache entry limit');
    return 0;
  }
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
  maxEntries = CACHE_BOUNDS.MAX_ENTRIES_PER_SESSION,
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
  const safeTtl = validateCacheTtl(ttlSeconds);
  const expiresAt = new Date(now + safeTtl * 1000).toISOString();
  const encryptedText = protectSecret(safeReply);

  try {
    if (typeof client.run === 'function') {
      // Enforce per-session entry limit (RAG-0706)
      await enforceSessionCacheEntryLimit(userId, sessionId, maxEntries, databaseClient);

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

export async function pruneOldChatbotAIUsage({
  olderThanDays = 30,
  now = new Date()
} = {}, databaseClient = null) {
  const client = await resolveDatabaseClient(databaseClient);
  if (typeof client.run !== 'function') return 0;
  const cutoffDate = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  try {
    const result = await client.run(
      'DELETE FROM chatbot_ai_usage WHERE created_at <= ?',
      [cutoffDate]
    );
    return result?.changes || 0;
  } catch (err) {
    logger.error({ err }, 'Failed to prune old Chatbot AI usage records');
    return 0;
  }
}

export async function pruneOldRagIndexJobs({
  olderThanDays = 7,
  now = new Date()
} = {}, databaseClient = null) {
  const client = await resolveDatabaseClient(databaseClient);
  if (typeof client.run !== 'function') return 0;
  const cutoffDate = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  try {
    const result = await client.run(
      "DELETE FROM rag_index_jobs WHERE status IN ('READY', 'SUPERSEDED') AND updated_at <= ?",
      [cutoffDate]
    );
    return result?.changes || 0;
  } catch (err) {
    logger.error({ err }, 'Failed to prune old RAG index jobs');
    return 0;
  }
}
