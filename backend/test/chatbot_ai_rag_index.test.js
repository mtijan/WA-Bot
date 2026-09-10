import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import { enqueueRagIndexJob } from '../src/services/chatbot_ai_rag_index.service.js';

const silentLogger = { log() {} };

function openDatabase(path = ':memory:') {
  return new sqlite3.Database(path);
}

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

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createClient(db) {
  return {
    get: (sql, params) => get(db, sql, params),
    run: (sql, params) => run(db, sql, params)
  };
}

async function seedSource(db, { userId = 1, revision = 1, active = 1 } = {}) {
  await runMigrations(db, { logger: silentLogger, targetId: '025_chatbot_ai_rag_index' });
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'rag-owner', 'test-hash', 'RAG Owner', 'admin', 1),
            (2, 'other-owner', 'test-hash', 'Other Owner', 'user', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('rag-session', 'CONNECTED', 1),
            ('other-session', 'CONNECTED', 2)`
  );
  const result = await run(
    db,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, is_active
     ) VALUES (?, 'manual', ?, 'source-hash-v1', ?, 0, ?)`,
    [userId, userId === 1 ? 'rag-session' : 'other-session', revision, active]
  );
  return result.id;
}

test('RAG index enqueue is idempotent for one source revision and config', async (t) => {
  const db = openDatabase();
  t.after(() => close(db));
  const sourceId = await seedSource(db);
  const input = {
    sourceId,
    userId: 1,
    requestedRevision: 1,
    embeddingConfigHash: 'profile-hash-v1'
  };

  const first = await enqueueRagIndexJob(input, createClient(db));
  const repeated = await enqueueRagIndexJob(input, createClient(db));

  assert.equal(first.idempotent, false);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.status, 'PENDING');
  assert.equal(
    (await get(db, 'SELECT COUNT(*) AS count FROM rag_index_jobs WHERE source_id = ?', [sourceId])).count,
    1
  );
});

test('RAG index enqueue remains single under concurrent duplicate requests', async (t) => {
  const db = openDatabase();
  t.after(() => close(db));
  const sourceId = await seedSource(db);
  const input = { sourceId, userId: 1, requestedRevision: 1, embeddingConfigHash: '' };

  const results = await Promise.all([
    enqueueRagIndexJob(input, createClient(db)),
    enqueueRagIndexJob(input, createClient(db)),
    enqueueRagIndexJob(input, createClient(db))
  ]);

  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(results.filter((result) => result.idempotent === false).length, 1);
  assert.equal(results.filter((result) => result.idempotent === true).length, 2);
});

test('RAG index enqueue rejects stale, inactive, and cross-tenant sources', async (t) => {
  const db = openDatabase();
  t.after(() => close(db));
  const sourceId = await seedSource(db, { revision: 2 });

  await assert.rejects(
    enqueueRagIndexJob({ sourceId, userId: 1, requestedRevision: 1 }, createClient(db)),
    (error) => error.code === 'RAG_INDEX_REVISION_STALE'
  );
  await enqueueRagIndexJob({ sourceId, userId: 1, requestedRevision: 2 }, createClient(db));
  await assert.rejects(
    enqueueRagIndexJob({ sourceId, userId: 2, requestedRevision: 2 }, createClient(db)),
    (error) => error.code === 'RAG_SOURCE_NOT_FOUND'
  );
  await run(db, 'UPDATE rag_sources SET is_active = 0 WHERE id = ?', [sourceId]);
  await assert.rejects(
    enqueueRagIndexJob({ sourceId, userId: 1, requestedRevision: 2 }, createClient(db)),
    (error) => error.code === 'RAG_SOURCE_INACTIVE'
  );
  assert.equal((await get(db, 'SELECT COUNT(*) AS count FROM rag_index_jobs')).count, 1);
});

test('RAG index enqueue creates distinct jobs for a new revision or embedding config', async (t) => {
  const db = openDatabase();
  t.after(() => close(db));
  const sourceId = await seedSource(db);
  const client = createClient(db);

  const revisionOne = await enqueueRagIndexJob({
    sourceId,
    userId: 1,
    requestedRevision: 1,
    embeddingConfigHash: 'profile-a'
  }, client);
  const alternateConfig = await enqueueRagIndexJob({
    sourceId,
    userId: 1,
    requestedRevision: 1,
    embeddingConfigHash: 'profile-b'
  }, client);
  await run(
    db,
    `UPDATE rag_sources
     SET current_revision = 2, content_hash = 'source-hash-v2', lexical_status = 'PENDING'
     WHERE id = ?`,
    [sourceId]
  );
  const revisionTwo = await enqueueRagIndexJob({
    sourceId,
    userId: 1,
    requestedRevision: 2,
    embeddingConfigHash: 'profile-b'
  }, client);

  assert.equal(new Set([revisionOne.id, alternateConfig.id, revisionTwo.id]).size, 3);
  assert.equal((await get(db, 'SELECT COUNT(*) AS count FROM rag_index_jobs')).count, 3);
});

test('RAG index job survives database close and reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-index-'));
  const databasePath = join(directory, 'durable.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));

  let db = openDatabase(databasePath);
  const sourceId = await seedSource(db);
  const enqueued = await enqueueRagIndexJob({
    sourceId,
    userId: 1,
    requestedRevision: 1,
    embeddingConfigHash: 'durable-profile'
  }, createClient(db));
  await close(db);

  db = openDatabase(databasePath);
  const persisted = await get(
    db,
    `SELECT id, source_id, requested_revision, embedding_config_hash, status
     FROM rag_index_jobs WHERE id = ?`,
    [enqueued.id]
  );
  await close(db);

  assert.deepEqual(persisted, {
    id: enqueued.id,
    source_id: sourceId,
    requested_revision: 1,
    embedding_config_hash: 'durable-profile',
    status: 'PENDING'
  });
});
