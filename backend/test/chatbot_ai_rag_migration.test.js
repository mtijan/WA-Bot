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

async function createSchema024Fixture() {
  const db = openDatabase();
  await runMigrations(db, {
    logger: silentLogger,
    targetId: '024_chatbot_ai_usage_and_limits'
  });
  return db;
}

async function seedTenants(db) {
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
  const credential = await run(
    db,
    `INSERT INTO chatbot_ai_credentials (name, base_url, model_name, user_id)
     VALUES ('RAG credential', 'https://provider.example/v1', 'chat-model', 1)`
  );
  const flow = await run(
    db,
    `INSERT INTO chatbot_flows (flow_name, session_ids, keywords, nodes, user_id)
     VALUES ('RAG flow', '["rag-session"]', '["harga"]', '[]', 1)`
  );
  await run(
    db,
    `INSERT INTO chatbot_flow_sessions (flow_id, session_id, user_id)
     VALUES (?, 'rag-session', 1)`,
    [flow.id]
  );
  await run(
    db,
    `INSERT INTO chatbot_ai_settings (
       session_id, is_active, credential_id, system_instruction, knowledge_base,
       max_output_tokens
     ) VALUES ('rag-session', 1, ?, 'jawab ringkas', 'harga paket dasar', 512)`,
    [credential.id]
  );
  return { credentialId: credential.id, flowId: flow.id };
}

test('migration registry reserves 025 for the tenant-scoped RAG index', () => {
  const migrations = listMigrations();
  assert.equal(migrations.length, 26);
  assert.equal(migrations[24].id, '025_chatbot_ai_rag_index');
});

test('migration 025 builds an additive tenant-scoped RAG schema with synchronized FTS', async (t) => {
  const db = await createSchema024Fixture();
  t.after(() => close(db));
  const { credentialId, flowId } = await seedTenants(db);

  const result = await runMigrations(db, {
    logger: silentLogger,
    targetId: '025_chatbot_ai_rag_index'
  });
  assert.equal(result.applied, 1);
  assert.equal(result.total, 26);

  const settings = await get(
    db,
    `SELECT user_id, system_instruction, knowledge_base, max_output_tokens,
            temperature, rag_mode, rag_top_k, rag_context_tokens,
            rag_input_budget_tokens, cache_enabled, cache_ttl_seconds,
            direct_answer_enabled, debounce_ms, prompt_version, config_revision
     FROM chatbot_ai_settings WHERE session_id = 'rag-session'`
  );
  assert.deepEqual(settings, {
    user_id: 1,
    system_instruction: 'jawab ringkas',
    knowledge_base: 'harga paket dasar',
    max_output_tokens: 512,
    temperature: 0.3,
    rag_mode: 'off',
    rag_top_k: 4,
    rag_context_tokens: 1000,
    rag_input_budget_tokens: 2200,
    cache_enabled: 0,
    cache_ttl_seconds: 86400,
    direct_answer_enabled: 0,
    debounce_ms: 0,
    prompt_version: 1,
    config_revision: 1
  });

  await run(
    db,
    `INSERT INTO chatbot_ai_settings (session_id, is_active)
     VALUES ('other-session', 0)`
  );
  assert.equal(
    (await get(db, "SELECT user_id FROM chatbot_ai_settings WHERE session_id = 'other-session'"))
      .user_id,
    2
  );

  const profile = await run(
    db,
    `INSERT INTO rag_embedding_profiles (
       user_id, credential_id, model, dimensions, config_hash, capability_status
     ) VALUES (1, ?, 'embedding-model', 1024, 'profile-hash-v1', 'SUPPORTED')`,
    [credentialId]
  );
  await run(
    db,
    `UPDATE chatbot_ai_settings SET embedding_profile_id = ?
     WHERE session_id = 'rag-session'`,
    [profile.id]
  );

  await assert.rejects(
    run(
      db,
      `INSERT INTO rag_embedding_profiles (
         user_id, credential_id, model, dimensions, config_hash
       ) VALUES (2, ?, 'embedding-model', 1024, 'forged-profile')`,
      [credentialId]
    ),
    /FOREIGN KEY constraint failed/
  );
  await assert.rejects(
    run(
      db,
      `UPDATE chatbot_ai_settings SET embedding_profile_id = ?
       WHERE session_id = 'other-session'`,
      [profile.id]
    ),
    /FOREIGN KEY constraint failed/
  );

  const source = await run(
    db,
    `INSERT INTO rag_sources (
       user_id, source_type, flow_id, content_hash, embedding_profile_id
     ) VALUES (1, 'flow', ?, 'source-hash-v1', ?)`,
    [flowId, profile.id]
  );
  await run(
    db,
    `INSERT INTO rag_session_sources (session_id, source_id, user_id)
     VALUES ('rag-session', ?, 1)`,
    [source.id]
  );
  await assert.rejects(
    run(
      db,
      `INSERT INTO rag_session_sources (session_id, source_id, user_id)
       VALUES ('other-session', ?, 2)`,
      [source.id]
    ),
    /FOREIGN KEY constraint failed/
  );
  await assert.rejects(
    run(
      db,
      `INSERT INTO rag_sources (
         user_id, source_type, flow_id, manual_session_id, content_hash
       ) VALUES (1, 'flow', ?, 'rag-session', 'invalid-shape')`,
      [flowId]
    ),
    /CHECK constraint failed/
  );

  const chunk = await run(
    db,
    `INSERT INTO rag_chunks (
       source_id, user_id, source_revision, chunk_index, chunk_text,
       token_count, content_hash
     ) VALUES (?, 1, 1, 0, 'Paket Alpha seharga seratus ribu', 7, 'chunk-hash-v1')`,
    [source.id]
  );
  let ftsRows = await all(
    db,
    `SELECT rowid FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Alpha'`
  );
  assert.deepEqual(ftsRows, [{ rowid: chunk.id }]);

  await run(
    db,
    `UPDATE rag_chunks SET chunk_text = 'Paket Beta seharga dua ratus ribu'
     WHERE id = ?`,
    [chunk.id]
  );
  assert.deepEqual(
    await all(db, `SELECT rowid FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Alpha'`),
    []
  );
  assert.deepEqual(
    await all(db, `SELECT rowid FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Beta'`),
    [{ rowid: chunk.id }]
  );

  await run(
    db,
    `INSERT INTO rag_index_jobs (
       source_id, user_id, requested_revision, embedding_config_hash
     ) VALUES (?, 1, 1, 'profile-hash-v1')`,
    [source.id]
  );
  await assert.rejects(
    run(
      db,
      `INSERT INTO rag_index_jobs (
         source_id, user_id, requested_revision, embedding_config_hash
       ) VALUES (?, 1, 1, 'profile-hash-v1')`,
      [source.id]
    ),
    /UNIQUE constraint failed/
  );
  await run(
    db,
    `INSERT INTO rag_response_cache (
       user_id, session_id, cache_key, source_revision_digest,
       response_ciphertext, expires_at
     ) VALUES (1, 'rag-session', 'cache-key-v1', 'revision-v1', ?, '2026-09-10 00:00:00')`,
    [Buffer.from('encrypted-test-value')]
  );

  assert.equal(
    (await get(
      db,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name = 'chatbot_ai_usage'`
    )).count,
    1
  );

  await run(
    db,
    `DELETE FROM rag_session_sources
     WHERE session_id = 'rag-session' AND source_id = ?`,
    [source.id]
  );
  assert.ok(await get(db, 'SELECT id FROM rag_sources WHERE id = ?', [source.id]));
  await run(
    db,
    `INSERT INTO rag_session_sources (session_id, source_id, user_id)
     VALUES ('rag-session', ?, 1)`,
    [source.id]
  );
  await run(db, 'UPDATE rag_sources SET is_active = 0 WHERE id = ?', [source.id]);
  assert.equal((await get(db, 'SELECT is_active FROM rag_sources WHERE id = ?', [source.id])).is_active, 0);

  await run(db, 'DELETE FROM rag_sources WHERE id = ?', [source.id]);
  assert.equal(await get(db, 'SELECT id FROM rag_chunks WHERE id = ?', [chunk.id]), undefined);
  assert.equal(
    await get(db, 'SELECT source_id FROM rag_session_sources WHERE source_id = ?', [source.id]),
    undefined
  );
  assert.equal(
    await get(db, 'SELECT source_id FROM rag_index_jobs WHERE source_id = ?', [source.id]),
    undefined
  );
  assert.deepEqual(
    await all(db, `SELECT rowid FROM rag_chunks_fts WHERE rag_chunks_fts MATCH 'Beta'`),
    []
  );

  const foreignKeyViolations = await all(db, 'PRAGMA foreign_key_check');
  assert.deepEqual(foreignKeyViolations, []);

  const secondRun = await runMigrations(db, {
    logger: silentLogger,
    targetId: '025_chatbot_ai_rag_index'
  });
  assert.equal(secondRun.applied, 0);
});

test('migration 025 preflight rejects an orphaned flow owner without partial schema changes', async (t) => {
  const db = await createSchema024Fixture();
  t.after(() => close(db));

  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'valid-owner', 'test-hash', 'Valid Owner', 'admin', 1)`
  );
  await run(
    db,
    `INSERT INTO chatbot_flows (flow_name, session_ids, keywords, nodes, user_id)
     VALUES ('orphan flow', '[]', '[]', '[]', 999)`
  );

  await assert.rejects(
    runMigrations(db, {
      logger: silentLogger,
      targetId: '025_chatbot_ai_rag_index'
    }),
    /Migration 025 requires valid tenant ownership; invalid flow:/
  );

  assert.equal(
    await get(
      db,
      "SELECT id FROM schema_migrations WHERE id = '025_chatbot_ai_rag_index'"
    ),
    undefined
  );
  assert.equal(
    await get(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rag_sources'"),
    undefined
  );
});
