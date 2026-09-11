import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  calculateRagIndexRetryDelayMs,
  classifyRagIndexJobError,
  RAG_INDEX_SAFE_ERROR_CODES,
  recordRagIndexJobFailure
} from '../src/services/chatbot_ai_rag_job_state.service.js';

const silentLogger = { log() {} };

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
    db.close((error) => error ? reject(error) : resolve());
  });
}

function createClient(db) {
  return {
    get: (sql, params) => get(db, sql, params),
    run: (sql, params) => run(db, sql, params)
  };
}

async function seedRunningJob(db, { attempts = 1, userId = 1 } = {}) {
  await runMigrations(db, { logger: silentLogger });
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'rag-retry-owner', 'test-hash', 'RAG Retry Owner', 'admin', 1),
            (2, 'rag-other-owner', 'test-hash', 'RAG Other Owner', 'user', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('rag-retry-session', 'CONNECTED', ?)` ,
    [userId]
  );
  const source = await run(
    db,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, is_active
     ) VALUES (?, 'manual', 'rag-retry-session', 'retry-hash', 1, 0, 1)`,
    [userId]
  );
  const job = await run(
    db,
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, status, attempts,
       lease_owner, lease_expires_at
     ) VALUES (?, ?, 1, 'RUNNING', ?, 'worker-secret-name', '2026-09-11 12:05:00')`,
    [source.id, userId, attempts]
  );
  return job.id;
}

test('RAG retry classification returns only closed safe codes', () => {
  assert.deepEqual(
    classifyRagIndexJobError({ status: 429, message: 'secret-token-value' }),
    { code: RAG_INDEX_SAFE_ERROR_CODES.RATE_LIMITED, retryable: true }
  );
  assert.deepEqual(
    classifyRagIndexJobError({ code: 'ETIMEDOUT', stack: 'https://user:pass@example.test' }),
    { code: RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT, retryable: true }
  );
  assert.deepEqual(
    classifyRagIndexJobError({ status: 401, code: 'raw-sensitive-code' }),
    { code: RAG_INDEX_SAFE_ERROR_CODES.PERMANENT, retryable: false }
  );
  assert.deepEqual(
    classifyRagIndexJobError({ code: 'raw-sensitive-code', message: 'private response body' }),
    { code: RAG_INDEX_SAFE_ERROR_CODES.UNKNOWN, retryable: true }
  );
});

test('RAG retry delay is exponential and capped', () => {
  assert.equal(calculateRagIndexRetryDelayMs(1), 30_000);
  assert.equal(calculateRagIndexRetryDelayMs(2), 60_000);
  assert.equal(calculateRagIndexRetryDelayMs(10), 15 * 60_000);
  assert.throws(
    () => calculateRagIndexRetryDelayMs(1, { baseDelayMs: 1_000, maxDelayMs: 15 * 60_000 + 1 }),
    (error) => error.code === 'RAG_INDEX_JOB_INVALID_INPUT'
  );
  assert.throws(
    () => calculateRagIndexRetryDelayMs(1, { baseDelayMs: 2_000, maxDelayMs: 1_000 }),
    (error) => error.code === 'RAG_INDEX_JOB_INVALID_INPUT'
  );
});

test('transient RAG failure schedules a bounded retry and releases the lease', async (t) => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  const jobId = await seedRunningJob(db, { attempts: 1 });
  const result = await recordRagIndexJobFailure({
    jobId,
    userId: 1,
    error: { status: 503, message: 'provider body with raw-sensitive-marker' },
    now: new Date('2026-09-11T12:00:00.000Z')
  }, createClient(db));

  assert.deepEqual(result, {
    id: jobId,
    user_id: 1,
    status: 'PENDING',
    attempts: 1,
    next_attempt_at: '2026-09-11 12:00:30',
    last_error_code: 'RAG_INDEX_PROVIDER_UNAVAILABLE',
    retry_scheduled: true
  });
  assert.deepEqual(
    await get(
      db,
      `SELECT status, attempts, lease_owner, lease_expires_at,
              next_attempt_at, last_error_code
       FROM rag_index_jobs WHERE id = ?`,
      [jobId]
    ),
    {
      status: 'PENDING',
      attempts: 1,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: '2026-09-11 12:00:30',
      last_error_code: 'RAG_INDEX_PROVIDER_UNAVAILABLE'
    }
  );
});

test('RAG retry stops at the attempt ceiling and stores no secret-bearing text', async (t) => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  const jobId = await seedRunningJob(db, { attempts: 3 });
  await recordRagIndexJobFailure({
    jobId,
    userId: 1,
    error: {
      code: 'raw-sensitive-code-DO-NOT-STORE',
      message: 'Bearer private-secret and provider response body',
      stack: 'https://admin:password@example.test/private'
    },
    now: new Date('2026-09-11T12:00:00.000Z')
  }, createClient(db));

  const job = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
  assert.equal(job.status, 'FAILED');
  assert.equal(job.next_attempt_at, null);
  assert.equal(job.last_error_code, 'RAG_INDEX_UNKNOWN');
  const serialized = JSON.stringify(job);
  assert.doesNotMatch(serialized, /raw-sensitive|Bearer|private-secret|password|provider response/i);
});

test('permanent RAG failure fails immediately before the retry ceiling', async (t) => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  const jobId = await seedRunningJob(db, { attempts: 1 });
  const result = await recordRagIndexJobFailure({
    jobId,
    userId: 1,
    error: { status: 400, message: 'invalid embedding request with private content' },
    now: new Date('2026-09-11T12:00:00.000Z')
  }, createClient(db));

  assert.equal(result.status, 'FAILED');
  assert.equal(result.retry_scheduled, false);
  assert.equal(result.last_error_code, 'RAG_INDEX_PERMANENT');
});

test('RAG failure recording rejects cross-tenant and non-running updates', async (t) => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => close(db));
  const jobId = await seedRunningJob(db, { attempts: 1 });
  const client = createClient(db);

  await assert.rejects(
    recordRagIndexJobFailure({ jobId, userId: 2, error: new Error('hidden') }, client),
    (error) => error.code === 'RAG_INDEX_JOB_NOT_FOUND'
  );
  await run(db, "UPDATE rag_index_jobs SET status = 'READY' WHERE id = ?", [jobId]);
  await assert.rejects(
    recordRagIndexJobFailure({ jobId, userId: 1, error: new Error('hidden') }, client),
    (error) => error.code === 'RAG_INDEX_JOB_INVALID_TRANSITION'
  );
});

test('RAG failure recording detects a concurrent state change', async () => {
  const client = {
    async get() {
      return { id: 9, user_id: 1, status: 'RUNNING', attempts: 1 };
    },
    async run() {
      return { changes: 0 };
    }
  };

  await assert.rejects(
    recordRagIndexJobFailure({ jobId: 9, userId: 1, error: { status: 503 } }, client),
    (error) => error.code === 'RAG_INDEX_JOB_STATE_CONFLICT'
  );
  await assert.rejects(
    recordRagIndexJobFailure({
      jobId: 9,
      userId: 1,
      error: { status: 503 },
      maxAttempts: 4
    }, client),
    (error) => error.code === 'RAG_INDEX_JOB_INVALID_INPUT'
  );
});
