import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { listMigrations, runMigrations } from '../src/migrations/index.js';
import {
  assertRagIndexJobTransition,
  canTransitionRagIndexJobState,
  isRagIndexJobState,
  RAG_EMBEDDING_STATES,
  RAG_INDEX_JOB_STATES,
  RAG_LEXICAL_STATES
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
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

async function createSchema025Fixture() {
  const db = new sqlite3.Database(':memory:');
  await runMigrations(db, { logger: silentLogger, targetId: '025_chatbot_ai_rag_index' });
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'rag-state-owner', 'test-hash', 'RAG State Owner', 'admin', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('rag-state-session', 'CONNECTED', 1)`
  );
  const source = await run(
    db,
    `INSERT INTO rag_sources (
       user_id, source_type, manual_session_id, content_hash,
       current_revision, indexed_revision, lexical_status, embedding_status
     ) VALUES (1, 'manual', 'rag-state-session', 'state-source-v1', 1, 1, 'READY', 'FAILED')`
  );
  return { db, sourceId: source.id };
}

test('migration registry reserves 026 for the RAG job state model', () => {
  const migrations = listMigrations();
  assert.equal(migrations.length, 28);
  assert.equal(migrations[25].id, '026_rag_index_job_state_model');
  assert.equal(migrations[26].id, '027_expand_rag_input_budget_limit');
  assert.equal(migrations.at(-1).id, '028_expand_rag_context_and_output_limits');
});

test('migration 026 maps legacy job states without changing source readiness', async (t) => {
  const { db, sourceId } = await createSchema025Fixture();
  t.after(() => close(db));
  const legacyStates = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
  for (const [index, status] of legacyStates.entries()) {
    await run(
      db,
      `INSERT INTO rag_index_jobs (
         source_id, user_id, requested_revision, embedding_config_hash, status,
         attempts, lease_owner, last_error_code
       ) VALUES (?, 1, 1, ?, ?, ?, ?, ?)`,
      [sourceId, `profile-${index}`, status, index, `worker-${index}`, `ERR_${index}`]
    );
  }

  const result = await runMigrations(db, {
    logger: silentLogger,
    targetId: '026_rag_index_job_state_model'
  });
  assert.equal(result.applied, 1);
  assert.equal(result.total, 28);

  const jobs = await all(
    db,
    `SELECT status, attempts, lease_owner, last_error_code
     FROM rag_index_jobs ORDER BY id`
  );
  assert.deepEqual(jobs, [
    { status: 'PENDING', attempts: 0, lease_owner: 'worker-0', last_error_code: 'ERR_0' },
    { status: 'RUNNING', attempts: 1, lease_owner: 'worker-1', last_error_code: 'ERR_1' },
    { status: 'READY', attempts: 2, lease_owner: 'worker-2', last_error_code: 'ERR_2' },
    { status: 'FAILED', attempts: 3, lease_owner: 'worker-3', last_error_code: 'ERR_3' },
    { status: 'SUPERSEDED', attempts: 4, lease_owner: 'worker-4', last_error_code: 'ERR_4' }
  ]);
  assert.deepEqual(
    await get(db, 'SELECT lexical_status, embedding_status FROM rag_sources WHERE id = ?', [sourceId]),
    { lexical_status: 'READY', embedding_status: 'FAILED' }
  );
  assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
});

test('migration 026 enforces only the explicit job states and preserves cascade/indexes', async (t) => {
  const { db, sourceId } = await createSchema025Fixture();
  t.after(() => close(db));
  await runMigrations(db, { logger: silentLogger, targetId: '026_rag_index_job_state_model' });

  for (const [index, status] of Object.values(RAG_INDEX_JOB_STATES).entries()) {
    await run(
      db,
      `INSERT INTO rag_index_jobs (
         source_id, user_id, requested_revision, embedding_config_hash, status
       ) VALUES (?, 1, 1, ?, ?)`,
      [sourceId, `new-${index}`, status]
    );
  }
  for (const legacyState of ['PROCESSING', 'SUCCEEDED', 'CANCELLED']) {
    await assert.rejects(
      run(
        db,
        `INSERT INTO rag_index_jobs (
           source_id, user_id, requested_revision, embedding_config_hash, status
         ) VALUES (?, 1, 1, ?, ?)`,
        [sourceId, `legacy-${legacyState}`, legacyState]
      ),
      /CHECK constraint failed/
    );
  }

  const indexes = await all(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND name LIKE 'idx_rag_index_jobs_%'
     ORDER BY name`
  );
  assert.deepEqual(indexes, [
    { name: 'idx_rag_index_jobs_status_schedule' },
    { name: 'idx_rag_index_jobs_user_source' }
  ]);
  await run(db, 'DELETE FROM rag_sources WHERE id = ?', [sourceId]);
  assert.equal((await get(db, 'SELECT COUNT(*) AS count FROM rag_index_jobs')).count, 0);

  const repeated = await runMigrations(db, {
    logger: silentLogger,
    targetId: '026_rag_index_job_state_model'
  });
  assert.equal(repeated.applied, 0);
});

test('job state constants remain separate from lexical and embedding readiness states', () => {
  assert.deepEqual(Object.values(RAG_INDEX_JOB_STATES), [
    'PENDING', 'RUNNING', 'READY', 'FAILED', 'SUPERSEDED'
  ]);
  assert.equal(isRagIndexJobState(RAG_LEXICAL_STATES.STALE), false);
  assert.equal(isRagIndexJobState(RAG_EMBEDDING_STATES.DISABLED), false);
  assert.equal(isRagIndexJobState(RAG_INDEX_JOB_STATES.RUNNING), true);
});

test('job state transition contract permits only the planned lifecycle edges', () => {
  assert.equal(canTransitionRagIndexJobState('PENDING', 'RUNNING'), true);
  assert.equal(canTransitionRagIndexJobState('RUNNING', 'READY'), true);
  assert.equal(canTransitionRagIndexJobState('RUNNING', 'FAILED'), true);
  assert.equal(canTransitionRagIndexJobState('RUNNING', 'SUPERSEDED'), true);
  assert.equal(canTransitionRagIndexJobState('FAILED', 'PENDING'), true);
  assert.equal(canTransitionRagIndexJobState('READY', 'RUNNING'), false);
  assert.equal(canTransitionRagIndexJobState('PENDING', 'READY'), false);
  assert.throws(
    () => assertRagIndexJobTransition('PENDING', 'READY'),
    (error) => error.code === 'RAG_INDEX_JOB_INVALID_TRANSITION'
  );
});
