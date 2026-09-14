import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  createRagIndexLeaseOwner,
  processRagIndexJobs,
  resolveLexicalPublishEmbeddingStatus
} from '../src/services/chatbot_ai_rag_processor.service.js';
import {
  listDueRagIndexJobs
} from '../src/services/chatbot_ai_rag_worker.service.js';
import {
  syncFlowKnowledgeSource,
  syncManualKnowledgeSource
} from '../src/services/chatbot_ai_rag_index.service.js';

const silentLogger = {
  debug() {},
  error() {},
  info() {},
  log() {}
};

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

test('RAG processor creates a unique safe lease owner and preserves embedding readiness intent', () => {
  assert.equal(
    createRagIndexLeaseOwner({ host: 'worker host/01', processId: 42 }),
    'rag-index:worker-host-01:42'
  );
  assert.equal(resolveLexicalPublishEmbeddingStatus({ embedding_status: 'DISABLED' }), 'DISABLED');
  assert.equal(resolveLexicalPublishEmbeddingStatus({ embedding_status: 'FAILED' }), 'FAILED');
  assert.equal(resolveLexicalPublishEmbeddingStatus({ embedding_status: 'STALE' }), 'PENDING');
  assert.equal(resolveLexicalPublishEmbeddingStatus({ embedding_status: 'READY' }), 'PENDING');
  assert.equal(
    resolveLexicalPublishEmbeddingStatus({ embedding_status: 'DISABLED', embedding_profile_id: 7 }),
    'PENDING'
  );
});

test('RAG processor publishes valid chunks, rejects empty sources, and isolates failures in one batch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-processor-'));
  const databasePath = join(directory, 'processor.sqlite');
  const database = openDatabase(databasePath);
  t.after(async () => {
    await close(database);
    await rm(directory, { recursive: true, force: true });
  });
  await runMigrations(database, { logger: silentLogger });
  await run(database, 'DELETE FROM users');
  await run(
    database,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'processor-owner', 'test-hash', 'Processor Owner', 'admin', 1)`
  );
  await run(
    database,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('processor-valid', 'CONNECTED', 1),
            ('processor-flow', 'CONNECTED', 1),
            ('processor-empty', 'CONNECTED', 1)`
  );
  await run(
    database,
    `INSERT INTO chatbot_ai_settings (session_id, user_id, knowledge_base)
     VALUES ('processor-valid', 1, 'Biaya pendaftaran Rp150.000 melalui https://daftar.example.id.'),
            ('processor-empty', 1, '')`
  );
  await run(
    database,
    `INSERT INTO chatbot_flows (
       id, flow_name, session_ids, keywords, nodes, status, user_id
     ) VALUES (
       10, 'Dukungan', '["processor-flow"]', '["bantuan"]',
       '[{"id":"support","message_content":"Hubungi dukungan di +62 812-0000-1111."}]',
       'ACTIVE', 1
     )`
  );

  const client = {
    all: (sql, params) => all(database, sql, params),
    get: (sql, params) => get(database, sql, params),
    run: (sql, params) => run(database, sql, params)
  };
  const validSource = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'processor-valid',
    knowledgeBase: 'Biaya pendaftaran Rp150.000 melalui https://daftar.example.id.'
  }, client);
  await run(
    database,
    `UPDATE rag_sources SET embedding_status = 'PENDING' WHERE id = ? AND user_id = 1`,
    [validSource.sourceId]
  );
  const flowSource = await syncFlowKnowledgeSource({
    flowId: 10,
    userId: 1,
    sessionIds: ['processor-flow']
  }, client);

  const emptySource = await run(
    database,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, lexical_status, embedding_status, is_active
     ) VALUES (1, 'manual', 'processor-empty', 'empty-source', 1, 0, 'PENDING', 'DISABLED', 1)`
  );
  await run(
    database,
    `INSERT INTO rag_session_sources (session_id, source_id, user_id)
     VALUES ('processor-empty', ?, 1)`,
    [emptySource.id]
  );
  await run(
    database,
    `INSERT INTO rag_index_jobs (source_id, user_id, requested_revision, embedding_config_hash)
     VALUES (?, 1, 1, '')`,
    [emptySource.id]
  );

  const jobs = await listDueRagIndexJobs({ limit: 10 }, client);
  assert.equal(jobs.length, 3);
  const summary = await processRagIndexJobs(jobs, {
    leaseOwner: 'test-rag-processor',
    databaseClient: client,
    databasePath,
    processorLogger: silentLogger
  });

  assert.equal(summary.requested_count, 3);
  assert.equal(summary.ready_count, 2);
  assert.equal(summary.failed_count, 1);
  assert.equal(summary.skipped_count, 0);
  assert.equal(summary.chunk_count, 2);
  assert.deepEqual(
    await all(
      database,
      `SELECT status, attempts, last_error_code
       FROM rag_index_jobs ORDER BY id`
    ),
    [
      { status: 'READY', attempts: 1, last_error_code: null },
      { status: 'READY', attempts: 1, last_error_code: null },
      { status: 'FAILED', attempts: 1, last_error_code: 'RAG_INDEX_PERMANENT' }
    ]
  );
  assert.deepEqual(
    await get(
      database,
      `SELECT indexed_revision, lexical_status, embedding_status
       FROM rag_sources WHERE id = ?`,
      [validSource.sourceId]
    ),
    { indexed_revision: 1, lexical_status: 'READY', embedding_status: 'PENDING' }
  );
  assert.deepEqual(
    await get(
      database,
      `SELECT indexed_revision, lexical_status, embedding_status
       FROM rag_sources WHERE id = ?`,
      [flowSource.sourceId]
    ),
    { indexed_revision: 1, lexical_status: 'READY', embedding_status: 'DISABLED' }
  );
  assert.equal(
    (await get(
      database,
      `SELECT COUNT(*) AS count
       FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'pendaftaran'`
    )).count,
    1
  );
  assert.equal(
    (await get(
      database,
      `SELECT COUNT(*) AS count
       FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'dukungan'`
    )).count,
    1
  );
  assert.equal(
    (await get(
      database,
      `SELECT COUNT(*) AS count FROM rag_chunks
       WHERE chunk_text LIKE '%Dokumen kosong%' OR content_hash = 'empty-source-placeholder'`
    )).count,
    0
  );
});

test('RAG processor validates the batch contract before touching a database', async () => {
  await assert.rejects(
    processRagIndexJobs(null),
    (error) => error.code === 'RAG_INDEX_PROCESSOR_INVALID_INPUT'
  );
});
