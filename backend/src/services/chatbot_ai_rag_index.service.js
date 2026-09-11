import sqlite3 from 'sqlite3';
import {
  assertRagIndexJobTransition,
  RAG_EMBEDDING_STATES,
  RAG_INDEX_JOB_STATES
} from './chatbot_ai_rag_job_state.service.js';

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

function normalizeLeaseOwner(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw createRagIndexError(
      'RAG_INDEX_INVALID_INPUT',
      'leaseOwner harus berupa identifier aman maksimal 128 karakter.'
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
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbGet, dbRun }) => ({
      get: dbGet,
      run: dbRun
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
    if (
      !postPublish
      || postPublish.status !== RAG_INDEX_JOB_STATES.RUNNING
      || postPublish.lease_owner !== safeLeaseOwner
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
      status: RAG_INDEX_JOB_STATES.RUNNING,
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
  databasePath = null
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

    return {
      source_id: context.sourceId,
      source_revision: context.requestedRevision,
      chunk_count: preparedChunks.length,
      lexical_status: 'READY',
      embedding_status: nextEmbeddingStatus
    };
  });
}
