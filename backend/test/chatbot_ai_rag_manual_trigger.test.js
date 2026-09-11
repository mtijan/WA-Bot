import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  syncManualKnowledgeSource,
  syncManualKnowledgeSourceSafely
} from '../src/services/chatbot_ai_rag_index.service.js';

const silentLogger = {
  debug() {},
  error() {},
  info() {},
  log() {}
};

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

function createDatabaseClient(db) {
  return {
    get: (sql, params) => get(db, sql, params),
    run: (sql, params) => run(db, sql, params),
    all: (sql, params) => all(db, sql, params)
  };
}

async function setupTestDb(t) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  await runMigrations(db, { logger: silentLogger, targetId: '026_rag_index_job_state_model' });
  await run(db, 'DELETE FROM users');
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'tenant-one', 'test-hash', 'Tenant One', 'admin', 1),
            (2, 'tenant-two', 'test-hash', 'Tenant Two', 'user', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('sess-user1-a', 'CONNECTED', 1),
            ('sess-user1-b', 'CONNECTED', 1),
            ('sess-user2-a', 'CONNECTED', 2)`
  );
  return { db, client: createDatabaseClient(db) };
}

test('syncManualKnowledgeSource validates required inputs and checks session existence', async (t) => {
  const { client } = await setupTestDb(t);

  await assert.rejects(
    syncManualKnowledgeSource({ userId: 0, sessionId: 'sess-user1-a', knowledgeBase: 'text' }, client),
    (err) => err.code === 'RAG_INDEX_INVALID_INPUT'
  );

  await assert.rejects(
    syncManualKnowledgeSource({ userId: 1, sessionId: '', knowledgeBase: 'text' }, client),
    (err) => err.code === 'RAG_INDEX_INVALID_INPUT'
  );

  await assert.rejects(
    syncManualKnowledgeSource({ userId: 1, sessionId: 'non-existent-session', knowledgeBase: 'text' }, client),
    (err) => err.code === 'RAG_SESSION_NOT_FOUND'
  );

  // User 1 cannot access User 2's session
  await assert.rejects(
    syncManualKnowledgeSource({ userId: 1, sessionId: 'sess-user2-a', knowledgeBase: 'text' }, client),
    (err) => err.code === 'RAG_SESSION_NOT_FOUND'
  );
});

test('syncManualKnowledgeSource creates rag_sources, session mapping, and enqueues revision 1 job', async (t) => {
  const { client, db } = await setupTestDb(t);

  const result = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Jam operasional kami adalah Senin-Jumat pukul 08:00 - 17:00 WIB.'
  }, client);

  assert.equal(result.action, 'created');
  assert.equal(result.revision, 1);
  assert.equal(result.isActive, true);
  assert.equal(result.enqueued, true);
  assert.ok(result.sourceId > 0);
  assert.equal(result.job.status, 'PENDING');
  assert.equal(result.job.requested_revision, 1);

  // Verify rag_sources row
  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [result.sourceId]);
  assert.ok(source);
  assert.equal(source.user_id, 1);
  assert.equal(source.source_type, 'manual');
  assert.equal(source.manual_session_id, 'sess-user1-a');
  assert.equal(source.current_revision, 1);
  assert.equal(source.indexed_revision, 0);
  assert.equal(source.lexical_status, 'PENDING');
  assert.equal(source.embedding_status, 'DISABLED');
  assert.equal(source.is_active, 1);
  assert.equal(source.content_hash.length, 64);

  // Verify rag_session_sources mapping
  const mapping = await get(
    db,
    'SELECT * FROM rag_session_sources WHERE session_id = ? AND source_id = ?',
    ['sess-user1-a', result.sourceId]
  );
  assert.ok(mapping);
  assert.equal(mapping.user_id, 1);

  // Verify rag_index_jobs row
  const job = await get(
    db,
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 1',
    [result.sourceId]
  );
  assert.ok(job);
  assert.equal(job.user_id, 1);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.attempts, 0);
});

test('syncManualKnowledgeSource advances revision and enqueues job when KB content changes', async (t) => {
  const { client, db } = await setupTestDb(t);

  const first = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Versi 1: Harga paket dasar Rp100.000.'
  }, client);
  assert.equal(first.revision, 1);
  assert.equal(first.action, 'created');

  const second = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Versi 2: Harga paket dasar naik menjadi Rp150.000.'
  }, client);
  assert.equal(second.action, 'updated');
  assert.equal(second.revision, 2);
  assert.equal(second.sourceId, first.sourceId);
  assert.equal(second.enqueued, true);
  assert.equal(second.job.requested_revision, 2);

  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [first.sourceId]);
  assert.equal(source.current_revision, 2);
  assert.equal(source.lexical_status, 'PENDING');

  const jobs = await all(
    db,
    'SELECT * FROM rag_index_jobs WHERE source_id = ? ORDER BY requested_revision ASC',
    [first.sourceId]
  );
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].requested_revision, 1);
  assert.equal(jobs[1].requested_revision, 2);
});

test('syncManualKnowledgeSource is idempotent and does not advance revision when KB is unchanged', async (t) => {
  const { client, db } = await setupTestDb(t);

  const text = 'Konten tetap sama tanpa perubahan.';
  const first = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: text
  }, client);
  assert.equal(first.revision, 1);

  const second = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: `  ${text}  \r\n` // Identical normalized content
  }, client);
  assert.equal(second.action, 'noop');
  assert.equal(second.revision, 1);
  assert.equal(second.enqueued, false);

  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [first.sourceId]);
  assert.equal(source.current_revision, 1);

  const jobs = await all(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [first.sourceId]);
  assert.equal(jobs.length, 1);
});

test('syncManualKnowledgeSource deactivates source and skips enqueue when KB is cleared', async (t) => {
  const { client, db } = await setupTestDb(t);

  const first = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Akan dihapus.'
  }, client);
  assert.equal(first.revision, 1);
  assert.equal(first.isActive, true);

  const cleared = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: '   '
  }, client);
  assert.equal(cleared.action, 'updated');
  assert.equal(cleared.revision, 2);
  assert.equal(cleared.isActive, false);
  assert.equal(cleared.enqueued, false);
  assert.equal(cleared.job, null);

  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [first.sourceId]);
  assert.equal(source.current_revision, 2);
  assert.equal(source.is_active, 0);

  // No job was added for revision 2
  const jobs = await all(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [first.sourceId]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].requested_revision, 1);
});

test('syncManualKnowledgeSource re-activates source and enqueues job when KB content is re-added', async (t) => {
  const { client, db } = await setupTestDb(t);

  await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Konten awal.'
  }, client);

  await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: ''
  }, client);

  const readded = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Konten baru setelah kosong.'
  }, client);
  assert.equal(readded.action, 'updated');
  assert.equal(readded.revision, 3);
  assert.equal(readded.isActive, true);
  assert.equal(readded.enqueued, true);
  assert.equal(readded.job.requested_revision, 3);

  const source = await get(db, 'SELECT * FROM rag_sources WHERE manual_session_id = ?', ['sess-user1-a']);
  assert.equal(source.current_revision, 3);
  assert.equal(source.is_active, 1);
});

test('syncManualKnowledgeSource maintains separate sources across sessions and tenants', async (t) => {
  const { client, db } = await setupTestDb(t);

  const s1 = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'KB User 1 Sesi A'
  }, client);

  const s2 = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-b',
    knowledgeBase: 'KB User 1 Sesi B'
  }, client);

  const s3 = await syncManualKnowledgeSource({
    userId: 2,
    sessionId: 'sess-user2-a',
    knowledgeBase: 'KB User 2 Sesi A'
  }, client);

  assert.notEqual(s1.sourceId, s2.sourceId);
  assert.notEqual(s1.sourceId, s3.sourceId);
  assert.notEqual(s2.sourceId, s3.sourceId);

  const sources = await all(db, 'SELECT id, user_id, manual_session_id FROM rag_sources ORDER BY id ASC');
  assert.equal(sources.length, 3);
  assert.equal(sources[0].manual_session_id, 'sess-user1-a');
  assert.equal(sources[1].manual_session_id, 'sess-user1-b');
  assert.equal(sources[2].manual_session_id, 'sess-user2-a');
});

test('syncManualKnowledgeSourceSafely returns null on failure without throwing', async () => {
  const brokenClient = {
    get: async () => { throw new Error('Database connection crashed'); },
    run: async () => { throw new Error('Database connection crashed'); }
  };

  const result = await syncManualKnowledgeSourceSafely({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'text'
  }, brokenClient);

  assert.equal(result, null);
});

test('saveAISettings endpoint automatically syncs manual KB and enqueues index job', async () => {
  const { getTestAgent } = await import('./helpers/test_app.js');
  const { dbRun, dbGet } = await import('../src/database.js');
  const agent = await getTestAgent();

  const testSessionId = 'rag-trigger-endpoint-sess';
  await dbRun(
    'INSERT OR REPLACE INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [testSessionId, 'CONNECTED', 1]
  );

  const res1 = await agent
    .post('/api/chatbot-ai/settings')
    .send({
      session_id: testSessionId,
      knowledge_base: 'Kebijakan pengembalian dana 14 hari kerja.'
    });
  assert.equal(res1.status, 200);

  const source1 = await dbGet(
    'SELECT * FROM rag_sources WHERE manual_session_id = ? AND user_id = 1',
    [testSessionId]
  );
  assert.ok(source1);
  assert.equal(source1.current_revision, 1);
  assert.equal(source1.is_active, 1);

  const job1 = await dbGet(
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 1',
    [source1.id]
  );
  assert.ok(job1);
  assert.equal(job1.status, 'PENDING');

  // Update with modified KB text
  const res2 = await agent
    .post('/api/chatbot-ai/settings')
    .send({
      session_id: testSessionId,
      knowledge_base: 'Kebijakan pengembalian dana 30 hari kerja.'
    });
  assert.equal(res2.status, 200);

  const source2 = await dbGet(
    'SELECT * FROM rag_sources WHERE id = ?',
    [source1.id]
  );
  assert.equal(source2.current_revision, 2);

  const job2 = await dbGet(
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 2',
    [source1.id]
  );
  assert.ok(job2);
  assert.equal(job2.status, 'PENDING');
});

