import { hostname } from 'node:os';
import { logger } from '../logger.js';
import {
  extractFlowKnowledgeSource,
  extractManualKnowledgeSource,
  chunkKnowledgeDocuments
} from './chatbot_ai_rag_extractor.service.js';
import { publishRagLexicalIndexRevision } from './chatbot_ai_rag_index.service.js';
import {
  claimRagIndexJob,
  normalizeLeaseOwner,
  recordRagIndexJobFailure,
  RAG_EMBEDDING_STATES
} from './chatbot_ai_rag_job_state.service.js';

const EMPTY_SOURCE_ERROR_CODE = 'RAG_INDEX_SOURCE_EMPTY';

function createProcessorError(code, message, { retryable = false } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function requirePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createProcessorError(
      'RAG_INDEX_PROCESSOR_INVALID_INPUT',
      `${field} harus berupa integer positif.`
    );
  }
  return parsed;
}

function requireDatabaseClient(client) {
  if (!client || typeof client.get !== 'function' || typeof client.run !== 'function') {
    throw createProcessorError(
      'RAG_INDEX_DATABASE_CLIENT_REQUIRED',
      'Database client processor RAG harus menyediakan fungsi get dan run.'
    );
  }
  return client;
}

let runtimeDatabaseContextPromise;

async function getRuntimeDatabaseContext() {
  if (!runtimeDatabaseContextPromise) {
    runtimeDatabaseContextPromise = import('../database.js').then(({
      dbGet,
      dbRun,
      dbPath
    }) => ({
      client: { get: dbGet, run: dbRun },
      databasePath: dbPath
    }));
  }
  return runtimeDatabaseContextPromise;
}

async function resolveDatabaseContext(databaseClient, databasePath) {
  if (databaseClient && databasePath) {
    return {
      client: requireDatabaseClient(databaseClient),
      databasePath
    };
  }

  const runtime = await getRuntimeDatabaseContext();
  return {
    client: requireDatabaseClient(databaseClient || runtime.client),
    databasePath: databasePath || runtime.databasePath
  };
}

export function createRagIndexLeaseOwner({
  host = hostname(),
  processId = process.pid,
  prefix = 'rag-index'
} = {}) {
  const safeHost = String(host || 'unknown')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
  const safeProcessId = Number.isInteger(Number(processId)) && Number(processId) > 0
    ? Number(processId)
    : 'unknown';
  return normalizeLeaseOwner(`${prefix}:${safeHost}:${safeProcessId}`.slice(0, 128));
}

export function resolveLexicalPublishEmbeddingStatus(source) {
  const status = String(source?.embedding_status || '').trim().toUpperCase();
  if (status === RAG_EMBEDDING_STATES.FAILED) return RAG_EMBEDDING_STATES.FAILED;
  if (
    source?.embedding_profile_id
    || status === RAG_EMBEDDING_STATES.PENDING
    || status === RAG_EMBEDDING_STATES.READY
    || status === RAG_EMBEDDING_STATES.STALE
  ) {
    return RAG_EMBEDDING_STATES.PENDING;
  }
  return RAG_EMBEDDING_STATES.DISABLED;
}

async function loadSourceDocuments(source, client) {
  if (source.source_type === 'flow') {
    const flow = await client.get(
      'SELECT * FROM chatbot_flows WHERE id = ? AND user_id = ?',
      [source.flow_id, source.user_id]
    );
    if (!flow) {
      throw createProcessorError(
        'RAG_INDEX_FLOW_NOT_FOUND',
        'Flow sumber job RAG tidak ditemukan untuk pemilik ini.'
      );
    }
    return extractFlowKnowledgeSource(flow, { userId: source.user_id }).documents;
  }

  if (source.source_type === 'manual') {
    const settings = await client.get(
      `SELECT knowledge_base
       FROM chatbot_ai_settings
       WHERE session_id = ? AND user_id = ?`,
      [source.manual_session_id, source.user_id]
    );
    if (!settings) {
      throw createProcessorError(
        'RAG_INDEX_MANUAL_SOURCE_NOT_FOUND',
        'Knowledge base manual job RAG tidak ditemukan untuk pemilik ini.'
      );
    }
    return extractManualKnowledgeSource({
      userId: source.user_id,
      sessionId: source.manual_session_id,
      knowledgeBase: settings.knowledge_base
    }).documents;
  }

  throw createProcessorError(
    'RAG_INDEX_SOURCE_TYPE_UNSUPPORTED',
    'Tipe sumber job RAG tidak didukung.'
  );
}

export async function processRagIndexJob({
  jobId,
  userId,
  leaseOwner = createRagIndexLeaseOwner(),
  leaseDurationSeconds = 300,
  databaseClient = null,
  databasePath = null
}) {
  const safeJobId = requirePositiveInteger(jobId, 'jobId');
  const safeUserId = requirePositiveInteger(userId, 'userId');
  const safeLeaseOwner = normalizeLeaseOwner(leaseOwner);
  const database = await resolveDatabaseContext(databaseClient, databasePath);

  const claim = await claimRagIndexJob({
    jobId: safeJobId,
    userId: safeUserId,
    leaseOwner: safeLeaseOwner,
    leaseDurationSeconds
  }, database.client);

  if (!claim.claimed) {
    return {
      job_id: safeJobId,
      user_id: safeUserId,
      processed: false,
      succeeded: false,
      status: claim.status || null,
      reason: claim.reason
    };
  }

  try {
    const source = await database.client.get(
      `SELECT id, user_id, source_type, flow_id, manual_session_id,
              current_revision, indexed_revision, lexical_status,
              embedding_status, embedding_profile_id, is_active
       FROM rag_sources
       WHERE id = ? AND user_id = ?`,
      [claim.job.source_id, safeUserId]
    );

    if (!source) {
      throw createProcessorError(
        'RAG_INDEX_SOURCE_NOT_FOUND',
        'Sumber job RAG tidak ditemukan untuk pemilik ini.'
      );
    }

    const documents = await loadSourceDocuments(source, database.client);
    const chunks = chunkKnowledgeDocuments(documents);
    if (chunks.length === 0) {
      throw createProcessorError(
        EMPTY_SOURCE_ERROR_CODE,
        'Sumber aktif tidak menghasilkan chunk yang dapat diindeks.'
      );
    }

    const publication = await publishRagLexicalIndexRevision({
      jobId: safeJobId,
      userId: safeUserId,
      leaseOwner: safeLeaseOwner,
      chunks,
      embeddingStatus: resolveLexicalPublishEmbeddingStatus(source),
      databasePath: database.databasePath,
      finalizeJob: true
    });

    return {
      job_id: safeJobId,
      user_id: safeUserId,
      source_id: source.id,
      processed: publication.executed,
      succeeded: publication.status === 'READY',
      status: publication.status,
      reason: publication.reason || null,
      chunk_count: publication.result?.chunk_count || 0,
      lexical_status: publication.result?.lexical_status || null,
      embedding_status: publication.result?.embedding_status || null
    };
  } catch (error) {
    try {
      const failure = await recordRagIndexJobFailure({
        jobId: safeJobId,
        userId: safeUserId,
        error
      }, database.client);
      return {
        job_id: safeJobId,
        user_id: safeUserId,
        processed: true,
        succeeded: false,
        status: failure.status,
        reason: 'processing_failed',
        error_code: failure.last_error_code,
        retry_scheduled: failure.retry_scheduled,
        next_attempt_at: failure.next_attempt_at
      };
    } catch (stateError) {
      stateError.cause = stateError.cause || error;
      throw stateError;
    }
  }
}

export async function processRagIndexJobs(jobs, {
  leaseOwner = createRagIndexLeaseOwner(),
  leaseDurationSeconds = 300,
  databaseClient = null,
  databasePath = null,
  processorLogger = logger
} = {}) {
  if (!Array.isArray(jobs)) {
    throw createProcessorError(
      'RAG_INDEX_PROCESSOR_INVALID_INPUT',
      'Daftar job RAG harus berupa array.'
    );
  }

  const results = [];
  for (const job of jobs) {
    try {
      const result = await processRagIndexJob({
        jobId: job?.id,
        userId: job?.user_id,
        leaseOwner,
        leaseDurationSeconds,
        databaseClient,
        databasePath
      });
      results.push(result);
      const log = result.succeeded ? processorLogger.info : processorLogger.debug;
      log?.call(processorLogger, {
        job_id: result.job_id,
        user_id: result.user_id,
        source_id: result.source_id,
        status: result.status,
        reason: result.reason,
        chunk_count: result.chunk_count,
        error_code: result.error_code
      }, 'RAG index job processed');
    } catch (error) {
      results.push({
        job_id: job?.id || null,
        user_id: job?.user_id || null,
        processed: false,
        succeeded: false,
        status: null,
        reason: 'processor_error',
        error_code: error?.code || 'RAG_INDEX_PROCESSOR_ERROR'
      });
      processorLogger.error?.({
        err: { code: error?.code, message: error?.message },
        job_id: job?.id,
        user_id: job?.user_id
      }, 'RAG index job processor failed');
    }
  }

  return {
    requested_count: jobs.length,
    ready_count: results.filter((result) => result.succeeded).length,
    failed_count: results.filter((result) => result.reason === 'processing_failed' || result.reason === 'processor_error').length,
    skipped_count: results.filter((result) => !result.processed && result.reason !== 'processor_error').length,
    chunk_count: results.reduce((total, result) => total + (Number(result.chunk_count) || 0), 0),
    results
  };
}
