import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import { publishRagLexicalIndexRevision } from '../src/services/chatbot_ai_rag_index.service.js';

const silentLogger = { log() {} };

function openDatabase(path) {
  return new sqlite3.Database(path);
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
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => error ? reject(error) : resolve());
  });
}

async function createFixture(t, {
  currentRevision = 2,
  indexedRevision = 1,
  jobRevision = 2,
  embeddingConfigHash = 'profile-v2'
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-publish-'));
  const databasePath = join(directory, 'publish.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = openDatabase(databasePath);
  await runMigrations(database, { logger: silentLogger });
  await run(
    database,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'publish-owner', 'test-hash', 'Publish Owner', 'admin', 1),
            (2, 'publish-other', 'test-hash', 'Publish Other', 'user', 1)`
  );
  await run(
    database,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('publish-session', 'CONNECTED', 1)`
  );
  const source = await run(
    database,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, lexical_status, embedding_status, is_active
     ) VALUES (1, 'manual', 'publish-session', 'source-v2', ?, ?, 'STALE', 'STALE', 1)`,
    [currentRevision, indexedRevision]
  );
  await run(
    database,
    `INSERT INTO rag_chunks (
       source_id, user_id, source_revision, chunk_index,
       chunk_text, token_count, content_hash
     ) VALUES (?, 1, ?, 0, 'konten lama jangan dipakai', 5, 'old-content-hash')`,
    [source.id, indexedRevision]
  );
  const job = await run(
    database,
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, embedding_config_hash,
       status, attempts, lease_owner, lease_expires_at
     ) VALUES (?, 1, ?, ?, 'RUNNING', 1, 'worker-publish', '2099-01-01 00:00:00')`,
    [source.id, jobRevision, embeddingConfigHash]
  );
  await close(database);
  return { databasePath, sourceId: source.id, jobId: job.id };
}

const currentChunks = () => [
  {
    chunkIndex: 0,
    text: 'Pendaftaran tersedia melalui formulir resmi.',
    tokenCount: 6,
    contentHash: 'chunk-current-0',
    metadata: { source_type: 'manual', document_id: 'manual:publish-session' }
  },
  {
    chunkIndex: 1,
    text: 'Biaya paket dapat ditanyakan kepada admin.',
    tokenCount: 7,
    contentHash: 'chunk-current-1',
    metadata: { source_type: 'manual', document_chunk_index: 1 }
  }
];

test('lexical publish atomically replaces chunks, FTS, and indexed revision while embedding failed', async (t) => {
  const fixture = await createFixture(t);
  const result = await publishRagLexicalIndexRevision({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-publish',
    chunks: currentChunks(),
    embeddingStatus: 'FAILED',
    databasePath: fixture.databasePath
  });

  assert.deepEqual(result, {
    executed: true,
    job_id: fixture.jobId,
    status: 'RUNNING',
    result: {
      source_id: fixture.sourceId,
      source_revision: 2,
      chunk_count: 2,
      lexical_status: 'READY',
      embedding_status: 'FAILED'
    }
  });

  const database = openDatabase(fixture.databasePath);
  assert.deepEqual(
    await get(
      database,
      `SELECT current_revision, indexed_revision, lexical_status, embedding_status
       FROM rag_sources WHERE id = ?`,
      [fixture.sourceId]
    ),
    {
      current_revision: 2,
      indexed_revision: 2,
      lexical_status: 'READY',
      embedding_status: 'FAILED'
    }
  );
  assert.deepEqual(
    await all(
      database,
      `SELECT source_revision, chunk_index, embedding, embedding_config_hash
       FROM rag_chunks WHERE source_id = ? ORDER BY chunk_index`,
      [fixture.sourceId]
    ),
    [
      { source_revision: 2, chunk_index: 0, embedding: null, embedding_config_hash: 'profile-v2' },
      { source_revision: 2, chunk_index: 1, embedding: null, embedding_config_hash: 'profile-v2' }
    ]
  );
  assert.equal(
    (await get(database, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Pendaftaran'`)).count,
    1
  );
  assert.equal(
    (await get(database, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'lama'`)).count,
    0
  );
  assert.equal(
    (await get(database, 'SELECT status FROM rag_index_jobs WHERE id = ?', [fixture.jobId])).status,
    'RUNNING'
  );
  await close(database);
});

test('database failure rolls back chunk delete, FTS changes, and source revision publication', async (t) => {
  const fixture = await createFixture(t);
  const database = openDatabase(fixture.databasePath);
  await run(
    database,
    `CREATE TRIGGER test_abort_rag_publish BEFORE INSERT ON rag_chunks
     WHEN NEW.chunk_text LIKE '%abort-publish%'
     BEGIN
       SELECT RAISE(ABORT, 'forced publish rollback');
     END`
  );
  await close(database);
  const chunks = currentChunks();
  chunks[1] = { ...chunks[1], text: 'abort-publish', tokenCount: 1 };

  await assert.rejects(
    publishRagLexicalIndexRevision({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-publish',
      chunks,
      embeddingStatus: 'PENDING',
      databasePath: fixture.databasePath
    }),
    /forced publish rollback/
  );

  const verification = openDatabase(fixture.databasePath);
  assert.deepEqual(
    await all(
      verification,
      'SELECT source_revision, chunk_text FROM rag_chunks WHERE source_id = ?',
      [fixture.sourceId]
    ),
    [{ source_revision: 1, chunk_text: 'konten lama jangan dipakai' }]
  );
  assert.deepEqual(
    await get(
      verification,
      `SELECT indexed_revision, lexical_status, embedding_status
       FROM rag_sources WHERE id = ?`,
      [fixture.sourceId]
    ),
    { indexed_revision: 1, lexical_status: 'STALE', embedding_status: 'STALE' }
  );
  assert.equal(
    (await get(verification, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'lama'`)).count,
    1
  );
  assert.equal(
    (await get(verification, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Pendaftaran'`)).count,
    0
  );
  await close(verification);
});

test('FTS integrity failure rolls back publication instead of exposing an unsynchronized index', async (t) => {
  const fixture = await createFixture(t);
  const database = openDatabase(fixture.databasePath);
  await run(database, 'DROP TRIGGER trg_rag_chunks_fts_insert');
  await close(database);

  await assert.rejects(
    publishRagLexicalIndexRevision({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-publish',
      chunks: currentChunks(),
      embeddingStatus: 'DISABLED',
      databasePath: fixture.databasePath
    }),
    (error) => error.code === 'RAG_INDEX_FTS_SYNC_FAILED'
  );

  const verification = openDatabase(fixture.databasePath);
  assert.deepEqual(
    await all(
      verification,
      'SELECT source_revision, chunk_text FROM rag_chunks WHERE source_id = ?',
      [fixture.sourceId]
    ),
    [{ source_revision: 1, chunk_text: 'konten lama jangan dipakai' }]
  );
  assert.deepEqual(
    await get(
      verification,
      `SELECT indexed_revision, lexical_status, embedding_status
       FROM rag_sources WHERE id = ?`,
      [fixture.sourceId]
    ),
    { indexed_revision: 1, lexical_status: 'STALE', embedding_status: 'STALE' }
  );
  assert.equal(
    (await get(verification, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'lama'`)).count,
    1
  );
  await close(verification);
});

test('stale lexical publication is superseded without replacing the current index', async (t) => {
  const fixture = await createFixture(t, { currentRevision: 3, jobRevision: 2 });
  const result = await publishRagLexicalIndexRevision({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-publish',
    chunks: currentChunks(),
    embeddingStatus: 'FAILED',
    databasePath: fixture.databasePath
  });

  assert.equal(result.executed, false);
  assert.equal(result.status, 'SUPERSEDED');
  const database = openDatabase(fixture.databasePath);
  assert.deepEqual(
    await all(database, 'SELECT source_revision, chunk_text FROM rag_chunks WHERE source_id = ?', [fixture.sourceId]),
    [{ source_revision: 1, chunk_text: 'konten lama jangan dipakai' }]
  );
  assert.equal(
    (await get(database, 'SELECT status FROM rag_index_jobs WHERE id = ?', [fixture.jobId])).status,
    'SUPERSEDED'
  );
  await close(database);
});

test('lexical publisher rejects empty, unordered, invalid metadata, and READY embedding inputs', async (t) => {
  const fixture = await createFixture(t);
  const base = {
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-publish',
    databasePath: fixture.databasePath
  };
  await assert.rejects(
    publishRagLexicalIndexRevision({ ...base, chunks: [] }),
    (error) => error.code === 'RAG_INDEX_INVALID_CHUNK'
  );
  await assert.rejects(
    publishRagLexicalIndexRevision({
      ...base,
      chunks: [{ ...currentChunks()[0], chunkIndex: 1 }]
    }),
    (error) => error.code === 'RAG_INDEX_INVALID_CHUNK'
  );
  const circular = {};
  circular.self = circular;
  await assert.rejects(
    publishRagLexicalIndexRevision({
      ...base,
      chunks: [{ ...currentChunks()[0], metadata: circular }]
    }),
    (error) => error.code === 'RAG_INDEX_INVALID_CHUNK'
  );
  await assert.rejects(
    publishRagLexicalIndexRevision({
      ...base,
      chunks: currentChunks(),
      embeddingStatus: 'READY'
    }),
    (error) => error.code === 'RAG_INDEX_INVALID_INPUT'
  );

  const database = openDatabase(fixture.databasePath);
  assert.equal((await get(database, 'SELECT COUNT(*) AS count FROM rag_chunks')).count, 1);
  await close(database);
});

test('cross-tenant lexical publication is rejected without changing chunks or FTS', async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    publishRagLexicalIndexRevision({
      jobId: fixture.jobId,
      userId: 2,
      leaseOwner: 'worker-publish',
      chunks: currentChunks(),
      embeddingStatus: 'DISABLED',
      databasePath: fixture.databasePath
    }),
    (error) => error.code === 'RAG_INDEX_JOB_NOT_FOUND'
  );

  const database = openDatabase(fixture.databasePath);
  assert.equal((await get(database, 'SELECT COUNT(*) AS count FROM rag_chunks')).count, 1);
  assert.equal(
    (await get(database, `SELECT COUNT(*) AS count FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'lama'`)).count,
    1
  );
  await close(database);
});
