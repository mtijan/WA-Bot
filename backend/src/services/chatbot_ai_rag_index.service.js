import sqlite3 from 'sqlite3';
import {
  extractFlowKnowledgeSource,
  extractManualKnowledgeSource,
  resolveRagSourceRevision
} from './chatbot_ai_rag_extractor.service.js';
import {
  assertRagIndexJobTransition,
  claimNextRagIndexJob,
  claimRagIndexJob,
  cleanupSupersededRagIndexJobs,
  completeRagIndexJob,
  normalizeLeaseOwner,
  RAG_EMBEDDING_STATES,
  RAG_INDEX_JOB_STATES,
  recoverExpiredRagIndexJobLeases
} from './chatbot_ai_rag_job_state.service.js';

export {
  claimNextRagIndexJob,
  claimRagIndexJob,
  cleanupSupersededRagIndexJobs,
  completeRagIndexJob,
  recoverExpiredRagIndexJobLeases
};

const LEXICAL_PUBLISH_EMBEDDING_STATES = new Set([
  RAG_EMBEDDING_STATES.DISABLED,
  RAG_EMBEDDING_STATES.PENDING,
  RAG_EMBEDDING_STATES.FAILED
]);

function createRagIndexError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRagIndexError('RAG_INDEX_INVALID_INPUT', `${field} harus berupa integer positif.`);
  }
  return value;
}

function normalizeEmbeddingConfigHash(value = '') {
  const normalized = String(value || '').trim();
  if (normalized.length > 128 || !/^[A-Za-z0-9._:-]*$/.test(normalized)) {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_INPUT',
      'embeddingConfigHash harus berupa identifier aman maksimal 128 karakter.'
    );
  }
  return normalized;
}

function normalizeLexicalPublishEmbeddingStatus(value) {
  const normalized = String(value || RAG_EMBEDDING_STATES.DISABLED).trim().toUpperCase();
  if (!LEXICAL_PUBLISH_EMBEDDING_STATES.has(normalized)) {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_INPUT',
      'embeddingStatus publikasi lexical harus DISABLED, PENDING, atau FAILED.'
    );
  }
  return normalized;
}

function serializeChunkMetadata(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_CHUNK',
      'Metadata chunk RAG harus berupa object JSON.'
    );
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
      throw new TypeError('Metadata JSON tidak menghasilkan string.');
    }
    return serialized;
  } catch {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_CHUNK',
      'Metadata chunk RAG harus dapat diserialisasi sebagai JSON.'
    );
  }
}

function normalizeLexicalChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_CHUNK',
      'Publikasi lexical RAG memerlukan minimal satu chunk.'
    );
  }

  return chunks.map((chunk, position) => {
    if (!chunk || typeof chunk !== 'object') {
      throw createRagIndexError('RAG_INDEX_INVALID_CHUNK', 'Chunk RAG harus berupa object.');
    }
    if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex !== position) {
      throw createRagIndexError(
        'RAG_INDEX_INVALID_CHUNK',
        'chunkIndex RAG harus berurutan dari nol tanpa duplikasi.'
      );
    }
    const text = String(chunk.text || '').trim();
    if (!text) {
      throw createRagIndexError('RAG_INDEX_INVALID_CHUNK', 'Teks chunk RAG tidak boleh kosong.');
    }
    const lexicalProbe = text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*/u)?.[0];
    if (!lexicalProbe) {
      throw createRagIndexError(
        'RAG_INDEX_INVALID_CHUNK',
        'Teks chunk RAG harus memiliki minimal satu token lexical.'
      );
    }
    if (!Number.isInteger(chunk.tokenCount) || chunk.tokenCount <= 0) {
      throw createRagIndexError(
        'RAG_INDEX_INVALID_CHUNK',
        'tokenCount chunk RAG harus berupa integer positif.'
      );
    }
    const contentHash = normalizeEmbeddingConfigHash(chunk.contentHash);
    if (!contentHash) {
      throw createRagIndexError(
        'RAG_INDEX_INVALID_CHUNK',
        'contentHash chunk RAG wajib diisi.'
      );
    }
    return Object.freeze({
      chunkIndex: chunk.chunkIndex,
      text,
      tokenCount: chunk.tokenCount,
      metadataJson: serializeChunkMetadata(chunk.metadata),
      contentHash,
      lexicalMatchQuery: `"${lexicalProbe.replaceAll('"', '""')}"`
    });
  });
}

function requireDatabaseClient(client) {
  if (!client || typeof client.run !== 'function' || typeof client.get !== 'function') {
    throw createRagIndexError(
      'RAG_INDEX_DATABASE_CLIENT_REQUIRED',
      'Database client RAG harus menyediakan fungsi run dan get.'
    );
  }
  return client;
}

let runtimeDatabaseClientPromise;

async function getRuntimeDatabaseClient() {
  if (!runtimeDatabaseClientPromise) {
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbGet, dbRun, dbAll }) => ({
      get: dbGet,
      run: dbRun,
      all: dbAll
    }));
  }
  return runtimeDatabaseClientPromise;
}

function openDatabase(path) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(path, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => error ? reject(error) : resolve());
  });
}

async function resolveRuntimeDatabasePath(databasePath) {
  if (databasePath !== null && databasePath !== undefined) {
    const normalized = String(databasePath).trim();
    if (!normalized) {
      throw createRagIndexError('RAG_INDEX_INVALID_INPUT', 'databasePath tidak boleh kosong.');
    }
    return normalized;
  }
  const runtimeDatabase = await import('../database.js');
  await runtimeDatabase.databaseReady;
  return runtimeDatabase.dbPath;
}

async function withImmediateTransaction(databasePath, work) {
  const database = await openDatabase(databasePath);
  try {
    await run(database, 'PRAGMA foreign_keys = ON');
    await run(database, 'PRAGMA busy_timeout = 5000');
    await run(database, 'BEGIN IMMEDIATE');
    try {
      const result = await work(database);
      await run(database, 'COMMIT');
      return result;
    } catch (error) {
      await run(database, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await close(database);
  }
}

function mapIndexJob(row, idempotent) {
  return {
    id: row.id,
    source_id: row.source_id,
    user_id: row.user_id,
    requested_revision: row.requested_revision,
    embedding_config_hash: row.embedding_config_hash,
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: row.next_attempt_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    idempotent
  };
}

export async function enqueueRagIndexJob({
  sourceId,
  userId,
  requestedRevision,
  embeddingConfigHash = ''
}, databaseClient = null) {
  requirePositiveInteger(sourceId, 'sourceId');
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(requestedRevision, 'requestedRevision');
  const configHash = normalizeEmbeddingConfigHash(embeddingConfigHash);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const insertResult = await client.run(
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, embedding_config_hash
     )
     SELECT id, user_id, ?, ?
     FROM rag_sources
     WHERE id = ?
       AND user_id = ?
       AND current_revision = ?
       AND is_active = 1
     ON CONFLICT(source_id, requested_revision, embedding_config_hash) DO NOTHING`,
    [requestedRevision, configHash, sourceId, userId, requestedRevision]
  );

  const job = await client.get(
    `SELECT jobs.id, jobs.source_id, jobs.user_id, jobs.requested_revision,
            jobs.embedding_config_hash, jobs.status, jobs.attempts,
            jobs.next_attempt_at, jobs.created_at, jobs.updated_at
     FROM rag_index_jobs AS jobs
     JOIN rag_sources AS sources
       ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
     WHERE jobs.source_id = ?
       AND jobs.user_id = ?
       AND jobs.requested_revision = ?
       AND jobs.embedding_config_hash = ?
       AND sources.current_revision = jobs.requested_revision
       AND sources.is_active = 1`,
    [sourceId, userId, requestedRevision, configHash]
  );

  if (job) {
    return mapIndexJob(job, insertResult.changes === 0);
  }

  const source = await client.get(
    `SELECT id, current_revision, is_active
     FROM rag_sources
     WHERE id = ? AND user_id = ?`,
    [sourceId, userId]
  );
  if (!source) {
    throw createRagIndexError('RAG_SOURCE_NOT_FOUND', 'Sumber RAG tidak ditemukan untuk pemilik ini.');
  }
  if (Number(source.is_active) !== 1) {
    throw createRagIndexError('RAG_SOURCE_INACTIVE', 'Sumber RAG tidak aktif.');
  }
  if (source.current_revision !== requestedRevision) {
    throw createRagIndexError(
      'RAG_INDEX_REVISION_STALE',
      'Revision sumber yang diminta bukan revision aktif.',
      { requestedRevision, currentRevision: source.current_revision }
    );
  }

  throw createRagIndexError(
    'RAG_INDEX_ENQUEUE_FAILED',
    'Job index tidak dapat dibuat atau dibaca kembali.'
  );
}

export async function runCurrentRagIndexRevisionTransaction({
  jobId,
  userId,
  leaseOwner,
  databasePath = null
}, publishTransaction) {
  requirePositiveInteger(jobId, 'jobId');
  requirePositiveInteger(userId, 'userId');
  const safeLeaseOwner = normalizeLeaseOwner(leaseOwner);
  if (typeof publishTransaction !== 'function') {
    throw createRagIndexError(
      'RAG_INDEX_PUBLISH_CALLBACK_REQUIRED',
      'Callback transaksi publikasi RAG wajib disediakan.'
    );
  }
  const resolvedPath = await resolveRuntimeDatabasePath(databasePath);

  return withImmediateTransaction(resolvedPath, async (database) => {
    const job = await get(
      database,
      `SELECT jobs.id, jobs.source_id, jobs.user_id, jobs.requested_revision,
              jobs.embedding_config_hash, jobs.status, jobs.attempts,
              jobs.lease_owner, jobs.lease_expires_at,
              CASE
                WHEN jobs.lease_expires_at IS NOT NULL
                 AND jobs.lease_expires_at > CURRENT_TIMESTAMP THEN 1
                ELSE 0
              END AS lease_valid,
              sources.current_revision, sources.indexed_revision, sources.is_active
       FROM rag_index_jobs AS jobs
       JOIN rag_sources AS sources
         ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
       WHERE jobs.id = ? AND jobs.user_id = ?`,
      [jobId, userId]
    );

    if (!job) {
      throw createRagIndexError(
        'RAG_INDEX_JOB_NOT_FOUND',
        'Job index RAG tidak ditemukan untuk pemilik ini.'
      );
    }
    if (job.status !== RAG_INDEX_JOB_STATES.RUNNING) {
      throw createRagIndexError(
        'RAG_INDEX_JOB_NOT_RUNNING',
        'Hanya job RAG RUNNING yang dapat memasuki transaksi publikasi.'
      );
    }
    if (job.lease_owner !== safeLeaseOwner) {
      throw createRagIndexError(
        'RAG_INDEX_JOB_LEASE_MISMATCH',
        'Lease job RAG bukan milik worker ini.'
      );
    }
    if (Number(job.lease_valid) !== 1) {
      throw createRagIndexError(
        'RAG_INDEX_JOB_LEASE_EXPIRED',
        'Lease job RAG telah kedaluwarsa.'
      );
    }

    const staleReason = Number(job.is_active) !== 1
      ? 'source_inactive'
      : Number(job.current_revision) !== Number(job.requested_revision)
        || Number(job.indexed_revision) > Number(job.requested_revision)
        ? 'revision_stale'
        : null;

    if (staleReason) {
      assertRagIndexJobTransition(job.status, RAG_INDEX_JOB_STATES.SUPERSEDED);
      const superseded = await run(
        database,
        `UPDATE rag_index_jobs
         SET status = 'SUPERSEDED', lease_owner = NULL, lease_expires_at = NULL,
             next_attempt_at = NULL, last_error_code = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status = 'RUNNING'
           AND lease_owner = ? AND requested_revision = ?`,
        [jobId, userId, safeLeaseOwner, job.requested_revision]
      );
      if (superseded.changes !== 1) {
        throw createRagIndexError(
          'RAG_INDEX_JOB_STATE_CONFLICT',
          'State job RAG berubah sebelum dapat ditandai superseded.'
        );
      }
      return {
        executed: false,
        job_id: jobId,
        status: RAG_INDEX_JOB_STATES.SUPERSEDED,
        reason: staleReason
      };
    }

    const transactionClient = Object.freeze({
      run: (sql, params) => run(database, sql, params),
      get: (sql, params) => get(database, sql, params),
      all: (sql, params) => all(database, sql, params)
    });
    const publishContext = Object.freeze({
      jobId: job.id,
      sourceId: job.source_id,
      userId: job.user_id,
      requestedRevision: job.requested_revision,
      embeddingConfigHash: job.embedding_config_hash,
      attempts: job.attempts,
      leaseOwner: safeLeaseOwner
    });
    const result = await publishTransaction(transactionClient, publishContext);

    const postPublish = await get(
      database,
      `SELECT jobs.status, jobs.lease_owner, sources.current_revision, sources.is_active
       FROM rag_index_jobs AS jobs
       JOIN rag_sources AS sources
         ON sources.id = jobs.source_id AND sources.user_id = jobs.user_id
       WHERE jobs.id = ? AND jobs.user_id = ?`,
      [jobId, userId]
    );
    const isCompleted = postPublish?.status === RAG_INDEX_JOB_STATES.READY && postPublish?.lease_owner === null;
    const isRunning = postPublish?.status === RAG_INDEX_JOB_STATES.RUNNING && postPublish?.lease_owner === safeLeaseOwner;
    if (
      !postPublish
      || (!isRunning && !isCompleted)
      || Number(postPublish.is_active) !== 1
      || Number(postPublish.current_revision) !== Number(job.requested_revision)
    ) {
      throw createRagIndexError(
        'RAG_INDEX_REVISION_CHANGED',
        'Revision atau lease job RAG berubah selama transaksi publikasi.'
      );
    }

    return {
      executed: true,
      job_id: jobId,
      status: postPublish.status,
      result
    };
  });
}

export async function publishRagLexicalIndexRevision({
  jobId,
  userId,
  leaseOwner,
  chunks,
  embeddingStatus = RAG_EMBEDDING_STATES.DISABLED,
  databasePath = null,
  finalizeJob = false
}) {
  const preparedChunks = normalizeLexicalChunks(chunks);
  const nextEmbeddingStatus = normalizeLexicalPublishEmbeddingStatus(embeddingStatus);

  return runCurrentRagIndexRevisionTransaction({
    jobId,
    userId,
    leaseOwner,
    databasePath
  }, async (client, context) => {
    await client.run(
      'DELETE FROM rag_chunks WHERE source_id = ? AND user_id = ?',
      [context.sourceId, context.userId]
    );

    for (const chunk of preparedChunks) {
      await client.run(
        `INSERT INTO rag_chunks (
           source_id, user_id, source_revision, chunk_index,
           chunk_text, token_count, metadata_json, content_hash,
           embedding, embedding_model, embedding_dimensions, embedding_config_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
        [
          context.sourceId,
          context.userId,
          context.requestedRevision,
          chunk.chunkIndex,
          chunk.text,
          chunk.tokenCount,
          chunk.metadataJson,
          chunk.contentHash,
          context.embeddingConfigHash || null
        ]
      );
    }

    const sourceUpdate = await client.run(
      `UPDATE rag_sources
       SET indexed_revision = ?, lexical_status = 'READY', embedding_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND current_revision = ? AND is_active = 1`,
      [
        context.requestedRevision,
        nextEmbeddingStatus,
        context.sourceId,
        context.userId,
        context.requestedRevision
      ]
    );
    if (sourceUpdate.changes !== 1) {
      throw createRagIndexError(
        'RAG_INDEX_SOURCE_STATE_CONFLICT',
        'Source RAG berubah sebelum revision lexical dapat dipublikasikan.'
      );
    }

    const chunkCount = await client.get(
      `SELECT COUNT(*) AS count FROM rag_chunks
       WHERE source_id = ? AND user_id = ? AND source_revision = ?`,
      [context.sourceId, context.userId, context.requestedRevision]
    );
    if (Number(chunkCount?.count) !== preparedChunks.length) {
      throw createRagIndexError(
        'RAG_INDEX_FTS_SYNC_FAILED',
        'FTS RAG tidak sinkron dengan chunk revision yang dipublikasikan.'
      );
    }
    for (const chunk of preparedChunks) {
      const ftsMatch = await client.get(
        `SELECT COUNT(*) AS count
         FROM rag_chunks_fts
         WHERE rowid = (
           SELECT id FROM rag_chunks
           WHERE source_id = ? AND user_id = ?
             AND source_revision = ? AND chunk_index = ?
         )
           AND rag_chunks_fts MATCH ?`,
        [
          context.sourceId,
          context.userId,
          context.requestedRevision,
          chunk.chunkIndex,
          chunk.lexicalMatchQuery
        ]
      );
      if (Number(ftsMatch?.count) !== 1) {
        throw createRagIndexError(
          'RAG_INDEX_FTS_SYNC_FAILED',
          'FTS RAG tidak sinkron dengan chunk revision yang dipublikasikan.'
        );
      }
    }

    if (finalizeJob) {
      await completeRagIndexJob({
        jobId: context.jobId,
        userId: context.userId,
        leaseOwner: context.leaseOwner
      }, client);
    }

    const output = {
      source_id: context.sourceId,
      source_revision: context.requestedRevision,
      chunk_count: preparedChunks.length,
      lexical_status: 'READY',
      embedding_status: nextEmbeddingStatus
    };
    if (finalizeJob) {
      output.job_status = 'READY';
    }
    return output;
  });
}

export async function syncManualKnowledgeSource({
  userId,
  sessionId,
  knowledgeBase = ''
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) {
    throw createRagIndexError('RAG_INDEX_INVALID_INPUT', 'sessionId wajib diisi.');
  }
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const session = await client.get(
    `SELECT session_id, user_id FROM sessions WHERE session_id = ? AND user_id = ?`,
    [safeSessionId, userId]
  );
  if (!session) {
    throw createRagIndexError('RAG_SESSION_NOT_FOUND', 'Sesi tidak ditemukan untuk pemilik ini.');
  }

  const extracted = extractManualKnowledgeSource({
    userId,
    sessionId: safeSessionId,
    knowledgeBase
  });

  const isActive = extracted.documents.length > 0 ? 1 : 0;

  const existing = await client.get(
    `SELECT id, user_id, current_revision, indexed_revision, content_hash,
            lexical_status, embedding_status, is_active
     FROM rag_sources
     WHERE user_id = ?
       AND manual_session_id = ?
       AND source_type = 'manual'`,
    [userId, safeSessionId]
  );

  if (!existing) {
    const insertResult = await client.run(
      `INSERT INTO rag_sources (
         user_id, source_type, flow_id, manual_session_id, content_hash,
         current_revision, indexed_revision, lexical_status, embedding_status, is_active
       ) VALUES (?, 'manual', NULL, ?, ?, 1, 0, 'PENDING', 'DISABLED', ?)`,
      [userId, safeSessionId, extracted.contentHash, isActive]
    );

    const sourceId = insertResult?.id || (await client.get(
      `SELECT id FROM rag_sources WHERE user_id = ? AND manual_session_id = ?`,
      [userId, safeSessionId]
    ))?.id;

    await client.run(
      `INSERT OR IGNORE INTO rag_session_sources (session_id, source_id, user_id)
       VALUES (?, ?, ?)`,
      [safeSessionId, sourceId, userId]
    );

    let job = null;
    if (isActive === 1) {
      job = await enqueueRagIndexJob({
        sourceId,
        userId,
        requestedRevision: 1,
        embeddingConfigHash: ''
      }, client);
    }

    return {
      sourceId,
      revision: 1,
      action: 'created',
      isActive: isActive === 1,
      enqueued: Boolean(job && !job.idempotent),
      job
    };
  }

  const sourceId = existing.id;
  const contentChanged = extracted.contentHash !== existing.content_hash;

  if (contentChanged) {
    const nextRevision = resolveRagSourceRevision({
      previousContentHash: existing.content_hash,
      previousRevision: existing.current_revision,
      contentHash: extracted.contentHash
    });

    await client.run(
      `UPDATE rag_sources
       SET content_hash = ?,
           current_revision = ?,
           lexical_status = 'PENDING',
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [extracted.contentHash, nextRevision, isActive, sourceId, userId]
    );

    await client.run(
      `INSERT OR IGNORE INTO rag_session_sources (session_id, source_id, user_id)
       VALUES (?, ?, ?)`,
      [safeSessionId, sourceId, userId]
    );

    let job = null;
    if (isActive === 1) {
      job = await enqueueRagIndexJob({
        sourceId,
        userId,
        requestedRevision: nextRevision,
        embeddingConfigHash: ''
      }, client);
    }

    await cleanupSupersededRagIndexJobs({
      sourceId,
      userId,
      currentRevision: nextRevision
    }, client);

    return {
      sourceId,
      revision: nextRevision,
      action: 'updated',
      isActive: isActive === 1,
      enqueued: Boolean(job && !job.idempotent),
      job
    };
  }

  const activeChanged = Number(existing.is_active) !== isActive;
  if (activeChanged) {
    await client.run(
      `UPDATE rag_sources
       SET is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [isActive, sourceId, userId]
    );
  }

  await client.run(
    `INSERT OR IGNORE INTO rag_session_sources (session_id, source_id, user_id)
     VALUES (?, ?, ?)`,
    [safeSessionId, sourceId, userId]
  );

  let job = null;
  if (isActive === 1 && (existing.indexed_revision < existing.current_revision || existing.lexical_status !== 'READY')) {
    job = await enqueueRagIndexJob({
      sourceId,
      userId,
      requestedRevision: existing.current_revision,
      embeddingConfigHash: ''
    }, client);
  }

  return {
    sourceId,
    revision: existing.current_revision,
    action: activeChanged ? 'status_updated' : 'noop',
    isActive: isActive === 1,
    enqueued: Boolean(job && !job.idempotent),
    job
  };
}

export async function syncManualKnowledgeSourceSafely(input, databaseClient = null) {
  try {
    return await syncManualKnowledgeSource(input, databaseClient);
  } catch (error) {
    try {
      const { logger } = await import('../logger.js');
      logger?.error?.({ err: error, input: { userId: input?.userId, sessionId: input?.sessionId } }, 'syncManualKnowledgeSourceSafely failed');
    } catch {
      // logger unavailable
    }
    return null;
  }
}

export async function syncFlowKnowledgeSource({
  flowId,
  userId,
  flow = null,
  sessionIds = null
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(flowId, 'flowId');
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  let flowRecord = flow;
  if (!flowRecord || flowRecord.nodes === undefined) {
    flowRecord = await client.get(
      `SELECT * FROM chatbot_flows WHERE id = ? AND user_id = ?`,
      [flowId, userId]
    );
  }
  if (!flowRecord) {
    throw createRagIndexError('RAG_FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan untuk pemilik ini.');
  }
  if (flowRecord.user_id && Number(flowRecord.user_id) !== userId) {
    throw createRagIndexError('RAG_FLOW_FORBIDDEN', 'Anda tidak memiliki akses ke alur chatbot ini.');
  }

  const fullFlow = {
    ...flowRecord,
    id: flowId,
    user_id: userId
  };

  let candidateSessionIds = sessionIds;
  if (!candidateSessionIds) {
    if (Array.isArray(fullFlow.session_ids)) {
      candidateSessionIds = fullFlow.session_ids;
    } else if (typeof fullFlow.session_ids === 'string') {
      try {
        candidateSessionIds = JSON.parse(fullFlow.session_ids || '[]');
      } catch {
        candidateSessionIds = [];
      }
    } else {
      candidateSessionIds = [];
    }
  }

  const normalizedSessionIds = [...new Set(
    (Array.isArray(candidateSessionIds) ? candidateSessionIds : [])
      .map((sid) => String(sid || '').trim())
      .filter(Boolean)
  )];

  let validSessionIds = [];
  if (normalizedSessionIds.length > 0) {
    const placeholders = normalizedSessionIds.map(() => '?').join(',');
    const ownedSessions = await client.all(
      `SELECT session_id FROM sessions WHERE user_id = ? AND session_id IN (${placeholders})`,
      [userId, ...normalizedSessionIds]
    );
    const ownedSet = new Set((ownedSessions || []).map((s) => s.session_id));
    validSessionIds = normalizedSessionIds.filter((sid) => ownedSet.has(sid));
  }

  const extracted = extractFlowKnowledgeSource(fullFlow, { userId });
  const flowStatus = String(fullFlow.status || 'ACTIVE').toUpperCase();
  const isActive = (flowStatus === 'ACTIVE' && extracted.documents.length > 0) ? 1 : 0;

  const existing = await client.get(
    `SELECT id, user_id, current_revision, indexed_revision, content_hash,
            lexical_status, embedding_status, is_active
     FROM rag_sources
     WHERE user_id = ?
       AND flow_id = ?
       AND source_type = 'flow'`,
    [userId, flowId]
  );

  if (!existing) {
    const insertResult = await client.run(
      `INSERT INTO rag_sources (
         user_id, source_type, flow_id, manual_session_id, content_hash,
         current_revision, indexed_revision, lexical_status, embedding_status, is_active
       ) VALUES (?, 'flow', ?, NULL, ?, 1, 0, 'PENDING', 'DISABLED', ?)`,
      [userId, flowId, extracted.contentHash, isActive]
    );

    const sourceId = insertResult?.id || (await client.get(
      `SELECT id FROM rag_sources WHERE user_id = ? AND flow_id = ?`,
      [userId, flowId]
    ))?.id;

    for (const sid of validSessionIds) {
      await client.run(
        `INSERT OR IGNORE INTO rag_session_sources (session_id, source_id, user_id)
         VALUES (?, ?, ?)`,
        [sid, sourceId, userId]
      );
    }

    let job = null;
    if (isActive === 1) {
      job = await enqueueRagIndexJob({
        sourceId,
        userId,
        requestedRevision: 1,
        embeddingConfigHash: ''
      }, client);
    }

    return {
      sourceId,
      revision: 1,
      action: 'created',
      isActive: isActive === 1,
      mappingChanged: validSessionIds.length > 0,
      enqueued: Boolean(job && !job.idempotent),
      validSessionIds,
      job
    };
  }

  const sourceId = existing.id;

  const currentMappings = await client.all(
    `SELECT session_id FROM rag_session_sources WHERE source_id = ? AND user_id = ?`,
    [sourceId, userId]
  );
  const currentSet = new Set((currentMappings || []).map((m) => m.session_id));
  const newSet = new Set(validSessionIds);

  const toRemove = [...currentSet].filter((sid) => !newSet.has(sid));
  for (const sid of toRemove) {
    await client.run(
      `DELETE FROM rag_session_sources WHERE session_id = ? AND source_id = ? AND user_id = ?`,
      [sid, sourceId, userId]
    );
  }

  const toAdd = validSessionIds.filter((sid) => !currentSet.has(sid));
  for (const sid of toAdd) {
    await client.run(
      `INSERT OR IGNORE INTO rag_session_sources (session_id, source_id, user_id)
       VALUES (?, ?, ?)`,
      [sid, sourceId, userId]
    );
  }
  const mappingChanged = toRemove.length > 0 || toAdd.length > 0;

  const contentChanged = extracted.contentHash !== existing.content_hash;

  if (contentChanged) {
    const nextRevision = resolveRagSourceRevision({
      previousContentHash: existing.content_hash,
      previousRevision: existing.current_revision,
      contentHash: extracted.contentHash
    });

    await client.run(
      `UPDATE rag_sources
       SET content_hash = ?,
           current_revision = ?,
           lexical_status = 'PENDING',
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [extracted.contentHash, nextRevision, isActive, sourceId, userId]
    );

    let job = null;
    if (isActive === 1) {
      job = await enqueueRagIndexJob({
        sourceId,
        userId,
        requestedRevision: nextRevision,
        embeddingConfigHash: ''
      }, client);
    }

    await cleanupSupersededRagIndexJobs({
      sourceId,
      userId,
      currentRevision: nextRevision
    }, client);

    return {
      sourceId,
      revision: nextRevision,
      action: 'updated',
      isActive: isActive === 1,
      mappingChanged,
      enqueued: Boolean(job && !job.idempotent),
      validSessionIds,
      job
    };
  }

  const activeChanged = Number(existing.is_active) !== isActive;
  if (activeChanged) {
    await client.run(
      `UPDATE rag_sources
       SET is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [isActive, sourceId, userId]
    );
  }

  let job = null;
  if (isActive === 1 && (existing.indexed_revision < existing.current_revision || existing.lexical_status !== 'READY')) {
    job = await enqueueRagIndexJob({
      sourceId,
      userId,
      requestedRevision: existing.current_revision,
      embeddingConfigHash: ''
    }, client);
  }

  let action = 'noop';
  if (activeChanged) {
    action = 'status_updated';
  } else if (mappingChanged) {
    action = 'mapping_updated';
  }

  return {
    sourceId,
    revision: existing.current_revision,
    action,
    isActive: isActive === 1,
    mappingChanged,
    enqueued: Boolean(job && !job.idempotent),
    validSessionIds,
    job
  };
}

export async function syncFlowKnowledgeSourceSafely(input, databaseClient = null) {
  try {
    return await syncFlowKnowledgeSource(input, databaseClient);
  } catch (error) {
    try {
      const { logger } = await import('../logger.js');
      logger?.error?.({ err: error, input: { userId: input?.userId, flowId: input?.flowId } }, 'syncFlowKnowledgeSourceSafely failed');
    } catch {
      // logger unavailable
    }
    return null;
  }
}

export async function deleteFlowKnowledgeSource({
  flowId,
  userId
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(flowId, 'flowId');
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const existing = await client.get(
    `SELECT id FROM rag_sources WHERE user_id = ? AND flow_id = ? AND source_type = 'flow'`,
    [userId, flowId]
  );

  if (!existing) {
    return { flowId, deleted: false };
  }

  const sourceId = existing.id;

  await client.run(
    `DELETE FROM rag_session_sources WHERE source_id = ? AND user_id = ?`,
    [sourceId, userId]
  );

  await client.run(
    `DELETE FROM rag_index_jobs WHERE source_id = ? AND user_id = ?`,
    [sourceId, userId]
  );

  await client.run(
    `DELETE FROM rag_chunks WHERE source_id = ? AND user_id = ?`,
    [sourceId, userId]
  );

  await client.run(
    `DELETE FROM rag_sources WHERE id = ? AND user_id = ?`,
    [sourceId, userId]
  );

  return {
    flowId,
    sourceId,
    deleted: true
  };
}

export async function deleteFlowKnowledgeSourceSafely(input, databaseClient = null) {
  try {
    return await deleteFlowKnowledgeSource(input, databaseClient);
  } catch (error) {
    try {
      const { logger } = await import('../logger.js');
      logger?.error?.({ err: error, input: { userId: input?.userId, flowId: input?.flowId } }, 'deleteFlowKnowledgeSourceSafely failed');
    } catch {
      // logger unavailable
    }
    return null;
  }
}

export async function reindexKnowledgeSource({
  sourceId,
  userId,
  force = false,
  embeddingConfigHash = ''
}, databaseClient = null) {
  requirePositiveInteger(sourceId, 'sourceId');
  requirePositiveInteger(userId, 'userId');
  const configHash = normalizeEmbeddingConfigHash(embeddingConfigHash);
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const source = await client.get(
    `SELECT id, user_id, source_type, flow_id, manual_session_id, content_hash,
            current_revision, indexed_revision, lexical_status, embedding_status, is_active
     FROM rag_sources
     WHERE id = ?`,
    [sourceId]
  );
  if (!source) {
    throw createRagIndexError('RAG_SOURCE_NOT_FOUND', 'Sumber RAG tidak ditemukan.');
  }
  if (Number(source.user_id) !== userId) {
    throw createRagIndexError('FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sumber RAG ini.');
  }
  if (Number(source.is_active) !== 1) {
    throw createRagIndexError('RAG_SOURCE_INACTIVE', 'Sumber RAG sedang nonaktif.');
  }

  const existingJob = await client.get(
    `SELECT id, source_id, user_id, requested_revision, embedding_config_hash,
            status, attempts, next_attempt_at, created_at, updated_at
     FROM rag_index_jobs
     WHERE source_id = ?
       AND user_id = ?
       AND requested_revision = ?
       AND embedding_config_hash = ?`,
    [sourceId, userId, source.current_revision, configHash]
  );

  let job = null;
  let isNewOrRestarted = false;

  if (!existingJob) {
    job = await enqueueRagIndexJob({
      sourceId,
      userId,
      requestedRevision: source.current_revision,
      embeddingConfigHash: configHash
    }, client);
    isNewOrRestarted = true;
  } else if (existingJob.status === 'FAILED' || (existingJob.status === 'READY' && force)) {
    await client.run(
      `UPDATE rag_index_jobs
       SET status = 'PENDING',
           attempts = 0,
           next_attempt_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [existingJob.id]
    );
    await client.run(
      `UPDATE rag_sources
       SET lexical_status = 'PENDING',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sourceId]
    );
    const refreshedJob = await client.get(
      `SELECT id, source_id, user_id, requested_revision, embedding_config_hash,
              status, attempts, next_attempt_at, created_at, updated_at
       FROM rag_index_jobs
       WHERE id = ?`,
      [existingJob.id]
    );
    job = mapIndexJob(refreshedJob, false);
    isNewOrRestarted = true;
  } else {
    // Already PENDING, RUNNING, or READY without force
    job = mapIndexJob(existingJob, true);
    isNewOrRestarted = false;
  }

  return {
    sourceId: source.id,
    sourceType: source.source_type,
    flowId: source.flow_id,
    manualSessionId: source.manual_session_id,
    revision: source.current_revision,
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    enqueued: isNewOrRestarted,
    idempotent: !isNewOrRestarted,
    job
  };
}

export async function reindexSessionKnowledgeSources({
  sessionId,
  userId,
  sourceId = null,
  force = false,
  embeddingConfigHash = ''
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) {
    throw createRagIndexError('RAG_INDEX_INVALID_INPUT', 'sessionId wajib diisi.');
  }
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const session = await client.get(
    `SELECT session_id, user_id FROM sessions WHERE session_id = ?`,
    [safeSessionId]
  );
  if (!session) {
    throw createRagIndexError('SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
  }
  if (Number(session.user_id) !== userId) {
    throw createRagIndexError('FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
  }

  if (sourceId !== null && sourceId !== undefined) {
    requirePositiveInteger(Number(sourceId), 'sourceId');
    const targetSourceId = Number(sourceId);

    const source = await client.get(
      `SELECT id, user_id, source_type, flow_id, manual_session_id, is_active
       FROM rag_sources
       WHERE id = ?`,
      [targetSourceId]
    );
    if (!source) {
      throw createRagIndexError('RAG_SOURCE_NOT_FOUND', 'Sumber RAG tidak ditemukan.');
    }
    if (Number(source.user_id) !== userId) {
      throw createRagIndexError('FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sumber RAG ini.');
    }
    if (Number(source.is_active) !== 1) {
      throw createRagIndexError('RAG_SOURCE_INACTIVE', 'Sumber RAG sedang nonaktif.');
    }

    const isMapped = await client.get(
      `SELECT 1 FROM rag_session_sources
       WHERE session_id = ? AND source_id = ? AND user_id = ?
       LIMIT 1`,
      [safeSessionId, targetSourceId, userId]
    );
    const isManualOwner = source.source_type === 'manual' && source.manual_session_id === safeSessionId;
    if (!isMapped && !isManualOwner) {
      throw createRagIndexError('RAG_SOURCE_NOT_MAPPED', 'Sumber RAG tidak terhubung dengan sesi ini.');
    }

    const reindexResult = await reindexKnowledgeSource({
      sourceId: targetSourceId,
      userId,
      force,
      embeddingConfigHash
    }, client);

    const mappedJobItem = {
      job_id: reindexResult.jobId,
      source_id: reindexResult.sourceId,
      source_type: reindexResult.sourceType,
      flow_id: reindexResult.flowId,
      manual_session_id: reindexResult.manualSessionId,
      requested_revision: reindexResult.revision,
      status: reindexResult.status,
      attempts: reindexResult.attempts,
      enqueued: reindexResult.enqueued,
      idempotent: reindexResult.idempotent
    };

    return {
      session_id: safeSessionId,
      sources_count: 1,
      jobs: [mappedJobItem],
      job_id: reindexResult.jobId,
      status: reindexResult.status
    };
  }

  let sessionSources = await client.all(
    `SELECT DISTINCT s.id, s.user_id, s.source_type, s.flow_id, s.manual_session_id,
            s.content_hash, s.current_revision, s.indexed_revision,
            s.lexical_status, s.embedding_status, s.is_active
     FROM rag_sources s
     LEFT JOIN rag_session_sources rss ON rss.source_id = s.id AND rss.user_id = s.user_id
     WHERE s.user_id = ?
       AND (rss.session_id = ? OR s.manual_session_id = ?)
       AND s.is_active = 1
     ORDER BY s.id ASC`,
    [userId, safeSessionId, safeSessionId]
  );

  if (!sessionSources || sessionSources.length === 0) {
    const settings = await client.get(
      `SELECT knowledge_base FROM chatbot_ai_settings WHERE session_id = ? AND user_id = ?`,
      [safeSessionId, userId]
    );
    if (settings?.knowledge_base && String(settings.knowledge_base).trim().length > 0) {
      await syncManualKnowledgeSource({
        sessionId: safeSessionId,
        userId,
        knowledgeBase: settings.knowledge_base
      }, client);
    }

    sessionSources = await client.all(
      `SELECT DISTINCT s.id, s.user_id, s.source_type, s.flow_id, s.manual_session_id,
              s.content_hash, s.current_revision, s.indexed_revision,
              s.lexical_status, s.embedding_status, s.is_active
       FROM rag_sources s
       LEFT JOIN rag_session_sources rss ON rss.source_id = s.id AND rss.user_id = s.user_id
       WHERE s.user_id = ?
         AND (rss.session_id = ? OR s.manual_session_id = ?)
         AND s.is_active = 1
       ORDER BY s.id ASC`,
      [userId, safeSessionId, safeSessionId]
    );
  }

  if (!sessionSources || sessionSources.length === 0) {
    return {
      session_id: safeSessionId,
      sources_count: 0,
      jobs: [],
      job_id: null,
      status: 'READY'
    };
  }

  const jobs = [];
  for (const src of sessionSources) {
    const reindexResult = await reindexKnowledgeSource({
      sourceId: src.id,
      userId,
      force,
      embeddingConfigHash
    }, client);
    jobs.push({
      job_id: reindexResult.jobId,
      source_id: reindexResult.sourceId,
      source_type: reindexResult.sourceType,
      flow_id: reindexResult.flowId,
      manual_session_id: reindexResult.manualSessionId,
      requested_revision: reindexResult.revision,
      status: reindexResult.status,
      attempts: reindexResult.attempts,
      enqueued: reindexResult.enqueued,
      idempotent: reindexResult.idempotent
    });
  }

  const hasRunning = jobs.some((j) => j.status === 'RUNNING');
  const hasPending = jobs.some((j) => j.status === 'PENDING');
  const overallStatus = hasRunning ? 'RUNNING' : (hasPending ? 'PENDING' : (jobs[0]?.status || 'READY'));

  return {
    session_id: safeSessionId,
    sources_count: jobs.length,
    jobs,
    job_id: jobs[0]?.job_id || null,
    status: overallStatus
  };
}

export async function reindexSessionKnowledgeSourcesSafely(input, databaseClient = null) {
  try {
    return await reindexSessionKnowledgeSources(input, databaseClient);
  } catch (error) {
    try {
      const { logger } = await import('../logger.js');
      logger?.error?.({ err: error, input: { userId: input?.userId, sessionId: input?.sessionId } }, 'reindexSessionKnowledgeSourcesSafely failed');
    } catch {
      // logger unavailable
    }
    return null;
  }
}

export async function getSessionRagStatus({ sessionId, userId }, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) {
    throw createRagIndexError('RAG_INDEX_INVALID_INPUT', 'sessionId wajib diisi.');
  }
  const client = requireDatabaseClient(databaseClient || await getRuntimeDatabaseClient());

  const session = await client.get(
    `SELECT session_id, user_id FROM sessions WHERE session_id = ?`,
    [safeSessionId]
  );
  if (!session) {
    throw createRagIndexError('SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
  }
  if (Number(session.user_id) !== userId) {
    throw createRagIndexError('FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
  }

  const settings = await client.get(
    `SELECT is_active, rag_mode, rag_top_k, rag_context_tokens, rag_input_budget_tokens,
            embedding_profile_id, cache_enabled, cache_ttl_seconds, direct_answer_enabled, debounce_ms,
            max_output_tokens, temperature, last_error, last_error_at, config_revision
     FROM chatbot_ai_settings
     WHERE session_id = ?`,
    [safeSessionId]
  ) || {};

  const sources = typeof client.all === 'function'
    ? await client.all(
      `SELECT rs.id, rs.source_type, rs.current_revision, rs.indexed_revision,
              rs.lexical_status, rs.embedding_status, rs.is_active
       FROM rag_session_sources rss
       JOIN rag_sources rs ON rs.id = rss.source_id
       WHERE rss.session_id = ? AND rss.user_id = ? AND rs.is_active = 1`,
      [safeSessionId, userId]
    )
    : [];

  let totalChunks = 0;
  if (sources.length > 0) {
    const chunkRow = await client.get(
      `SELECT COUNT(*) as count
       FROM rag_chunks rc
       JOIN rag_session_sources rss ON rss.source_id = rc.source_id
       WHERE rss.session_id = ? AND rss.user_id = ?`,
      [safeSessionId, userId]
    );
    totalChunks = Number(chunkRow?.count) || 0;
  }

  let activeJob = null;
  if (typeof client.get === 'function' && sources.length > 0) {
    activeJob = await client.get(
      `SELECT id, status, attempts, last_error_code, updated_at
       FROM rag_index_jobs
       WHERE user_id = ?
         AND status IN ('PENDING', 'RUNNING')
         AND source_id IN (
           SELECT source_id FROM rag_session_sources WHERE session_id = ? AND user_id = ?
         )
       ORDER BY id DESC LIMIT 1`,
      [userId, safeSessionId, userId]
    );
  }

  const isLexicalReady = sources.length > 0 && sources.every((s) => s.lexical_status === 'READY');
  const isEmbeddingReady = sources.length > 0 && sources.every((s) => s.embedding_status === 'READY');
  const hasEmbeddingProfile = Boolean(settings.embedding_profile_id);
  const ragMode = settings.rag_mode || 'off';
  const isIndexReady = ragMode === 'hybrid'
    ? (isLexicalReady && isEmbeddingReady)
    : (ragMode === 'fts' ? isLexicalReady : false);
  const isOperationalReady = ragMode === 'off'
    ? false
    : isLexicalReady;

  const currentRevision = sources.reduce(
    (max, s) => Math.max(max, Number(s.current_revision) || 0),
    0
  );

  return {
    session_id: safeSessionId,
    rag_mode: ragMode,
    index_ready: isIndexReady,
    operational_ready: isOperationalReady,
    lexical_ready: isLexicalReady,
    embedding_ready: isEmbeddingReady,
    has_embedding_profile: hasEmbeddingProfile,
    sources_count: sources.length,
    source_count: sources.length,
    chunks_count: totalChunks,
    chunk_count: totalChunks,
    current_revision: currentRevision,
    config_revision: Number(settings.config_revision) || 1,
    cache_enabled: Number(settings.cache_enabled) === 1,
    cache_ttl_seconds: Number(settings.cache_ttl_seconds) || 86400,
    active_job: activeJob ? {
      id: activeJob.id,
      status: activeJob.status,
      attempts: activeJob.attempts,
      last_error_code: activeJob.last_error_code,
      updated_at: activeJob.updated_at
    } : null,
    last_error: settings.last_error || activeJob?.last_error_code || null,
    last_error_at: settings.last_error_at || activeJob?.updated_at || null
  };
}



