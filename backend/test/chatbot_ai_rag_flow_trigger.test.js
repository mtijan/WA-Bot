import assert from 'node:assert/strict';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  syncFlowKnowledgeSource,
  syncFlowKnowledgeSourceSafely,
  deleteFlowKnowledgeSource,
  deleteFlowKnowledgeSourceSafely
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
    db.close((error) => (error ? reject(error) : resolve()));
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

async function insertFlowFixture(db, flow) {
  await run(
    db,
    `INSERT INTO chatbot_flows (
       id, flow_name, description, session_ids, target_type, keywords,
       match_type, case_sensitive, cooldown, delay, nodes, status, user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flow.id,
      flow.flow_name,
      flow.description || null,
      JSON.stringify(flow.session_ids || []),
      flow.target_type || 'ALL',
      flow.keywords || '',
      flow.match_type || 'CONTAINS',
      flow.case_sensitive ? 1 : 0,
      flow.cooldown || 0,
      flow.delay || 0,
      JSON.stringify(flow.nodes || []),
      flow.status || 'ACTIVE',
      flow.user_id || 1
    ]
  );
}

async function updateFlowFixture(db, flow) {
  await run(
    db,
    `UPDATE chatbot_flows
     SET flow_name = ?, description = ?, session_ids = ?, target_type = ?,
         keywords = ?, match_type = ?, case_sensitive = ?, cooldown = ?,
         delay = ?, nodes = ?, status = ?
     WHERE id = ? AND user_id = ?`,
    [
      flow.flow_name,
      flow.description || null,
      JSON.stringify(flow.session_ids || []),
      flow.target_type || 'ALL',
      flow.keywords || '',
      flow.match_type || 'CONTAINS',
      flow.case_sensitive ? 1 : 0,
      flow.cooldown || 0,
      flow.delay || 0,
      JSON.stringify(flow.nodes || []),
      flow.status || 'ACTIVE',
      flow.id,
      flow.user_id || 1
    ]
  );
}

test('syncFlowKnowledgeSource validates required inputs and ownership', async (t) => {
  const { db, client } = await setupTestDb(t);

  await assert.rejects(
    syncFlowKnowledgeSource({ userId: 0, flowId: 1 }, client),
    (err) => err.code === 'RAG_INDEX_INVALID_INPUT'
  );

  await assert.rejects(
    syncFlowKnowledgeSource({ userId: 1, flowId: 0 }, client),
    (err) => err.code === 'RAG_INDEX_INVALID_INPUT'
  );

  await assert.rejects(
    syncFlowKnowledgeSource({ userId: 1, flowId: 999 }, client),
    (err) => err.code === 'RAG_FLOW_NOT_FOUND'
  );

  await insertFlowFixture(db, {
    id: 10,
    flow_name: 'Other User Flow',
    user_id: 2,
    nodes: []
  });

  await assert.rejects(
    syncFlowKnowledgeSource({
      userId: 1,
      flowId: 10,
      flow: { id: 10, user_id: 2, nodes: [] }
    }, client),
    (err) => err.code === 'RAG_FLOW_FORBIDDEN'
  );
});

test('syncFlowKnowledgeSource creates rag_sources, rag_session_sources, and enqueues revision 1 job', async (t) => {
  const { db, client } = await setupTestDb(t);

  const sampleFlow = {
    id: 101,
    flow_name: 'CS Konsultasi Produk',
    keywords: 'info, konsultasi, produk',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [
      {
        id: 'node-1',
        node_name: 'Penyambutan',
        message_type: 'Text Message',
        message_content: 'Halo, selamat datang di CS kami! Silakan pilih layanan.',
        buttons: ['Konsultasi', 'Harga']
      }
    ]
  };
  await insertFlowFixture(db, sampleFlow);

  const result = await syncFlowKnowledgeSource({
    flowId: 101,
    userId: 1,
    flow: sampleFlow
  }, client);

  assert.equal(result.action, 'created');
  assert.equal(result.revision, 1);
  assert.equal(result.isActive, true);
  assert.equal(result.enqueued, true);
  assert.deepEqual(result.validSessionIds, ['sess-user1-a']);

  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [result.sourceId]);
  assert.ok(source);
  assert.equal(source.user_id, 1);
  assert.equal(source.source_type, 'flow');
  assert.equal(source.flow_id, 101);
  assert.equal(source.manual_session_id, null);
  assert.equal(source.current_revision, 1);
  assert.equal(source.indexed_revision, 0);
  assert.equal(source.lexical_status, 'PENDING');
  assert.equal(source.is_active, 1);

  const mapping = await all(
    db,
    'SELECT session_id, source_id, user_id FROM rag_session_sources WHERE source_id = ?',
    [result.sourceId]
  );
  assert.equal(mapping.length, 1);
  assert.equal(mapping[0].session_id, 'sess-user1-a');
  assert.equal(mapping[0].user_id, 1);

  const job = await get(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [result.sourceId]);
  assert.ok(job);
  assert.equal(job.requested_revision, 1);
  assert.equal(job.status, 'PENDING');
});

test('syncFlowKnowledgeSource filters out unauthorized sessions', async (t) => {
  const { db, client } = await setupTestDb(t);

  const sampleFlow = {
    id: 102,
    flow_name: 'Multi Session Flow',
    keywords: 'bantuan',
    session_ids: ['sess-user1-a', 'sess-user2-a', 'non-existent-sess'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [
      {
        id: 'node-1',
        message_content: 'Konten flow bantuan multi sesi.'
      }
    ]
  };
  await insertFlowFixture(db, sampleFlow);

  const result = await syncFlowKnowledgeSource({
    flowId: 102,
    userId: 1,
    flow: sampleFlow
  }, client);

  assert.deepEqual(result.validSessionIds, ['sess-user1-a']);

  const mappings = await all(
    db,
    'SELECT session_id FROM rag_session_sources WHERE source_id = ?',
    [result.sourceId]
  );
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].session_id, 'sess-user1-a');
});

test('syncFlowKnowledgeSource idempotent save returns noop without revision advance or duplicate job', async (t) => {
  const { db, client } = await setupTestDb(t);

  const sampleFlow = {
    id: 103,
    flow_name: 'Flow Idempotent Test',
    keywords: 'test',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [
      {
        id: 'node-1',
        message_content: 'Pesan stabil yang tidak berubah sama sekali.'
      }
    ]
  };
  await insertFlowFixture(db, sampleFlow);

  const first = await syncFlowKnowledgeSource({
    flowId: 103,
    userId: 1,
    flow: sampleFlow
  }, client);
  assert.equal(first.action, 'created');
  assert.equal(first.revision, 1);
  assert.equal(first.enqueued, true);

  const second = await syncFlowKnowledgeSource({
    flowId: 103,
    userId: 1,
    flow: sampleFlow
  }, client);
  assert.equal(second.action, 'noop');
  assert.equal(second.revision, 1);
  assert.equal(second.enqueued, false);

  const jobs = await all(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [first.sourceId]);
  assert.equal(jobs.length, 1);
});

test('syncFlowKnowledgeSource advances revision and enqueues next revision job on content change', async (t) => {
  const { db, client } = await setupTestDb(t);

  const flowV1 = {
    id: 104,
    flow_name: 'Flow Revisi Test',
    keywords: 'versi',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [{ id: 'node-1', message_content: 'Versi satu dari materi alur.' }]
  };
  await insertFlowFixture(db, flowV1);

  const res1 = await syncFlowKnowledgeSource({ flowId: 104, userId: 1, flow: flowV1 }, client);
  assert.equal(res1.revision, 1);

  const flowV2 = {
    id: 104,
    flow_name: 'Flow Revisi Test',
    keywords: 'versi',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [{ id: 'node-1', message_content: 'Versi dua dengan pembaruan materi lengkap.' }]
  };
  await updateFlowFixture(db, flowV2);

  const res2 = await syncFlowKnowledgeSource({ flowId: 104, userId: 1, flow: flowV2 }, client);
  assert.equal(res2.action, 'updated');
  assert.equal(res2.revision, 2);
  assert.equal(res2.enqueued, true);

  const source = await get(db, 'SELECT current_revision, lexical_status FROM rag_sources WHERE id = ?', [res1.sourceId]);
  assert.equal(source.current_revision, 2);
  assert.equal(source.lexical_status, 'PENDING');

  const jobs = await all(db, 'SELECT requested_revision FROM rag_index_jobs WHERE source_id = ? ORDER BY id ASC', [res1.sourceId]);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].requested_revision, 1);
  assert.equal(jobs[1].requested_revision, 2);
});

test('syncFlowKnowledgeSource updates mapping only when session assignment changes and content is unchanged (RAG-0310)', async (t) => {
  const { db, client } = await setupTestDb(t);

  const flow = {
    id: 105,
    flow_name: 'Assignment Test Flow',
    keywords: 'sesi',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [{ id: 'node-1', message_content: 'Teks stabil untuk tes session assignment.' }]
  };
  await insertFlowFixture(db, flow);

  const res1 = await syncFlowKnowledgeSource({ flowId: 105, userId: 1, flow }, client);
  assert.equal(res1.action, 'created');
  assert.equal(res1.revision, 1);

  // Re-assign to sess-user1-a and sess-user1-b with identical content
  const res2 = await syncFlowKnowledgeSource({
    flowId: 105,
    userId: 1,
    flow,
    sessionIds: ['sess-user1-a', 'sess-user1-b']
  }, client);

  assert.equal(res2.action, 'mapping_updated');
  assert.equal(res2.revision, 1);
  assert.equal(res2.enqueued, false);
  assert.equal(res2.mappingChanged, true);
  assert.deepEqual(res2.validSessionIds.sort(), ['sess-user1-a', 'sess-user1-b'].sort());

  const mappingsAfterAdd = await all(
    db,
    'SELECT session_id FROM rag_session_sources WHERE source_id = ? ORDER BY session_id ASC',
    [res1.sourceId]
  );
  assert.equal(mappingsAfterAdd.length, 2);
  assert.equal(mappingsAfterAdd[0].session_id, 'sess-user1-a');
  assert.equal(mappingsAfterAdd[1].session_id, 'sess-user1-b');

  // No extra job created
  const jobs = await all(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [res1.sourceId]);
  assert.equal(jobs.length, 1);

  // Remove sess-user1-a, leaving only sess-user1-b
  const res3 = await syncFlowKnowledgeSource({
    flowId: 105,
    userId: 1,
    flow,
    sessionIds: ['sess-user1-b']
  }, client);

  assert.equal(res3.action, 'mapping_updated');
  assert.equal(res3.enqueued, false);

  const mappingsAfterRemove = await all(
    db,
    'SELECT session_id FROM rag_session_sources WHERE source_id = ?',
    [res1.sourceId]
  );
  assert.equal(mappingsAfterRemove.length, 1);
  assert.equal(mappingsAfterRemove[0].session_id, 'sess-user1-b');
});

test('syncFlowKnowledgeSource updates is_active on status changes (ACTIVE <-> INACTIVE)', async (t) => {
  const { db, client } = await setupTestDb(t);

  const activeFlow = {
    id: 106,
    flow_name: 'Status Test Flow',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [{ id: 'node-1', message_content: 'Konten untuk pengetesan status alur.' }]
  };
  await insertFlowFixture(db, activeFlow);

  const res1 = await syncFlowKnowledgeSource({ flowId: 106, userId: 1, flow: activeFlow }, client);
  assert.equal(res1.isActive, true);
  assert.equal(res1.enqueued, true);

  // Mark status INACTIVE
  const inactiveFlow = { ...activeFlow, status: 'INACTIVE' };
  await updateFlowFixture(db, inactiveFlow);
  const res2 = await syncFlowKnowledgeSource({ flowId: 106, userId: 1, flow: inactiveFlow }, client);
  assert.equal(res2.action, 'status_updated');
  assert.equal(res2.isActive, false);
  assert.equal(res2.enqueued, false);

  const sourceAfterInactive = await get(db, 'SELECT is_active FROM rag_sources WHERE id = ?', [res1.sourceId]);
  assert.equal(sourceAfterInactive.is_active, 0);

  // Toggle back to ACTIVE
  await updateFlowFixture(db, activeFlow);
  const res3 = await syncFlowKnowledgeSource({ flowId: 106, userId: 1, flow: activeFlow }, client);
  assert.equal(res3.action, 'status_updated');
  assert.equal(res3.isActive, true);

  const sourceAfterActive = await get(db, 'SELECT is_active FROM rag_sources WHERE id = ?', [res1.sourceId]);
  assert.equal(sourceAfterActive.is_active, 1);
});

test('deleteFlowKnowledgeSource removes source, session mappings, jobs, and chunks (RAG-0309)', async (t) => {
  const { db, client } = await setupTestDb(t);

  const flow = {
    id: 107,
    flow_name: 'Delete Test Flow',
    session_ids: ['sess-user1-a'],
    status: 'ACTIVE',
    user_id: 1,
    nodes: [{ id: 'node-1', message_content: 'Konten flow yang akan dihapus.' }]
  };
  await insertFlowFixture(db, flow);

  const synced = await syncFlowKnowledgeSource({ flowId: 107, userId: 1, flow }, client);
  assert.ok(synced.sourceId);

  // Insert mock chunks to verify cascade/cleanup
  await run(
    db,
    `INSERT INTO rag_chunks (source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash)
     VALUES (?, 1, 1, 0, 'Konten chunk flow 107', 10, 'chunk-hash-1')`,
    [synced.sourceId]
  );

  const deleteResult = await deleteFlowKnowledgeSource({ flowId: 107, userId: 1 }, client);
  assert.equal(deleteResult.deleted, true);
  assert.equal(deleteResult.flowId, 107);
  assert.equal(deleteResult.sourceId, synced.sourceId);

  // Verify all related records are deleted
  const source = await get(db, 'SELECT * FROM rag_sources WHERE id = ?', [synced.sourceId]);
  assert.equal(source, undefined);

  const mappings = await all(db, 'SELECT * FROM rag_session_sources WHERE source_id = ?', [synced.sourceId]);
  assert.equal(mappings.length, 0);

  const jobs = await all(db, 'SELECT * FROM rag_index_jobs WHERE source_id = ?', [synced.sourceId]);
  assert.equal(jobs.length, 0);

  const chunks = await all(db, 'SELECT * FROM rag_chunks WHERE source_id = ?', [synced.sourceId]);
  assert.equal(chunks.length, 0);

  // Deleting again returns deleted: false
  const repeatDelete = await deleteFlowKnowledgeSource({ flowId: 107, userId: 1 }, client);
  assert.equal(repeatDelete.deleted, false);
});

test('syncFlowKnowledgeSourceSafely and deleteFlowKnowledgeSourceSafely catch errors cleanly', async () => {
  const brokenClient = {
    run() { return Promise.reject(new Error('Simulated DB failure')); },
    get() { return Promise.reject(new Error('Simulated DB failure')); },
    all() { return Promise.reject(new Error('Simulated DB failure')); }
  };

  const syncResult = await syncFlowKnowledgeSourceSafely({ flowId: 999, userId: 1 }, brokenClient);
  assert.equal(syncResult, null);

  const deleteResult = await deleteFlowKnowledgeSourceSafely({ flowId: 999, userId: 1 }, brokenClient);
  assert.equal(deleteResult, null);
});

test('Chatbot flow controller operations automatically trigger RAG source sync, update, and delete', async () => {
  const { getTestAgent } = await import('./helpers/test_app.js');
  const { dbRun, dbGet, dbAll } = await import('../src/database.js');
  const agent = await getTestAgent();

  const testSessionId = 'rag-flow-ctrl-sess-1';
  await dbRun(
    'INSERT OR REPLACE INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [testSessionId, 'CONNECTED', 1]
  );

  // 1. Create flow via POST /api/chatbot-flows
  const createRes = await agent
    .post('/api/chatbot-flows')
    .send({
      flow_name: 'Controller Integration Flow',
      description: 'Tes integrasi controller alur dengan RAG',
      session_ids: [testSessionId],
      keywords: 'alur, bantuan',
      nodes: [
        {
          id: '1',
          node_name: 'Sambutan',
          message_type: 'Text Message',
          message_content: 'Selamat datang di layanan bot otomatis.',
          buttons: []
        }
      ],
      status: 'ACTIVE'
    });

  assert.equal(createRes.status, 201);
  const flowId = createRes.body.data.id;
  assert.ok(flowId);

  // Verify rag_sources created
  const source1 = await dbGet(
    'SELECT * FROM rag_sources WHERE flow_id = ? AND user_id = 1',
    [flowId]
  );
  assert.ok(source1);
  assert.equal(source1.source_type, 'flow');
  assert.equal(source1.current_revision, 1);
  assert.equal(source1.is_active, 1);

  // Verify rag_index_jobs enqueued
  const job1 = await dbGet(
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 1',
    [source1.id]
  );
  assert.ok(job1);
  assert.equal(job1.status, 'PENDING');

  // 2. Update flow content via PUT /api/chatbot-flows/:id
  const updateRes = await agent
    .put(`/api/chatbot-flows/${flowId}`)
    .send({
      flow_name: 'Controller Integration Flow Updated',
      description: 'Deskripsi diperbarui',
      session_ids: [testSessionId],
      keywords: 'alur, bantuan, baru',
      nodes: [
        {
          id: '1',
          node_name: 'Sambutan Revisi',
          message_type: 'Text Message',
          message_content: 'Selamat datang di layanan bot otomatis dengan info diperbarui.',
          buttons: ['Menu']
        }
      ],
      status: 'ACTIVE'
    });

  assert.equal(updateRes.status, 200);

  const source2 = await dbGet('SELECT * FROM rag_sources WHERE id = ?', [source1.id]);
  assert.equal(source2.current_revision, 2);

  const job2 = await dbGet(
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 2',
    [source1.id]
  );
  assert.ok(job2);
  assert.equal(job2.status, 'PENDING');

  // 3. Update flow settings (session assignment only) via PATCH /api/chatbot-flows/:id/settings (RAG-0310)
  const testSessionId2 = 'rag-flow-ctrl-sess-2';
  await dbRun(
    'INSERT OR REPLACE INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [testSessionId2, 'CONNECTED', 1]
  );

  const patchSettingsRes = await agent
    .patch(`/api/chatbot-flows/${flowId}/settings`)
    .send({
      flow_name: 'Controller Integration Flow Updated',
      description: 'Deskripsi diperbarui',
      session_ids: [testSessionId, testSessionId2],
      keywords: 'alur, bantuan, baru',
      target_type: 'ALL',
      match_type: 'CONTAINS',
      case_sensitive: false,
      cooldown: 0,
      delay: 0,
      status: 'ACTIVE'
    });
  assert.equal(patchSettingsRes.status, 200);

  const sourceAfterSettings = await dbGet('SELECT * FROM rag_sources WHERE id = ?', [source1.id]);
  // Revision should still be 2 (content did not change)
  assert.equal(sourceAfterSettings.current_revision, 2);

  const mappingsAfterSettings = await dbAll(
    'SELECT session_id FROM rag_session_sources WHERE source_id = ? ORDER BY session_id ASC',
    [source1.id]
  );
  assert.equal(mappingsAfterSettings.length, 2);
  assert.equal(mappingsAfterSettings[0].session_id, testSessionId);
  assert.equal(mappingsAfterSettings[1].session_id, testSessionId2);

  // 4. Update flow status via PATCH /api/chatbot-flows/:id/status
  const statusRes = await agent
    .patch(`/api/chatbot-flows/${flowId}/status`)
    .send({ status: 'INACTIVE' });

  assert.equal(statusRes.status, 200);

  const source3 = await dbGet('SELECT is_active FROM rag_sources WHERE id = ?', [source1.id]);
  assert.equal(source3.is_active, 0);

  // 5. Delete flow via DELETE /api/chatbot-flows/:id (RAG-0309)
  const deleteRes = await agent.delete(`/api/chatbot-flows/${flowId}`);
  assert.equal(deleteRes.status, 200);

  const sourceAfterDelete = await dbGet('SELECT * FROM rag_sources WHERE id = ?', [source1.id]);
  assert.equal(sourceAfterDelete, undefined);

  const mappingAfterDelete = await dbAll('SELECT * FROM rag_session_sources WHERE source_id = ?', [source1.id]);
  assert.equal(mappingAfterDelete.length, 0);
});

test('POST /api/chatbot-flows/import automatically creates RAG source and enqueues job', async () => {
  const { getTestAgent } = await import('./helpers/test_app.js');
  const { dbRun, dbGet, dbAll } = await import('../src/database.js');
  const agent = await getTestAgent();

  const importSessionId = 'rag-import-sess-1';
  await dbRun(
    'INSERT OR REPLACE INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [importSessionId, 'CONNECTED', 1]
  );

  const importPayload = {
    flows: [
      {
        name: 'Imported RAG Flow',
        description: 'Flow hasil impor',
        session_id: importSessionId,
        trigger_keywords: 'impor, panduan',
        keyword_match_type: 'contains',
        keyword_case_sensitive: 0,
        is_active: 1,
        nodes: [
          {
            name: 'Pesan Impor',
            message: 'Informasi lengkap materi impor alur.',
            node_type: 'message'
          }
        ]
      }
    ]
  };

  const importRes = await agent
    .post('/api/chatbot-flows/import')
    .send(importPayload);

  assert.equal(importRes.status, 200);

  const importedFlow = await dbGet(
    'SELECT * FROM chatbot_flows WHERE flow_name = ? AND user_id = 1',
    ['Imported RAG Flow']
  );
  assert.ok(importedFlow);

  const importedSource = await dbGet(
    'SELECT * FROM rag_sources WHERE flow_id = ? AND user_id = 1',
    [importedFlow.id]
  );
  assert.ok(importedSource);
  assert.equal(importedSource.source_type, 'flow');
  assert.equal(importedSource.current_revision, 1);
  assert.equal(importedSource.is_active, 1);

  const importedJob = await dbGet(
    'SELECT * FROM rag_index_jobs WHERE source_id = ? AND requested_revision = 1',
    [importedSource.id]
  );
  assert.ok(importedJob);
  assert.equal(importedJob.status, 'PENDING');

  const importedMapping = await dbAll(
    'SELECT session_id FROM rag_session_sources WHERE source_id = ?',
    [importedSource.id]
  );
  assert.equal(importedMapping.length, 1);
  assert.equal(importedMapping[0].session_id, importSessionId);
});

