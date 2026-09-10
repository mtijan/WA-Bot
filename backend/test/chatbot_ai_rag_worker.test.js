import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  isRagIndexPollingRole,
  listDueRagIndexJobs,
  RagIndexPollingWorker
} from '../src/services/chatbot_ai_rag_worker.service.js';

const silentLogger = {
  debug() {},
  error() {},
  info() {}
};

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
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

test('RAG polling is gated to all/worker roles and remains disabled by default', () => {
  assert.equal(isRagIndexPollingRole('all', true), true);
  assert.equal(isRagIndexPollingRole('worker', true), true);
  assert.equal(isRagIndexPollingRole('WORKER', true), true);
  assert.equal(isRagIndexPollingRole('api', true), false);
  assert.equal(isRagIndexPollingRole('sessions', true), false);
  assert.equal(isRagIndexPollingRole('worker', false), false);
});

test('RAG worker lists only due current active jobs with a bounded batch', async () => {
  let capturedSql = '';
  let capturedParams = [];
  const rows = [{
    id: 7,
    source_id: 3,
    user_id: 2,
    requested_revision: 4,
    embedding_config_hash: 'profile-v1',
    status: 'PENDING',
    attempts: 0,
    next_attempt_at: null,
    created_at: '2026-09-11 01:00:00',
    updated_at: '2026-09-11 01:00:00',
    private_field: 'must-not-leak'
  }];
  const client = {
    async all(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return rows;
    }
  };

  const jobs = await listDueRagIndexJobs({ limit: 5 }, client);

  assert.match(capturedSql, /jobs\.status = 'PENDING'/);
  assert.match(capturedSql, /next_attempt_at <= CURRENT_TIMESTAMP/);
  assert.match(capturedSql, /sources\.is_active = 1/);
  assert.match(capturedSql, /sources\.current_revision = jobs\.requested_revision/);
  assert.deepEqual(capturedParams, [5]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].private_field, undefined);
});

test('RAG worker validates database clients and batch limits', async () => {
  await assert.rejects(
    listDueRagIndexJobs({ limit: 0 }, { all: async () => [] }),
    (error) => error.code === 'RAG_INDEX_WORKER_INVALID_INPUT'
  );
  await assert.rejects(
    listDueRagIndexJobs({ limit: 1 }, {}),
    (error) => error.code === 'RAG_INDEX_DATABASE_CLIENT_REQUIRED'
  );
});

test('RAG worker SQL returns only due jobs for active current sources', async (t) => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  await runMigrations(db, { logger: { log() {} }, targetId: '025_chatbot_ai_rag_index' });
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'rag-worker-owner', 'test-hash', 'RAG Worker Owner', 'admin', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('rag-worker-due', 'CONNECTED', 1),
            ('rag-worker-future', 'CONNECTED', 1),
            ('rag-worker-stale', 'CONNECTED', 1),
            ('rag-worker-inactive', 'CONNECTED', 1)`
  );

  const sourceIds = [];
  for (const [sessionId, hash, revision, active] of [
    ['rag-worker-due', 'due', 1, 1],
    ['rag-worker-future', 'future', 1, 1],
    ['rag-worker-stale', 'stale', 2, 1],
    ['rag-worker-inactive', 'inactive', 1, 0]
  ]) {
    const inserted = await run(
      db,
      `INSERT INTO rag_sources (
         user_id, source_type, manual_session_id, content_hash,
         current_revision, indexed_revision, is_active
       ) VALUES (1, 'manual', ?, ?, ?, 0, ?)`,
      [sessionId, hash, revision, active]
    );
    sourceIds.push(inserted.id);
  }

  await run(
    db,
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, embedding_config_hash, next_attempt_at
     ) VALUES
       (?, 1, 1, '', NULL),
       (?, 1, 1, '', DATETIME('now', '+1 day')),
       (?, 1, 1, '', NULL),
       (?, 1, 1, '', NULL)`,
    sourceIds
  );

  const jobs = await listDueRagIndexJobs(
    { limit: 10 },
    { all: (sql, params) => all(db, sql, params) }
  );
  assert.deepEqual(jobs.map((job) => job.source_id), [sourceIds[0]]);
});

test('RAG polling starts once, polls immediately, and schedules an unref timer', async () => {
  let polls = 0;
  let scheduledInterval = null;
  let unrefCalls = 0;
  const timer = { unref() { unrefCalls += 1; } };
  const worker = new RagIndexPollingWorker({
    pollJobs: async () => {
      polls += 1;
      return [];
    },
    intervalMs: 250,
    setIntervalFn(callback, intervalMs) {
      scheduledInterval = { callback, intervalMs };
      return timer;
    },
    clearIntervalFn() {},
    workerLogger: silentLogger
  });

  assert.equal(await worker.startPollingWorker(), true);
  assert.equal(await worker.startPollingWorker(), false);
  assert.equal(polls, 1);
  assert.equal(scheduledInterval.intervalMs, 250);
  assert.equal(unrefCalls, 1);
});

test('RAG polling never overlaps an in-flight cycle', async () => {
  let releasePoll;
  const blocked = new Promise((resolve) => { releasePoll = resolve; });
  let polls = 0;
  const worker = new RagIndexPollingWorker({
    pollJobs: async () => {
      polls += 1;
      await blocked;
      return [];
    },
    workerLogger: silentLogger
  });

  const first = worker.pollOnce();
  const overlapping = await worker.pollOnce();
  assert.deepEqual(overlapping, { skipped: true, reason: 'poll_in_flight', jobs: [] });
  assert.equal(polls, 1);
  releasePoll();
  await first;
});

test('RAG polling hands due jobs to the handler and stops cleanly', async () => {
  let scheduledCallback;
  let clearedTimer = null;
  const handledIds = [];
  const timer = { unref() {} };
  const worker = new RagIndexPollingWorker({
    pollJobs: async () => [{ id: 11 }],
    handleJobs: async (jobs) => handledIds.push(...jobs.map((job) => job.id)),
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return timer;
    },
    clearIntervalFn(value) { clearedTimer = value; },
    workerLogger: silentLogger
  });

  await worker.startPollingWorker();
  await scheduledCallback();
  assert.deepEqual(handledIds, [11, 11]);
  assert.equal(await worker.stopPollingWorker(), true);
  assert.equal(clearedTimer, timer);
  assert.equal(await worker.stopPollingWorker(), false);
});
