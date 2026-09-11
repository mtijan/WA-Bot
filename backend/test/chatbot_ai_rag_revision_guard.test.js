import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import { runCurrentRagIndexRevisionTransaction } from '../src/services/chatbot_ai_rag_index.service.js';

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

async function createFixture(t, {
  currentRevision = 1,
  indexedRevision = 0,
  active = 1,
  jobRevision = 1,
  leaseExpiresAt = '2099-01-01 00:00:00'
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-revision-'));
  const databasePath = join(directory, 'revision.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = openDatabase(databasePath);
  await runMigrations(database, { logger: silentLogger });
  await run(
    database,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'revision-owner', 'test-hash', 'Revision Owner', 'admin', 1),
            (2, 'revision-other', 'test-hash', 'Revision Other', 'user', 1)`
  );
  await run(
    database,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('revision-session', 'CONNECTED', 1)`
  );
  const source = await run(
    database,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, is_active
     ) VALUES (1, 'manual', 'revision-session', 'revision-hash', ?, ?, ?)`,
    [currentRevision, indexedRevision, active]
  );
  const job = await run(
    database,
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, status, attempts,
       lease_owner, lease_expires_at
     ) VALUES (?, 1, ?, 'RUNNING', 1, 'worker-a', ?)`,
    [source.id, jobRevision, leaseExpiresAt]
  );
  await close(database);
  return { databasePath, jobId: job.id, sourceId: source.id };
}

test('current RAG revision executes database publication inside the guard transaction', async (t) => {
  const fixture = await createFixture(t);
  const result = await runCurrentRagIndexRevisionTransaction({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-a',
    databasePath: fixture.databasePath
  }, async (client, context) => {
    assert.equal(context.requestedRevision, 1);
    await client.run(
      `INSERT INTO rag_chunks (
         source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash
       ) VALUES (?, ?, ?, 0, 'guarded revision one', 3, 'guarded-r1-hash')`,
      [context.sourceId, context.userId, context.requestedRevision]
    );
    return { inserted: true };
  });

  assert.deepEqual(result, {
    executed: true,
    job_id: fixture.jobId,
    status: 'RUNNING',
    result: { inserted: true }
  });
  const database = openDatabase(fixture.databasePath);
  assert.equal((await get(database, 'SELECT COUNT(*) AS count FROM rag_chunks')).count, 1);
  await close(database);
});

test('stale RAG revision is superseded before publication and newer chunks remain intact', async (t) => {
  const fixture = await createFixture(t, {
    currentRevision: 2,
    indexedRevision: 2,
    jobRevision: 1
  });
  const database = openDatabase(fixture.databasePath);
  await run(
    database,
    `INSERT INTO rag_chunks (
       source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash
     ) VALUES (?, 1, 2, 0, 'newer revision must remain', 4, 'newer-r2-hash')`,
    [fixture.sourceId]
  );
  await close(database);
  let callbackCalls = 0;

  const result = await runCurrentRagIndexRevisionTransaction({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-a',
    databasePath: fixture.databasePath
  }, async () => {
    callbackCalls += 1;
  });

  assert.deepEqual(result, {
    executed: false,
    job_id: fixture.jobId,
    status: 'SUPERSEDED',
    reason: 'revision_stale'
  });
  assert.equal(callbackCalls, 0);
  const verification = openDatabase(fixture.databasePath);
  assert.deepEqual(
    await all(verification, 'SELECT source_revision, chunk_text FROM rag_chunks'),
    [{ source_revision: 2, chunk_text: 'newer revision must remain' }]
  );
  assert.deepEqual(
    await get(
      verification,
      `SELECT status, lease_owner, lease_expires_at, next_attempt_at, last_error_code
       FROM rag_index_jobs WHERE id = ?`,
      [fixture.jobId]
    ),
    {
      status: 'SUPERSEDED',
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error_code: null
    }
  );
  await close(verification);
});

test('inactive RAG source is superseded without invoking publication', async (t) => {
  const fixture = await createFixture(t, { active: 0 });
  let callbackCalls = 0;
  const result = await runCurrentRagIndexRevisionTransaction({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-a',
    databasePath: fixture.databasePath
  }, async () => {
    callbackCalls += 1;
  });

  assert.equal(result.executed, false);
  assert.equal(result.reason, 'source_inactive');
  assert.equal(callbackCalls, 0);
});

test('RAG revision guard rejects cross-tenant, lease mismatch, and expired lease', async (t) => {
  const fixture = await createFixture(t, { leaseExpiresAt: '2020-01-01 00:00:00' });
  const callback = async () => {};
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-a',
      databasePath: fixture.databasePath
    }),
    (error) => error.code === 'RAG_INDEX_PUBLISH_CALLBACK_REQUIRED'
  );
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 2,
      leaseOwner: 'worker-a',
      databasePath: fixture.databasePath
    }, callback),
    (error) => error.code === 'RAG_INDEX_JOB_NOT_FOUND'
  );
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-b',
      databasePath: fixture.databasePath
    }, callback),
    (error) => error.code === 'RAG_INDEX_JOB_LEASE_MISMATCH'
  );
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-a',
      databasePath: fixture.databasePath
    }, callback),
    (error) => error.code === 'RAG_INDEX_JOB_LEASE_EXPIRED'
  );

  const database = openDatabase(fixture.databasePath);
  await run(
    database,
    `UPDATE rag_index_jobs
     SET status = 'PENDING', lease_expires_at = '2099-01-01 00:00:00'
     WHERE id = ?`,
    [fixture.jobId]
  );
  await close(database);
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-a',
      databasePath: fixture.databasePath
    }, callback),
    (error) => error.code === 'RAG_INDEX_JOB_NOT_RUNNING'
  );
});

test('revision mutation inside publication rolls back every write', async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    runCurrentRagIndexRevisionTransaction({
      jobId: fixture.jobId,
      userId: 1,
      leaseOwner: 'worker-a',
      databasePath: fixture.databasePath
    }, async (client, context) => {
      await client.run(
        `INSERT INTO rag_chunks (
           source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash
         ) VALUES (?, 1, 1, 0, 'must roll back', 3, 'rollback-r1-hash')`,
        [context.sourceId]
      );
      await client.run(
        `UPDATE rag_sources SET current_revision = 2 WHERE id = ? AND user_id = 1`,
        [context.sourceId]
      );
    }),
    (error) => error.code === 'RAG_INDEX_REVISION_CHANGED'
  );

  const database = openDatabase(fixture.databasePath);
  assert.equal((await get(database, 'SELECT COUNT(*) AS count FROM rag_chunks')).count, 0);
  assert.equal(
    (await get(database, 'SELECT current_revision FROM rag_sources WHERE id = ?', [fixture.sourceId])).current_revision,
    1
  );
  await close(database);
});

test('committed concurrent source update wins before stale publication begins', async (t) => {
  const fixture = await createFixture(t);
  const sourceWriter = openDatabase(fixture.databasePath);
  await run(sourceWriter, 'PRAGMA busy_timeout = 5000');
  await run(sourceWriter, 'BEGIN IMMEDIATE');
  await run(
    sourceWriter,
    `UPDATE rag_sources SET current_revision = 2, content_hash = 'revision-hash-v2'
     WHERE id = ? AND user_id = 1`,
    [fixture.sourceId]
  );
  let callbackCalls = 0;
  const guardedPublish = runCurrentRagIndexRevisionTransaction({
    jobId: fixture.jobId,
    userId: 1,
    leaseOwner: 'worker-a',
    databasePath: fixture.databasePath
  }, async () => {
    callbackCalls += 1;
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  await run(sourceWriter, 'COMMIT');
  await close(sourceWriter);
  const result = await guardedPublish;

  assert.equal(result.executed, false);
  assert.equal(result.reason, 'revision_stale');
  assert.equal(callbackCalls, 0);
});
