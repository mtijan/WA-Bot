import { config } from '../config.js';
import { logger } from '../logger.js';
import { recoverExpiredRagIndexJobLeases } from './chatbot_ai_rag_job_state.service.js';
import { processRagIndexJobs } from './chatbot_ai_rag_processor.service.js';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;

export function isRagIndexPollingRole(role, enabled) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return Boolean(enabled) && (normalizedRole === 'all' || normalizedRole === 'worker');
}

function requirePositiveInteger(value, field, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (fallback !== undefined) return fallback;
  const error = new Error(`${field} harus berupa integer positif.`);
  error.code = 'RAG_INDEX_WORKER_INVALID_INPUT';
  throw error;
}

function requireDatabaseClient(client) {
  if (!client || typeof client.all !== 'function') {
    const error = new Error('Database client worker RAG harus menyediakan fungsi all.');
    error.code = 'RAG_INDEX_DATABASE_CLIENT_REQUIRED';
    throw error;
  }
  return client;
}

let runtimeDatabaseClientPromise;

async function getRuntimeDatabaseClient() {
  if (!runtimeDatabaseClientPromise) {
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbAll }) => ({ all: dbAll }));
  }
  return runtimeDatabaseClientPromise;
}

export async function listDueRagIndexJobs({ limit = DEFAULT_BATCH_SIZE } = {}, databaseClient = null) {
  const safeLimit = requirePositiveInteger(limit, 'limit');
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());
  const rows = await client.all(
    `SELECT jobs.id, jobs.source_id, jobs.user_id, jobs.requested_revision,
            jobs.embedding_config_hash, jobs.status, jobs.attempts,
            jobs.next_attempt_at, jobs.created_at, jobs.updated_at
     FROM rag_index_jobs AS jobs
     JOIN rag_sources AS sources
       ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
     WHERE jobs.status = 'PENDING'
       AND (jobs.next_attempt_at IS NULL OR jobs.next_attempt_at <= CURRENT_TIMESTAMP)
       AND sources.is_active = 1
       AND sources.current_revision = jobs.requested_revision
     ORDER BY COALESCE(jobs.next_attempt_at, jobs.created_at), jobs.id
     LIMIT ?`,
    [safeLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    source_id: row.source_id,
    user_id: row.user_id,
    requested_revision: row.requested_revision,
    embedding_config_hash: row.embedding_config_hash,
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: row.next_attempt_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export class RagIndexPollingWorker {
  constructor({
    pollJobs = listDueRagIndexJobs,
    handleJobs = processRagIndexJobs,
    recoverLeases = async () => ({
      recovered_count: 0,
      rescheduled_count: 0,
      failed_count: 0,
      superseded_count: 0,
      details: []
    }),
    databaseClient = null,
    intervalMs = config.runtime.ragIndexWorkerPollMs,
    batchSize = config.runtime.ragIndexWorkerBatchSize,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    workerLogger = logger
  } = {}) {
    this.pollJobs = pollJobs;
    this.handleJobs = handleJobs;
    this.recoverLeases = recoverLeases;
    this.databaseClient = databaseClient;
    this.intervalMs = requirePositiveInteger(intervalMs, 'intervalMs', DEFAULT_POLL_INTERVAL_MS);
    this.batchSize = requirePositiveInteger(batchSize, 'batchSize', DEFAULT_BATCH_SIZE);
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.workerLogger = workerLogger;
    this.pollingTimer = null;
    this.pollInFlight = null;
  }

  async pollOnce() {
    if (this.pollInFlight) {
      return { skipped: true, reason: 'poll_in_flight', jobs: [] };
    }

    const cycle = (async () => {
      const recovery = await this.recoverLeases({}, this.databaseClient);
      const jobs = await this.pollJobs({ limit: this.batchSize }, this.databaseClient);
      let handlerResult = null;
      if (jobs.length > 0) {
        handlerResult = await this.handleJobs(jobs);
      }
      return { skipped: false, jobs, recovery, handler_result: handlerResult };
    })();
    this.pollInFlight = cycle;

    try {
      return await cycle;
    } finally {
      if (this.pollInFlight === cycle) this.pollInFlight = null;
    }
  }

  async runBackgroundCycle() {
    try {
      const result = await this.pollOnce();
      if (!result.skipped && result.jobs.length > 0) {
        this.workerLogger.debug(
          { due_jobs: result.jobs.length },
          'RAG index worker found due jobs'
        );
      }
      return result;
    } catch (error) {
      this.workerLogger.error(
        { err: { message: error?.message, code: error?.code } },
        'RAG index worker polling failed'
      );
      return { skipped: false, jobs: [], error: true };
    }
  }

  async startPollingWorker() {
    if (this.pollingTimer) return false;

    await this.runBackgroundCycle();
    this.pollingTimer = this.setIntervalFn(() => this.runBackgroundCycle(), this.intervalMs);
    this.pollingTimer?.unref?.();
    this.workerLogger.info(
      { interval_ms: this.intervalMs, batch_size: this.batchSize },
      'RAG index worker polling started'
    );
    return true;
  }

  async stopPollingWorker() {
    const wasRunning = Boolean(this.pollingTimer);
    if (this.pollingTimer) {
      this.clearIntervalFn(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.pollInFlight) await this.pollInFlight;
    if (wasRunning) this.workerLogger.info('RAG index worker polling stopped');
    return wasRunning;
  }
}

const ragIndexPollingWorker = new RagIndexPollingWorker({
  recoverLeases: recoverExpiredRagIndexJobLeases
});

export default ragIndexPollingWorker;
