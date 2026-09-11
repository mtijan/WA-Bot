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
  [RAG_INDEX_JOB_STATES.READY]: new Set(),
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
