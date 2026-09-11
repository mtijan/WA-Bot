export const RAG_INDEX_JOB_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  READY: 'READY',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED'
});

export const RAG_LEXICAL_STATES = Object.freeze({
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
  STALE: 'STALE'
});

export const RAG_EMBEDDING_STATES = Object.freeze({
  DISABLED: 'DISABLED',
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
  STALE: 'STALE'
});

export const RAG_INDEX_SAFE_ERROR_CODES = Object.freeze({
  RATE_LIMITED: 'RAG_INDEX_RATE_LIMITED',
  TIMEOUT: 'RAG_INDEX_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'RAG_INDEX_PROVIDER_UNAVAILABLE',
  NETWORK: 'RAG_INDEX_NETWORK',
  PERMANENT: 'RAG_INDEX_PERMANENT',
  UNKNOWN: 'RAG_INDEX_UNKNOWN'
});

export const RAG_INDEX_RETRY_DEFAULTS = Object.freeze({
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 30_000,
  MAX_DELAY_MS: 15 * 60_000
});

const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNABORTED',
  'UND_ERR_HEADERS_TIMEOUT',
  'AI_PROVIDER_TIMEOUT'
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT'
]);

const JOB_TRANSITIONS = Object.freeze({
  [RAG_INDEX_JOB_STATES.PENDING]: new Set([
    RAG_INDEX_JOB_STATES.RUNNING,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.RUNNING]: new Set([
    RAG_INDEX_JOB_STATES.PENDING,
    RAG_INDEX_JOB_STATES.READY,
    RAG_INDEX_JOB_STATES.FAILED,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.FAILED]: new Set([
    RAG_INDEX_JOB_STATES.PENDING,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.READY]: new Set([
    RAG_INDEX_JOB_STATES.PENDING
  ]),
  [RAG_INDEX_JOB_STATES.SUPERSEDED]: new Set()
});

export function isRagIndexJobState(value) {
  return Object.values(RAG_INDEX_JOB_STATES).includes(value);
}

export function canTransitionRagIndexJobState(fromState, toState) {
  if (!isRagIndexJobState(fromState) || !isRagIndexJobState(toState)) return false;
  return JOB_TRANSITIONS[fromState].has(toState);
}

export function assertRagIndexJobTransition(fromState, toState) {
  if (!canTransitionRagIndexJobState(fromState, toState)) {
    const error = new Error(`Transisi state job RAG tidak valid: ${fromState} -> ${toState}.`);
    error.code = 'RAG_INDEX_JOB_INVALID_TRANSITION';
    error.details = { fromState, toState };
    throw error;
  }
  return toState;
}

function createRagIndexJobError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      `${field} harus berupa integer positif.`
    );
  }
  return value;
}

function requireDatabaseClient(client) {
  if (!client || typeof client.get !== 'function' || typeof client.run !== 'function') {
    throw createRagIndexJobError(
      'RAG_INDEX_DATABASE_CLIENT_REQUIRED',
      'Database client job RAG harus menyediakan fungsi get dan run.'
    );
  }
  return client;
}

function normalizeStatus(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return Number.isInteger(status) ? status : null;
}

function normalizeInternalErrorCode(error) {
  return String(error?.code || '').trim().toUpperCase();
}

export function classifyRagIndexJobError(error) {
  const status = normalizeStatus(error);
  const internalCode = normalizeInternalErrorCode(error);

  if (error?.retryable === false) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.PERMANENT, retryable: false };
  }
  if (status === 429 || internalCode === 'AI_PROVIDER_RATE_LIMITED') {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.RATE_LIMITED, retryable: true };
  }
  if (status === 408 || status === 425 || TIMEOUT_ERROR_CODES.has(internalCode)) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT, retryable: true };
  }
  if (status === 409 || (status !== null && status >= 500 && status <= 599)) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.PROVIDER_UNAVAILABLE, retryable: true };
  }
  if (NETWORK_ERROR_CODES.has(internalCode)) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.NETWORK, retryable: true };
  }
  if (status !== null && status >= 400 && status <= 499) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.PERMANENT, retryable: false };
  }
  if (error?.retryable === true) {
    return { code: RAG_INDEX_SAFE_ERROR_CODES.PROVIDER_UNAVAILABLE, retryable: true };
  }
  return { code: RAG_INDEX_SAFE_ERROR_CODES.UNKNOWN, retryable: true };
}

export function calculateRagIndexRetryDelayMs(attempts, {
  baseDelayMs = RAG_INDEX_RETRY_DEFAULTS.BASE_DELAY_MS,
  maxDelayMs = RAG_INDEX_RETRY_DEFAULTS.MAX_DELAY_MS
} = {}) {
  requirePositiveInteger(attempts, 'attempts');
  requirePositiveInteger(baseDelayMs, 'baseDelayMs');
  requirePositiveInteger(maxDelayMs, 'maxDelayMs');
  if (baseDelayMs > maxDelayMs || maxDelayMs > RAG_INDEX_RETRY_DEFAULTS.MAX_DELAY_MS) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      'Retry delay job RAG harus berurutan dan tidak melebihi batas aman.'
    );
  }
  return Math.min(maxDelayMs, baseDelayMs * (2 ** (attempts - 1)));
}

function toSqliteUtcTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      'now harus berupa tanggal yang valid.'
    );
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

let runtimeDatabaseClientPromise;

async function getRuntimeDatabaseClient() {
  if (!runtimeDatabaseClientPromise) {
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbGet, dbRun }) => ({
      get: dbGet,
      run: dbRun
    }));
  }
  return runtimeDatabaseClientPromise;
}

export async function recordRagIndexJobFailure({
  jobId,
  userId,
  error,
  maxAttempts = RAG_INDEX_RETRY_DEFAULTS.MAX_ATTEMPTS,
  baseDelayMs = RAG_INDEX_RETRY_DEFAULTS.BASE_DELAY_MS,
  maxDelayMs = RAG_INDEX_RETRY_DEFAULTS.MAX_DELAY_MS,
  now = new Date()
}, databaseClient = null) {
  requirePositiveInteger(jobId, 'jobId');
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(maxAttempts, 'maxAttempts');
  if (maxAttempts > RAG_INDEX_RETRY_DEFAULTS.MAX_ATTEMPTS) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      'maxAttempts melebihi batas aman job RAG.'
    );
  }
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());
  const job = await client.get(
    `SELECT id, user_id, status, attempts
     FROM rag_index_jobs
     WHERE id = ? AND user_id = ?`,
    [jobId, userId]
  );

  if (!job) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_NOT_FOUND',
      'Job index RAG tidak ditemukan untuk pemilik ini.'
    );
  }
  assertRagIndexJobTransition(job.status, RAG_INDEX_JOB_STATES.FAILED);

  // Legacy PROCESSING rows may have attempts=0. Treat the active run as attempt one.
  const effectiveAttempts = Math.max(1, Number(job.attempts) || 0);
  const classification = classifyRagIndexJobError(error);
  const retryScheduled = classification.retryable && effectiveAttempts < maxAttempts;
  const nextState = retryScheduled
    ? RAG_INDEX_JOB_STATES.PENDING
    : RAG_INDEX_JOB_STATES.FAILED;
  assertRagIndexJobTransition(job.status, nextState);

  let nextAttemptAt = null;
  if (retryScheduled) {
    const delayMs = calculateRagIndexRetryDelayMs(effectiveAttempts, {
      baseDelayMs,
      maxDelayMs
    });
    nextAttemptAt = toSqliteUtcTimestamp(new Date(new Date(now).getTime() + delayMs));
  }

  const updateResult = await client.run(
    `UPDATE rag_index_jobs
     SET status = ?, attempts = ?, lease_owner = NULL, lease_expires_at = NULL,
         next_attempt_at = ?, last_error_code = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'RUNNING' AND attempts = ?`,
    [
      nextState,
      effectiveAttempts,
      nextAttemptAt,
      classification.code,
      nowTimestamp,
      jobId,
      userId,
      job.attempts
    ]
  );

  if (updateResult.changes !== 1) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_STATE_CONFLICT',
      'State job RAG berubah sebelum kegagalan dapat dicatat.'
    );
  }

  return {
    id: jobId,
    user_id: userId,
    status: nextState,
    attempts: effectiveAttempts,
    next_attempt_at: nextAttemptAt,
    last_error_code: classification.code,
    retry_scheduled: retryScheduled
  };
}

export function normalizeLeaseOwner(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      'leaseOwner harus berupa identifier aman maksimal 128 karakter.'
    );
  }
  return normalized;
}

export async function claimRagIndexJob({
  jobId,
  userId,
  leaseOwner,
  leaseDurationSeconds = 300,
  now = new Date()
}, databaseClient = null) {
  requirePositiveInteger(jobId, 'jobId');
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(leaseDurationSeconds, 'leaseDurationSeconds');
  if (leaseDurationSeconds > 86400) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_INVALID_INPUT',
      'leaseDurationSeconds melebihi batas aman 24 jam.'
    );
  }
  const safeLeaseOwner = normalizeLeaseOwner(leaseOwner);
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const leaseExpiresAt = toSqliteUtcTimestamp(
    new Date(new Date(now).getTime() + (leaseDurationSeconds * 1000))
  );
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const job = await client.get(
    `SELECT jobs.id, jobs.source_id, jobs.user_id, jobs.requested_revision,
            jobs.embedding_config_hash, jobs.status, jobs.attempts,
            sources.current_revision, sources.is_active
     FROM rag_index_jobs AS jobs
     JOIN rag_sources AS sources
       ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
     WHERE jobs.id = ? AND jobs.user_id = ?`,
    [jobId, userId]
  );

  if (!job) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_NOT_FOUND',
      'Job index RAG tidak ditemukan untuk pemilik ini.'
    );
  }

  if (job.status !== RAG_INDEX_JOB_STATES.PENDING) {
    return {
      claimed: false,
      reason: 'not_pending',
      status: job.status
    };
  }

  const isStale = Number(job.is_active) !== 1
    || Number(job.current_revision) !== Number(job.requested_revision);

  if (isStale) {
    assertRagIndexJobTransition(job.status, RAG_INDEX_JOB_STATES.SUPERSEDED);
    await client.run(
      `UPDATE rag_index_jobs
       SET status = 'SUPERSEDED',
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = NULL,
           last_error_code = NULL,
           updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'PENDING'`,
      [nowTimestamp, jobId, userId]
    );
    return {
      claimed: false,
      reason: 'superseded',
      status: RAG_INDEX_JOB_STATES.SUPERSEDED,
      staleReason: Number(job.is_active) !== 1 ? 'source_inactive' : 'revision_stale'
    };
  }

  assertRagIndexJobTransition(job.status, RAG_INDEX_JOB_STATES.RUNNING);

  const updateResult = await client.run(
    `UPDATE rag_index_jobs
     SET status = 'RUNNING',
         attempts = attempts + 1,
         lease_owner = ?,
         lease_expires_at = ?,
         updated_at = ?
     WHERE id = ?
       AND user_id = ?
       AND status = 'PENDING'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
    [safeLeaseOwner, leaseExpiresAt, nowTimestamp, jobId, userId, nowTimestamp]
  );

  if (updateResult.changes !== 1) {
    return {
      claimed: false,
      reason: 'state_conflict'
    };
  }

  const claimedJob = await client.get(
    `SELECT id, source_id, user_id, requested_revision, embedding_config_hash,
            status, attempts, lease_owner, lease_expires_at, next_attempt_at,
            last_error_code, created_at, updated_at
     FROM rag_index_jobs
     WHERE id = ? AND user_id = ?`,
    [jobId, userId]
  );

  return {
    claimed: true,
    job: claimedJob
  };
}

export async function claimNextRagIndexJob({
  leaseOwner,
  leaseDurationSeconds = 300,
  now = new Date()
}, databaseClient = null) {
  const safeLeaseOwner = normalizeLeaseOwner(leaseOwner);
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const candidate = await client.get(
    `SELECT jobs.id, jobs.user_id
     FROM rag_index_jobs AS jobs
     JOIN rag_sources AS sources
       ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
     WHERE jobs.status = 'PENDING'
       AND (jobs.next_attempt_at IS NULL OR jobs.next_attempt_at <= ?)
       AND sources.is_active = 1
       AND sources.current_revision = jobs.requested_revision
     ORDER BY COALESCE(jobs.next_attempt_at, jobs.created_at), jobs.id
     LIMIT 1`,
    [nowTimestamp]
  );

  if (!candidate) {
    return { claimed: false, reason: 'no_due_jobs', job: null };
  }

  return claimRagIndexJob({
    jobId: candidate.id,
    userId: candidate.user_id,
    leaseOwner: safeLeaseOwner,
    leaseDurationSeconds,
    now
  }, client);
}

export async function completeRagIndexJob({
  jobId,
  userId,
  leaseOwner,
  now = new Date()
}, databaseClient = null) {
  requirePositiveInteger(jobId, 'jobId');
  requirePositiveInteger(userId, 'userId');
  const safeLeaseOwner = normalizeLeaseOwner(leaseOwner);
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const job = await client.get(
    `SELECT id, user_id, status, lease_owner, lease_expires_at
     FROM rag_index_jobs
     WHERE id = ? AND user_id = ?`,
    [jobId, userId]
  );

  if (!job) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_NOT_FOUND',
      'Job index RAG tidak ditemukan untuk pemilik ini.'
    );
  }
  if (job.status !== RAG_INDEX_JOB_STATES.RUNNING) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_NOT_RUNNING',
      'Hanya job RUNNING yang dapat diselesaikan.'
    );
  }
  if (job.lease_owner !== safeLeaseOwner) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_LEASE_MISMATCH',
      'Lease job RAG bukan milik worker ini.'
    );
  }
  if (!job.lease_expires_at || job.lease_expires_at <= nowTimestamp) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_LEASE_EXPIRED',
      'Lease job RAG telah kedaluwarsa.'
    );
  }

  assertRagIndexJobTransition(job.status, RAG_INDEX_JOB_STATES.READY);

  const updateResult = await client.run(
    `UPDATE rag_index_jobs
     SET status = 'READY',
         lease_owner = NULL,
         lease_expires_at = NULL,
         next_attempt_at = NULL,
         last_error_code = NULL,
         updated_at = ?
     WHERE id = ?
       AND user_id = ?
       AND status = 'RUNNING'
       AND lease_owner = ?`,
    [nowTimestamp, jobId, userId, safeLeaseOwner]
  );

  if (updateResult.changes !== 1) {
    throw createRagIndexJobError(
      'RAG_INDEX_JOB_STATE_CONFLICT',
      'State job RAG berubah sebelum dapat diselesaikan.'
    );
  }

  return {
    id: jobId,
    user_id: userId,
    status: RAG_INDEX_JOB_STATES.READY,
    completed_at: nowTimestamp
  };
}

export async function recoverExpiredRagIndexJobLeases({
  now = new Date(),
  maxAttempts = RAG_INDEX_RETRY_DEFAULTS.MAX_ATTEMPTS,
  baseDelayMs = RAG_INDEX_RETRY_DEFAULTS.BASE_DELAY_MS,
  maxDelayMs = RAG_INDEX_RETRY_DEFAULTS.MAX_DELAY_MS
} = {}, databaseClient = null) {
  requirePositiveInteger(maxAttempts, 'maxAttempts');
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  if (typeof client.all !== 'function') {
    throw createRagIndexJobError(
      'RAG_INDEX_DATABASE_CLIENT_REQUIRED',
      'Database client job RAG harus menyediakan fungsi all untuk pemulihan lease.'
    );
  }

  const expiredJobs = await client.all(
    `SELECT jobs.id, jobs.user_id, jobs.source_id, jobs.requested_revision,
            jobs.attempts, jobs.lease_owner, jobs.lease_expires_at,
            sources.current_revision, sources.is_active
     FROM rag_index_jobs AS jobs
     LEFT JOIN rag_sources AS sources
       ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
     WHERE jobs.status = 'RUNNING'
       AND jobs.lease_expires_at IS NOT NULL
       AND jobs.lease_expires_at <= ?
     ORDER BY jobs.id ASC`,
    [nowTimestamp]
  );

  const details = [];
  let rescheduledCount = 0;
  let failedCount = 0;
  let supersededCount = 0;

  for (const job of (expiredJobs || [])) {
    const isStale = !job.current_revision
      || Number(job.is_active) !== 1
      || Number(job.current_revision) !== Number(job.requested_revision);

    if (isStale) {
      const updateResult = await client.run(
        `UPDATE rag_index_jobs
         SET status = 'SUPERSEDED',
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = NULL,
             last_error_code = NULL,
             updated_at = ?
         WHERE id = ? AND status = 'RUNNING' AND lease_expires_at <= ?`,
        [nowTimestamp, job.id, nowTimestamp]
      );
      if (updateResult.changes === 1) {
        supersededCount += 1;
        details.push({ id: job.id, action: 'superseded', reason: 'stale_or_inactive' });
      }
      continue;
    }

    const currentAttempts = Math.max(1, Number(job.attempts) || 1);
    if (currentAttempts < maxAttempts) {
      const delayMs = calculateRagIndexRetryDelayMs(currentAttempts, { baseDelayMs, maxDelayMs });
      const nextAttemptAt = toSqliteUtcTimestamp(new Date(new Date(now).getTime() + delayMs));

      const updateResult = await client.run(
        `UPDATE rag_index_jobs
         SET status = 'PENDING',
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = ?,
             last_error_code = ?,
             updated_at = ?
         WHERE id = ? AND status = 'RUNNING' AND lease_expires_at <= ?`,
        [nextAttemptAt, RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT, nowTimestamp, job.id, nowTimestamp]
      );
      if (updateResult.changes === 1) {
        rescheduledCount += 1;
        details.push({
          id: job.id,
          action: 'rescheduled',
          attempts: currentAttempts,
          next_attempt_at: nextAttemptAt
        });
      }
    } else {
      const updateResult = await client.run(
        `UPDATE rag_index_jobs
         SET status = 'FAILED',
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = NULL,
             last_error_code = ?,
             updated_at = ?
         WHERE id = ? AND status = 'RUNNING' AND lease_expires_at <= ?`,
        [RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT, nowTimestamp, job.id, nowTimestamp]
      );
      if (updateResult.changes === 1) {
        failedCount += 1;
        details.push({
          id: job.id,
          action: 'failed',
          attempts: currentAttempts
        });
      }
    }
  }

  return {
    recoveredCount: rescheduledCount + failedCount + supersededCount,
    rescheduledCount,
    failedCount,
    supersededCount,
    details
  };
}

export async function cleanupSupersededRagIndexJobs({
  sourceId,
  userId,
  currentRevision,
  now = new Date()
}, databaseClient = null) {
  requirePositiveInteger(sourceId, 'sourceId');
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(currentRevision, 'currentRevision');
  const nowTimestamp = toSqliteUtcTimestamp(now);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const result = await client.run(
    `UPDATE rag_index_jobs
     SET status = 'SUPERSEDED',
         lease_owner = NULL,
         lease_expires_at = NULL,
         next_attempt_at = NULL,
         last_error_code = NULL,
         updated_at = ?
     WHERE source_id = ?
       AND user_id = ?
       AND requested_revision < ?
       AND (
         status IN ('PENDING', 'FAILED')
         OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
       )`,
    [nowTimestamp, sourceId, userId, currentRevision, nowTimestamp]
  );

  return {
    sourceId,
    userId,
    currentRevision,
    supersededCount: result?.changes || 0
  };
}

