import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  claimNextRagIndexJob,
  claimRagIndexJob,
  cleanupSupersededRagIndexJobs,
  completeRagIndexJob,
  publishRagLexicalIndexRevision,
  recoverExpiredRagIndexJobLeases
} from '../src/services/chatbot_ai_rag_index.service.js';
import {
  calculateRagIndexRetryDelayMs,
  classifyRagIndexJobError,
  RAG_INDEX_JOB_STATES,
  RAG_INDEX_SAFE_ERROR_CODES,
  recordRagIndexJobFailure
} from '../src/services/chatbot_ai_rag_job_state.service.js';

const silentLogger = { log() {} };

function openDatabase(path) {
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
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function createClient(db) {
  return {
    get: (sql, params) => get(db, sql, params),
    run: (sql, params) => run(db, sql, params),
    all: (sql, params) => all(db, sql, params)
  };
}

async function withFixture(options, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-crash-'));
  const databasePath = join(directory, 'crash_test.sqlite');

  try {
    const initDb = openDatabase(databasePath);
    await runMigrations(initDb, { logger: silentLogger });
    await run(
      initDb,
      `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
       VALUES (1, 'rag-crash-owner', 'hash-1', 'Owner One', 'admin', 1),
              (2, 'rag-crash-other', 'hash-2', 'Owner Two', 'user', 1)`
    );
    await run(
      initDb,
      `INSERT INTO sessions (session_id, status, user_id)
       VALUES ('crash-session', 'CONNECTED', 1)`
    );
    const source = await run(
      initDb,
      `INSERT INTO rag_sources (
         user_id, source_type, manual_session_id, content_hash,
         current_revision, indexed_revision, is_active
       ) VALUES (1, 'manual', 'crash-session', 'hash-v1', ?, ?, ?)`,
      [options.currentRevision ?? 1, options.indexedRevision ?? 0, options.active ?? 1]
    );
    const job = await run(
      initDb,
      `INSERT INTO rag_index_jobs (
         source_id, user_id, requested_revision, status, attempts,
         lease_owner, lease_expires_at, next_attempt_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        options.jobRevision ?? 1,
        options.jobStatus ?? 'PENDING',
        options.attempts ?? 0,
        options.leaseOwner ?? null,
        options.leaseExpiresAt ?? null,
        options.nextAttemptAt ?? null
      ]
    );
    await close(initDb);

    const testDb = openDatabase(databasePath);
    try {
      await callback({
        databasePath,
        db: testDb,
        client: createClient(testDb),
        sourceId: source.id,
        jobId: job.id
      });
    } finally {
      await close(testDb);
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

test('crash recovery: recovers crashed worker with expired lease to PENDING with exponential backoff delay', async () => {
  await withFixture({
    jobStatus: 'RUNNING',
    attempts: 1,
    leaseOwner: 'worker-crashed',
    leaseExpiresAt: '2026-09-11 12:00:00'
  }, async ({ db, client, jobId }) => {
    const recoveryResult = await recoverExpiredRagIndexJobLeases({
      now: new Date('2026-09-11T12:05:00.000Z'),
      maxAttempts: 3
    }, client);

    assert.equal(recoveryResult.recoveredCount, 1);
    assert.equal(recoveryResult.rescheduledCount, 1);
    assert.equal(recoveryResult.failedCount, 0);
    assert.equal(recoveryResult.supersededCount, 0);

    const job = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(job.status, RAG_INDEX_JOB_STATES.PENDING);
    assert.equal(job.attempts, 1);
    assert.equal(job.lease_owner, null);
    assert.equal(job.lease_expires_at, null);
    assert.equal(job.next_attempt_at, '2026-09-11 12:05:30');
    assert.equal(job.last_error_code, RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT);
  });
});

test('crash recovery: marks crashed job FAILED when attempts reach maxAttempts', async () => {
  await withFixture({
    jobStatus: 'RUNNING',
    attempts: 3,
    leaseOwner: 'worker-crashed-final',
    leaseExpiresAt: '2026-09-11 12:00:00'
  }, async ({ db, client, jobId }) => {
    const recoveryResult = await recoverExpiredRagIndexJobLeases({
      now: new Date('2026-09-11T12:05:00.000Z'),
      maxAttempts: 3
    }, client);

    assert.equal(recoveryResult.recoveredCount, 1);
    assert.equal(recoveryResult.rescheduledCount, 0);
    assert.equal(recoveryResult.failedCount, 1);
    assert.equal(recoveryResult.supersededCount, 0);

    const job = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(job.status, RAG_INDEX_JOB_STATES.FAILED);
    assert.equal(job.attempts, 3);
    assert.equal(job.lease_owner, null);
    assert.equal(job.lease_expires_at, null);
    assert.equal(job.next_attempt_at, null);
    assert.equal(job.last_error_code, RAG_INDEX_SAFE_ERROR_CODES.TIMEOUT);
  });
});

test('crash recovery: supersedes crashed job when source revision has advanced or source is inactive', async () => {
  await withFixture({
    currentRevision: 2,
    jobRevision: 1,
    jobStatus: 'RUNNING',
    attempts: 1,
    leaseOwner: 'worker-crashed-stale',
    leaseExpiresAt: '2026-09-11 12:00:00'
  }, async ({ db, client, jobId }) => {
    const recoveryResult = await recoverExpiredRagIndexJobLeases({
      now: new Date('2026-09-11T12:05:00.000Z'),
      maxAttempts: 3
    }, client);

    assert.equal(recoveryResult.recoveredCount, 1);
    assert.equal(recoveryResult.supersededCount, 1);
    assert.equal(recoveryResult.rescheduledCount, 0);
    assert.equal(recoveryResult.failedCount, 0);

    const job = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(job.status, RAG_INDEX_JOB_STATES.SUPERSEDED);
    assert.equal(job.lease_owner, null);
    assert.equal(job.lease_expires_at, null);
  });
});

test('claimRagIndexJob: atomic CAS successfully transitions PENDING to RUNNING with lease', async () => {
  await withFixture({
    jobStatus: 'PENDING',
    attempts: 0
  }, async ({ db, client, jobId }) => {
    const claimResult = await claimRagIndexJob({
      jobId,
      userId: 1,
      leaseOwner: 'worker-alpha',
      leaseDurationSeconds: 120,
      now: new Date('2026-09-11T12:00:00.000Z')
    }, client);

    assert.equal(claimResult.claimed, true);
    assert.equal(claimResult.job.status, RAG_INDEX_JOB_STATES.RUNNING);
    assert.equal(claimResult.job.attempts, 1);
    assert.equal(claimResult.job.lease_owner, 'worker-alpha');
    assert.equal(claimResult.job.lease_expires_at, '2026-09-11 12:02:00');

    const dbJob = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(dbJob.status, 'RUNNING');
    assert.equal(dbJob.attempts, 1);
    assert.equal(dbJob.lease_owner, 'worker-alpha');
  });
});

test('claimRagIndexJob: concurrent claim race allows exactly one winner', async () => {
  await withFixture({
    jobStatus: 'PENDING',
    attempts: 0
  }, async ({ db, client, jobId }) => {
    const [claimA, claimB] = await Promise.all([
      claimRagIndexJob({
        jobId,
        userId: 1,
        leaseOwner: 'worker-one',
        leaseDurationSeconds: 60,
        now: new Date('2026-09-11T12:00:00.000Z')
      }, client),
      claimRagIndexJob({
        jobId,
        userId: 1,
        leaseOwner: 'worker-two',
        leaseDurationSeconds: 60,
        now: new Date('2026-09-11T12:00:00.000Z')
      }, client)
    ]);

    const successCount = (claimA.claimed ? 1 : 0) + (claimB.claimed ? 1 : 0);
    assert.equal(successCount, 1);

    const loser = claimA.claimed ? claimB : claimA;
    assert.equal(loser.claimed, false);
    assert.ok(['not_pending', 'state_conflict'].includes(loser.reason));

    const dbJob = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(dbJob.status, 'RUNNING');
    assert.equal(dbJob.attempts, 1);
  });
});

test('claimRagIndexJob: marks job SUPERSEDED if source revision has already advanced or source is inactive', async () => {
  await withFixture({
    currentRevision: 2,
    jobRevision: 1,
    jobStatus: 'PENDING'
  }, async ({ db, client, jobId }) => {
    const claimResult = await claimRagIndexJob({
      jobId,
      userId: 1,
      leaseOwner: 'worker-x',
      now: new Date('2026-09-11T12:00:00.000Z')
    }, client);

    assert.equal(claimResult.claimed, false);
    assert.equal(claimResult.reason, 'superseded');
    assert.equal(claimResult.status, RAG_INDEX_JOB_STATES.SUPERSEDED);
    assert.equal(claimResult.staleReason, 'revision_stale');

    const dbJob = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(dbJob.status, 'SUPERSEDED');
  });
});

test('completeRagIndexJob: atomically transitions RUNNING to READY and clears lease', async () => {
  await withFixture({
    jobStatus: 'RUNNING',
    attempts: 1,
    leaseOwner: 'worker-complete',
    leaseExpiresAt: '2026-09-11 12:10:00'
  }, async ({ db, client, jobId }) => {
    const result = await completeRagIndexJob({
      jobId,
      userId: 1,
      leaseOwner: 'worker-complete',
      now: new Date('2026-09-11T12:01:00.000Z')
    }, client);

    assert.equal(result.id, jobId);
    assert.equal(result.status, RAG_INDEX_JOB_STATES.READY);

    const dbJob = await get(db, 'SELECT * FROM rag_index_jobs WHERE id = ?', [jobId]);
    assert.equal(dbJob.status, 'READY');
    assert.equal(dbJob.lease_owner, null);
    assert.equal(dbJob.lease_expires_at, null);
    assert.equal(dbJob.next_attempt_at, null);
    assert.equal(dbJob.last_error_code, null);
  });
});

test('completeRagIndexJob: rejects completion on lease mismatch, expired lease, or non-running state', async () => {
  await withFixture({
    jobStatus: 'RUNNING',
    attempts: 1,
    leaseOwner: 'worker-valid',
    leaseExpiresAt: '2026-09-11 12:00:00'
  }, async ({ db, client, jobId }) => {
    await assert.rejects(
      completeRagIndexJob({
        jobId,
        userId: 1,
        leaseOwner: 'worker-impostor',
        now: new Date('2026-09-11T11:59:00.000Z')
      }, client),
      (error) => error.code === 'RAG_INDEX_JOB_LEASE_MISMATCH'
    );

    await assert.rejects(
      completeRagIndexJob({
        jobId,
        userId: 1,
        leaseOwner: 'worker-valid',
        now: new Date('2026-09-11T12:05:00.000Z')
      }, client),
      (error) => error.code === 'RAG_INDEX_JOB_LEASE_EXPIRED'
    );

    await run(db, "UPDATE rag_index_jobs SET status = 'READY' WHERE id = ?", [jobId]);
    await assert.rejects(
      completeRagIndexJob({
        jobId,
        userId: 1,
        leaseOwner: 'worker-valid',
        now: new Date('2026-09-11T11:59:00.000Z')
      }, client),
      (error) => error.code === 'RAG_INDEX_JOB_NOT_RUNNING'
    );
  });
});

test('cleanupSupersededRagIndexJobs: marks older revisions SUPERSEDED while keeping current revision intact', async () => {
  await withFixture({
    currentRevision: 3,
    jobRevision: 3,
    jobStatus: 'PENDING'
  }, async ({ db, client, sourceId }) => {
    await run(
      db,
      `INSERT INTO rag_index_jobs (source_id, user_id, requested_revision, status, attempts)
       VALUES (?, 1, 1, 'PENDING', 0),
              (?, 1, 2, 'FAILED', 2)`,
      [sourceId, sourceId]
    );

    const cleanupResult = await cleanupSupersededRagIndexJobs({
      sourceId,
      userId: 1,
      currentRevision: 3,
      now: new Date('2026-09-11T12:00:00.000Z')
    }, client);

    assert.equal(cleanupResult.supersededCount, 2);

    const jobs = await all(
      db,
      'SELECT requested_revision, status FROM rag_index_jobs ORDER BY requested_revision'
    );
    assert.deepEqual(jobs, [
      { requested_revision: 1, status: 'SUPERSEDED' },
      { requested_revision: 2, status: 'SUPERSEDED' },
      { requested_revision: 3, status: 'PENDING' }
    ]);
  });
});

test('publishRagLexicalIndexRevision with finalizeJob: true atomically publishes and transitions job to READY', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wa-bot-rag-publish-fin-'));
  const databasePath = join(directory, 'publish_fin.sqlite');

  try {
    const initDb = openDatabase(databasePath);
    await runMigrations(initDb, { logger: silentLogger });
    await run(
      initDb,
      `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
       VALUES (1, 'rag-pub-owner', 'hash-1', 'Pub Owner', 'admin', 1)`
    );
    await run(
      initDb,
      `INSERT INTO sessions (session_id, status, user_id)
       VALUES ('pub-session', 'CONNECTED', 1)`
    );
    const source = await run(
      initDb,
      `INSERT INTO rag_sources (
         user_id, source_type, manual_session_id, content_hash,
         current_revision, indexed_revision, is_active
       ) VALUES (1, 'manual', 'pub-session', 'hash-v1', 1, 0, 1)`
    );
    const job = await run(
      initDb,
      `INSERT INTO rag_index_jobs (
         source_id, user_id, requested_revision, status, attempts,
         lease_owner, lease_expires_at
       ) VALUES (?, 1, 1, 'RUNNING', 1, 'worker-publisher', '2099-01-01 00:00:00')`,
      [source.id]
    );
    await close(initDb);

    const publishResult = await publishRagLexicalIndexRevision({
      jobId: job.id,
      userId: 1,
      leaseOwner: 'worker-publisher',
      chunks: [
        {
          chunkIndex: 0,
          text: 'Atomic publish with finalized job transition.',
          tokenCount: 8,
          contentHash: 'atomic-hash-01',
          metadata: { node_id: 'n-final' }
        }
      ],
      databasePath,
      finalizeJob: true
    });

    assert.equal(publishResult.executed, true);
    assert.equal(publishResult.status, 'READY');
    assert.equal(publishResult.result.job_status, 'READY');
    assert.equal(publishResult.result.lexical_status, 'READY');

    const verifyDb = openDatabase(databasePath);
    try {
      const dbJob = await get(verifyDb, 'SELECT * FROM rag_index_jobs WHERE id = ?', [job.id]);
      assert.equal(dbJob.status, 'READY');
      assert.equal(dbJob.lease_owner, null);
      assert.equal(dbJob.lease_expires_at, null);

      const dbSource = await get(verifyDb, 'SELECT * FROM rag_sources WHERE id = ?', [source.id]);
      assert.equal(dbSource.lexical_status, 'READY');
      assert.equal(dbSource.indexed_revision, 1);
    } finally {
      await close(verifyDb);
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
});
