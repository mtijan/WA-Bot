import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { listMigrations, runMigrations } from '../src/migrations/index.js';

const silentLogger = { log() {} };

function openDatabase() {
  return new sqlite3.Database(':memory:');
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
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createSchema023Fixture() {
  const db = openDatabase();
  await runMigrations(db, {
    logger: silentLogger,
    targetId: '023_delivery_receipts'
  });
  return db;
}

test('migration registry reserves 024 for Chatbot AI usage and limits', () => {
  const migrations = listMigrations();
  assert.equal(migrations.length, 28);
  assert.equal(migrations[23].id, '024_chatbot_ai_usage_and_limits');
});

test('migration 024 upgrades a schema-023 fixture additively and enforces ownership', async (t) => {
  const db = await createSchema023Fixture();
  t.after(() => close(db));

  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'rag-owner', 'test-hash', 'RAG Owner', 'admin', 1),
            (2, 'other-owner', 'test-hash', 'Other Owner', 'user', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('rag-session', 'CONNECTED', 1)`
  );
  await run(
    db,
    `INSERT INTO chatbot_ai_settings (session_id, is_active)
     VALUES ('rag-session', 1)`
  );

  const result = await runMigrations(db, {
    logger: silentLogger,
    targetId: '024_chatbot_ai_usage_and_limits'
  });
  assert.equal(result.applied, 1);
  assert.equal(result.total, 28);

  const maxOutputColumn = (await all(db, 'PRAGMA table_info(chatbot_ai_settings)'))
    .find((column) => column.name === 'max_output_tokens');
  assert.ok(maxOutputColumn);
  assert.equal(maxOutputColumn.notnull, 1);
  assert.equal(maxOutputColumn.dflt_value, '2048');

  const settings = await get(
    db,
    'SELECT max_output_tokens FROM chatbot_ai_settings WHERE session_id = ?',
    ['rag-session']
  );
  assert.equal(settings.max_output_tokens, 2048);

  await assert.rejects(
    run(
      db,
      'UPDATE chatbot_ai_settings SET max_output_tokens = ? WHERE session_id = ?',
      [2049, 'rag-session']
    ),
    /CHECK constraint failed/
  );

  await run(
    db,
    `INSERT INTO chatbot_ai_usage (
       user_id, session_id, request_id, attempt_no, request_kind, operation,
       input_tokens, output_tokens, total_tokens, request_status, usage_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, 'rag-session', 'request-1', 1, 'production', 'chat', 1200, 250, 1450, 'SUCCEEDED', 'KNOWN']
  );

  await run(
    db,
    `INSERT INTO chatbot_ai_usage (
       user_id, session_id, request_id, request_kind, operation, usage_status
     ) VALUES (?, NULL, ?, ?, ?, ?)`,
    [1, 'embedding-1', 'embedding', 'source_embedding', 'UNKNOWN']
  );

  await assert.rejects(
    run(
      db,
      `INSERT INTO chatbot_ai_usage (
         user_id, session_id, request_id, request_kind, operation
       ) VALUES (?, ?, ?, ?, ?)`,
      [2, 'rag-session', 'forged-owner', 'production', 'chat']
    ),
    /FOREIGN KEY constraint failed/
  );

  await assert.rejects(
    run(
      db,
      `INSERT INTO chatbot_ai_usage (
         user_id, session_id, request_id, attempt_no, request_kind, operation
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [1, 'rag-session', 'request-1', 1, 'production', 'chat']
    ),
    /UNIQUE constraint failed/
  );

  await assert.rejects(
    run(
      db,
      `INSERT INTO chatbot_ai_usage (
         user_id, session_id, request_id, request_kind, operation, input_tokens
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [1, 'rag-session', 'negative-token', 'production', 'chat', -1]
    ),
    /CHECK constraint failed/
  );

  await run(
    db,
    `INSERT INTO chatbot_ai_budget_daily (
       user_id, budget_day, limit_microusd, spent_microusd, reserved_microusd
     ) VALUES (?, ?, ?, ?, ?)`,
    [1, '2026-09-09', 100000, 1000, 2000]
  );
  await run(
    db,
    `INSERT INTO chatbot_ai_budget_reservations (
       attempt_id, user_id, budget_day, reserved_microusd, status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    ['attempt-1', 1, '2026-09-09', 2000, 'RESERVED', '2026-09-09 23:59:59']
  );

  await assert.rejects(
    run(
      db,
      `INSERT INTO chatbot_ai_budget_reservations (
         attempt_id, user_id, budget_day, reserved_microusd, status, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      ['missing-day', 1, '2026-09-10', 1000, 'RESERVED', '2026-09-10 23:59:59']
    ),
    /FOREIGN KEY constraint failed/
  );

  const foreignKeyViolations = await all(db, 'PRAGMA foreign_key_check');
  assert.deepEqual(foreignKeyViolations, []);

  const secondRun = await runMigrations(db, {
    logger: silentLogger,
    targetId: '024_chatbot_ai_usage_and_limits'
  });
  assert.equal(secondRun.applied, 0);
});

test('migration 024 preflight rejects a session without a valid tenant owner', async (t) => {
  const db = await createSchema023Fixture();
  t.after(() => close(db));

  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'valid-owner', 'test-hash', 'Valid Owner', 'admin', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES ('orphan-session', 'DISCONNECTED', 999)`
  );

  await assert.rejects(
    runMigrations(db, {
      logger: silentLogger,
      targetId: '024_chatbot_ai_usage_and_limits'
    }),
    /Migration 024 requires every session to have a valid owner; invalid session: orphan-session/
  );

  const migration = await get(
    db,
    'SELECT id FROM schema_migrations WHERE id = ?',
    ['024_chatbot_ai_usage_and_limits']
  );
  assert.equal(migration, undefined);

  const usageTable = await get(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chatbot_ai_usage'"
  );
  assert.equal(usageTable, undefined);

  const maxOutputColumn = (await all(db, 'PRAGMA table_info(chatbot_ai_settings)'))
    .find((column) => column.name === 'max_output_tokens');
  assert.equal(maxOutputColumn, undefined);
});
