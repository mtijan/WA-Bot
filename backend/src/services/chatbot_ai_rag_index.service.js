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
