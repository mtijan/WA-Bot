import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sqlite3 from 'sqlite3';

process.env.NODE_ENV = 'test';
const testTmpDir = mkdtempSync(join(tmpdir(), 'wa-bot-reindex-test-'));
process.env.WA_BOT_DB_PATH = join(testTmpDir, 'test.sqlite');

import { runMigrations } from '../src/migrations/index.js';
import {
  reindexKnowledgeSource,
  reindexSessionKnowledgeSources,
  reindexSessionKnowledgeSourcesSafely,
  syncManualKnowledgeSource,
  syncFlowKnowledgeSource
} from '../src/services/chatbot_ai_rag_index.service.js';

const { reindexAISession } = await import('../src/controllers/chatbot_ai.controller.js');

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

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

test('reindexKnowledgeSource validates input and verifies ownership & active status', async (t) => {
  const { client } = await setupTestDb(t);

  await assert.rejects(
    reindexKnowledgeSource({ sourceId: 0, userId: 1 }, client),
    (err) => err.code === 'RAG_INDEX_INVALID_INPUT'
  );

  await assert.rejects(
    reindexKnowledgeSource({ sourceId: 999, userId: 1 }, client),
    (err) => err.code === 'RAG_SOURCE_NOT_FOUND'
  );

  // Create manual source for user 2
  const syncRes = await syncManualKnowledgeSource({
    userId: 2,
    sessionId: 'sess-user2-a',
    knowledgeBase: 'Konten pengetahuan tenant 2.'
  }, client);

  // User 1 cannot access User 2's source
  await assert.rejects(
    reindexKnowledgeSource({ sourceId: syncRes.sourceId, userId: 1 }, client),
    (err) => err.code === 'FORBIDDEN_ACCESS'
  );

  // Deactivate source and assert RAG_SOURCE_INACTIVE
  await client.run('UPDATE rag_sources SET is_active = 0 WHERE id = ?', [syncRes.sourceId]);
  await assert.rejects(
    reindexKnowledgeSource({ sourceId: syncRes.sourceId, userId: 2 }, client),
    (err) => err.code === 'RAG_SOURCE_INACTIVE'
  );
});

test('reindexKnowledgeSource handles job states: missing, pending, failed, ready (force true/false)', async (t) => {
  const { client } = await setupTestDb(t);

  const syncRes = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Panduan operasional toko user 1.'
  }, client);
  const sourceId = syncRes.sourceId;

  // 1. Delete initial job to test "missing job" scenario
  await client.run('DELETE FROM rag_index_jobs WHERE source_id = ?', [sourceId]);

  const reindex1 = await reindexKnowledgeSource({ sourceId, userId: 1 }, client);
  assert.equal(reindex1.status, 'PENDING');
  assert.equal(reindex1.enqueued, true);
  assert.equal(reindex1.idempotent, false);

  // 2. Calling reindex again while PENDING -> idempotent, no restart
  const reindex2 = await reindexKnowledgeSource({ sourceId, userId: 1 }, client);
  assert.equal(reindex2.status, 'PENDING');
  assert.equal(reindex2.enqueued, false);
  assert.equal(reindex2.idempotent, true);

  // 3. Mark job as FAILED
  await client.run(
    `UPDATE rag_index_jobs
     SET status = 'FAILED', attempts = 3, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [reindex1.jobId]
  );
  await client.run(
    `UPDATE rag_sources
     SET lexical_status = 'FAILED'
     WHERE id = ?`,
    [sourceId]
  );

  // Calling reindex on FAILED -> resets to PENDING, attempts 0, lexical_status PENDING
  const reindex3 = await reindexKnowledgeSource({ sourceId, userId: 1 }, client);
  assert.equal(reindex3.status, 'PENDING');
  assert.equal(reindex3.attempts, 0);
  assert.equal(reindex3.enqueued, true);
  assert.equal(reindex3.idempotent, false);

  const updatedSource = await client.get('SELECT lexical_status FROM rag_sources WHERE id = ?', [sourceId]);
  assert.equal(updatedSource.lexical_status, 'PENDING');

  // 4. Mark job as READY
  await client.run(
    `UPDATE rag_index_jobs
     SET status = 'READY', attempts = 1
     WHERE id = ?`,
    [reindex1.jobId]
  );
  await client.run(
    `UPDATE rag_sources
     SET lexical_status = 'READY'
     WHERE id = ?`,
    [sourceId]
  );

  // Calling reindex without force -> returns READY, enqueued false, idempotent true
  const reindex4 = await reindexKnowledgeSource({ sourceId, userId: 1, force: false }, client);
  assert.equal(reindex4.status, 'READY');
  assert.equal(reindex4.enqueued, false);
  assert.equal(reindex4.idempotent, true);

  // 5. Calling reindex with force: true -> resets READY to PENDING
  const reindex5 = await reindexKnowledgeSource({ sourceId, userId: 1, force: true }, client);
  assert.equal(reindex5.status, 'PENDING');
  assert.equal(reindex5.attempts, 0);
  assert.equal(reindex5.enqueued, true);
  assert.equal(reindex5.idempotent, false);
});

test('reindexSessionKnowledgeSources enforces session ownership and mappings', async (t) => {
  const { client } = await setupTestDb(t);

  // 1. Session not found
  await assert.rejects(
    reindexSessionKnowledgeSources({ sessionId: 'unknown-session', userId: 1 }, client),
    (err) => err.code === 'SESSION_NOT_FOUND'
  );

  // 2. User 1 cannot access user 2's session
  await assert.rejects(
    reindexSessionKnowledgeSources({ sessionId: 'sess-user2-a', userId: 1 }, client),
    (err) => err.code === 'FORBIDDEN_ACCESS'
  );

  // 3. User 1 has session sess-user1-a and sess-user1-b
  const manualA = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Pengetahuan untuk session A'
  }, client);

  const manualB = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-b',
    knowledgeBase: 'Pengetahuan untuk session B'
  }, client);

  // Trying to reindex session A with source B (not mapped to session A) -> RAG_SOURCE_NOT_MAPPED
  await assert.rejects(
    reindexSessionKnowledgeSources({
      sessionId: 'sess-user1-a',
      userId: 1,
      sourceId: manualB.sourceId
    }, client),
    (err) => err.code === 'RAG_SOURCE_NOT_MAPPED'
  );

  // Trying to reindex session A with source belonging to User 2 -> FORBIDDEN_ACCESS
  const manualUser2 = await syncManualKnowledgeSource({
    userId: 2,
    sessionId: 'sess-user2-a',
    knowledgeBase: 'Pengetahuan tenant 2'
  }, client);

  await assert.rejects(
    reindexSessionKnowledgeSources({
      sessionId: 'sess-user1-a',
      userId: 1,
      sourceId: manualUser2.sourceId
    }, client),
    (err) => err.code === 'FORBIDDEN_ACCESS'
  );

  // Reindexing session A with source A succeeds
  const singleResult = await reindexSessionKnowledgeSources({
    sessionId: 'sess-user1-a',
    userId: 1,
    sourceId: manualA.sourceId
  }, client);
  assert.equal(singleResult.session_id, 'sess-user1-a');
  assert.equal(singleResult.sources_count, 1);
  assert.equal(singleResult.jobs.length, 1);
  assert.equal(singleResult.jobs[0].source_id, manualA.sourceId);
});

test('reindexSessionKnowledgeSources reindexes all mapped sources including Flow and Manual', async (t) => {
  const { client } = await setupTestDb(t);

  // Add manual KB for session A
  const manualA = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Konten manual sesi A'
  }, client);

  // Add Flow assigned to session A
  await client.run(
    `INSERT INTO chatbot_flows (
       id, flow_name, description, session_ids, target_type, keywords,
       match_type, case_sensitive, cooldown, delay, nodes, status, user_id
     ) VALUES (101, 'Flow Promosi', 'Flow promo', '["sess-user1-a"]', 'all', '[]',
               'contains', 0, 0, 0,
               '[{"id":"node-1","node_name":"Promo Node","message_type":"Text Message","message_content":"Diskon spesial 50 persen hari ini!"}]',
               'ACTIVE', 1)`
  );
  const flowResult = await syncFlowKnowledgeSource({
    flowId: 101,
    userId: 1,
    sessionIds: ['sess-user1-a']
  }, client);

  // Now session sess-user1-a has 2 active sources: manualA and flowResult
  const reindexResult = await reindexSessionKnowledgeSources({
    sessionId: 'sess-user1-a',
    userId: 1,
    force: true
  }, client);

  assert.equal(reindexResult.session_id, 'sess-user1-a');
  assert.equal(reindexResult.sources_count, 2);
  assert.equal(reindexResult.jobs.length, 2);

  const sourceIds = reindexResult.jobs.map((j) => j.source_id);
  assert.ok(sourceIds.includes(manualA.sourceId));
  assert.ok(sourceIds.includes(flowResult.sourceId));
  assert.equal(reindexResult.status, 'PENDING');
});

test('reindexSessionKnowledgeSources auto-syncs legacy settings if no sources exist yet', async (t) => {
  const { client } = await setupTestDb(t);

  // Insert chatbot_ai_settings directly without syncManualKnowledgeSource
  await client.run(
    `INSERT INTO chatbot_ai_settings (session_id, user_id, knowledge_base, is_active)
     VALUES ('sess-user1-a', 1, 'Informasi legacy FAQ produk toko.', 1)`
  );

  const result = await reindexSessionKnowledgeSources({
    sessionId: 'sess-user1-a',
    userId: 1
  }, client);

  assert.equal(result.session_id, 'sess-user1-a');
  assert.equal(result.sources_count, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].source_type, 'manual');
  assert.equal(result.jobs[0].status, 'PENDING');
});

test('reindexSessionKnowledgeSources returns clean response for empty session', async (t) => {
  const { client } = await setupTestDb(t);

  const result = await reindexSessionKnowledgeSources({
    sessionId: 'sess-user1-b',
    userId: 1
  }, client);

  assert.equal(result.session_id, 'sess-user1-b');
  assert.equal(result.sources_count, 0);
  assert.deepEqual(result.jobs, []);
  assert.equal(result.status, 'READY');
});

test('reindexSessionKnowledgeSourcesSafely catches errors and returns null', async (t) => {
  const result = await reindexSessionKnowledgeSourcesSafely({
    sessionId: '',
    userId: 0
  });
  assert.equal(result, null);
});

test('reindexAISession controller returns 202, 404, 403, and 400', async (t) => {
  const { client } = await setupTestDb(t);

  const manualA = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-a',
    knowledgeBase: 'Panduan manual controller test.'
  }, client);

  // 1. Success case: 202 Accepted
  const reqSuccess = {
    params: { sessionId: 'sess-user1-a' },
    body: { force: true },
    auth: { userId: 1 },
    dbClient: client
  };
  const resSuccess = createMockResponse();
  await reindexAISession(reqSuccess, resSuccess);
  assert.equal(resSuccess.statusCode, 202);
  assert.equal(resSuccess.body.status, 'success');
  assert.equal(resSuccess.body.data.session_id, 'sess-user1-a');
  assert.equal(resSuccess.body.data.sources_count, 1);
  assert.equal(resSuccess.body.data.status, 'PENDING');
  assert.ok(resSuccess.body.data.job_id);

  // 2. Session Not Found: 404
  const reqNotFound = {
    params: { sessionId: 'nonexistent-session' },
    body: {},
    auth: { userId: 1 },
    dbClient: client
  };
  const resNotFound = createMockResponse();
  await reindexAISession(reqNotFound, resNotFound);
  assert.equal(resNotFound.statusCode, 404);
  assert.equal(resNotFound.body.status, 'error');
  assert.equal(resNotFound.body.error_code, 'SESSION_NOT_FOUND');

  // 3. Forbidden Access: 403 (User 1 trying to access User 2's session)
  const reqForbidden = {
    params: { sessionId: 'sess-user2-a' },
    body: {},
    auth: { userId: 1 },
    dbClient: client
  };
  const resForbidden = createMockResponse();
  await reindexAISession(reqForbidden, resForbidden);
  assert.equal(resForbidden.statusCode, 403);
  assert.equal(resForbidden.body.status, 'error');
  assert.equal(resForbidden.body.error_code, 'FORBIDDEN_ACCESS');

  // 4. Source Not Mapped: 400
  const manualB = await syncManualKnowledgeSource({
    userId: 1,
    sessionId: 'sess-user1-b',
    knowledgeBase: 'Sesi B KB'
  }, client);

  const reqUnmapped = {
    params: { sessionId: 'sess-user1-a' },
    body: { source_id: manualB.sourceId },
    auth: { userId: 1 },
    dbClient: client
  };
  const resUnmapped = createMockResponse();
  await reindexAISession(reqUnmapped, resUnmapped);
  assert.equal(resUnmapped.statusCode, 400);
  assert.equal(resUnmapped.body.status, 'error');
  assert.equal(resUnmapped.body.error_code, 'RAG_SOURCE_NOT_MAPPED');

  // 5. Source Inactive: 400
  await client.run('UPDATE rag_sources SET is_active = 0 WHERE id = ?', [manualA.sourceId]);
  const reqInactive = {
    params: { sessionId: 'sess-user1-a' },
    body: { source_id: manualA.sourceId },
    auth: { userId: 1 },
    dbClient: client
  };
  const resInactive = createMockResponse();
  await reindexAISession(reqInactive, resInactive);
  assert.equal(resInactive.statusCode, 400);
  assert.equal(resInactive.body.status, 'error');
  assert.equal(resInactive.body.error_code, 'RAG_SOURCE_INACTIVE');
});

