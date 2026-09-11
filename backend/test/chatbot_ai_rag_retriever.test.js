import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const testTmpDir = mkdtempSync(join(tmpdir(), 'wa-bot-rag-retriever-env-'));
process.env.WA_BOT_DB_PATH = join(testTmpDir, 'test.sqlite');

import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import { serializeEmbeddingVector } from '../src/services/chatbot_ai_embedding.service.js';
import {
  deduplicateAndDiversifyRagResults,
  normalizeIndonesianQuery,
  reciprocalRankFusion,
  searchRagLexical,
  searchRagSemantic
} from '../src/services/chatbot_ai_rag_retriever.service.js';

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
    all: (sql, params) => all(db, sql, params)
  };
}

async function insertSource(db, {
  id,
  userId,
  sessionId,
  text,
  contentHash,
  vector,
  profileId,
  profileHash,
  sourceType = 'manual',
  lexicalStatus = 'READY',
  embeddingStatus = 'READY',
  indexedRevision = 1,
  currentRevision = 1,
  isActive = 1
}) {
  const flowId = sourceType === 'flow' ? id : null;
  const manualSessionId = sourceType === 'manual' ? sessionId : null;
  if (sourceType === 'flow') {
    await run(
      db,
      `INSERT INTO chatbot_flows (
         id, flow_name, session_ids, keywords, nodes, status, user_id
       ) VALUES (?, ?, ?, 'admisi', '[]', 'ACTIVE', ?)`,
      [id, `Flow ${id}`, JSON.stringify([sessionId]), userId]
    );
  }
  await run(
    db,
    `INSERT INTO rag_sources (
       id, user_id, source_type, flow_id, manual_session_id, content_hash,
       current_revision, indexed_revision, lexical_status, embedding_status,
       embedding_profile_id, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      sourceType,
      flowId,
      manualSessionId,
      contentHash,
      currentRevision,
      indexedRevision,
      lexicalStatus,
      embeddingStatus,
      profileId,
      isActive
    ]
  );
  await run(
    db,
    `INSERT INTO rag_session_sources (session_id, source_id, user_id)
     VALUES (?, ?, ?)`,
    [sessionId, id, userId]
  );
  await run(
    db,
    `INSERT INTO rag_chunks (
       id, source_id, user_id, source_revision, chunk_index, chunk_text,
       token_count, metadata_json, content_hash, embedding, embedding_model,
       embedding_dimensions, embedding_config_hash
     ) VALUES (?, ?, ?, ?, 0, ?, 12, ?, ?, ?, 'text-embedding-3-small', 3, ?)`,
    [
      id * 10,
      id,
      userId,
      currentRevision,
      text,
      JSON.stringify({ source_type: sourceType, session_id: sessionId, flow_id: flowId }),
      `${contentHash}-chunk`,
      serializeEmbeddingVector(vector),
      profileHash
    ]
  );
}

async function withRetrieverFixture(callback) {
  const db = openDatabase(':memory:');
  try {
    await runMigrations(db, { logger: silentLogger });
    await run(db, 'DELETE FROM users');
    await run(
      db,
      `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
       VALUES (1, 'tenant-one', 'hash-1', 'Tenant One', 'admin', 1),
              (2, 'tenant-two', 'hash-2', 'Tenant Two', 'user', 1)`
    );
    await run(
      db,
      `INSERT INTO sessions (session_id, status, user_id)
       VALUES ('session-a', 'CONNECTED', 1),
              ('session-b', 'CONNECTED', 1),
              ('session-c', 'CONNECTED', 2)`
    );
    await run(
      db,
      `INSERT INTO rag_embedding_profiles (
         id, user_id, model, dimensions, config_hash, capability_status
       ) VALUES (10, 1, 'text-embedding-3-small', 3, 'profile-one', 'SUPPORTED'),
                (20, 2, 'text-embedding-3-small', 3, 'profile-two', 'SUPPORTED')`
    );
    await run(
      db,
      `INSERT INTO chatbot_ai_settings (
         session_id, user_id, rag_mode, embedding_profile_id
       ) VALUES ('session-a', 1, 'hybrid', 10),
                ('session-b', 1, 'hybrid', 10),
                ('session-c', 2, 'hybrid', 20)`
    );

    await insertSource(db, {
      id: 100,
      userId: 1,
      sessionId: 'session-a',
      text: 'Biaya pendaftaran program reguler adalah Rp150.000 melalui https://daftar.example.id.',
      contentHash: 'source-a-price',
      vector: [1, 0, 0],
      profileId: 10,
      profileHash: 'profile-one'
    });
    await insertSource(db, {
      id: 101,
      userId: 1,
      sessionId: 'session-a',
      sourceType: 'flow',
      text: 'Jadwal penerimaan mahasiswa baru ditutup tanggal 30 September 2026.',
      contentHash: 'source-a-schedule',
      vector: [0, 1, 0],
      profileId: 10,
      profileHash: 'profile-one'
    });
    await insertSource(db, {
      id: 110,
      userId: 1,
      sessionId: 'session-b',
      text: 'Biaya pendaftaran rahasia sesi lain adalah Rp999.000.',
      contentHash: 'source-b-price',
      vector: [1, 0, 0],
      profileId: 10,
      profileHash: 'profile-one'
    });
    await insertSource(db, {
      id: 200,
      userId: 2,
      sessionId: 'session-c',
      text: 'Biaya pendaftaran tenant lain adalah Rp1.',
      contentHash: 'source-c-price',
      vector: [1, 0, 0],
      profileId: 20,
      profileHash: 'profile-two'
    });

    await callback({ client: createClient(db), db });
  } finally {
    await close(db);
  }
}

test.after(async () => {
  await rm(testTmpDir, { recursive: true, force: true });
});

test('query normalization: handles Indonesian casing, diacritics, punctuation, stop words, suffix, and duplicates', () => {
  const result = normalizeIndonesianQuery(
    'TOLONG, berapa BIAYANYA untuk Caf\u00e9 tahun 2026? Rp150.000, biaya!'
  );

  assert.deepEqual(result.tokens, ['biaya', 'cafe', 'tahun', '2026', 'rp150', '000']);
  assert.equal(result.normalized, 'biaya cafe tahun 2026 rp150 000');
  assert.equal(
    result.ftsQuery,
    '"biaya" OR "cafe" OR "tahun" OR "2026" OR "rp150" OR "000"'
  );
});

test('query normalization: keeps fallback tokens for an all-stop-word query and rejects empty input', () => {
  assert.deepEqual(normalizeIndonesianQuery('Apa dan bagaimana?').tokens, ['apa', 'dan', 'bagaimana']);
  assert.throws(
    () => normalizeIndonesianQuery('   !!!   '),
    (error) => error.code === 'RAG_RETRIEVAL_EMPTY_QUERY'
  );
});

test('lexical search: returns BM25-ranked exact terms only from the owned session scope before LIMIT', async () => {
  await withRetrieverFixture(async ({ client }) => {
    const results = await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'Berapa biaya pendaftaran?',
      candidateLimit: 1
    }, client);

    assert.equal(results.length, 1);
    assert.equal(results[0].source_id, 100);
    assert.match(results[0].chunk_text, /Rp150\.000/);
    assert.equal(results[0].lexical_rank, 1);
    assert.equal(results[0].retrieval_channel, 'lexical');
  });
});

test('lexical search: excludes inactive, stale, unassigned, other-session, and cross-tenant chunks', async () => {
  await withRetrieverFixture(async ({ client, db }) => {
    await insertSource(db, {
      id: 102,
      userId: 1,
      sessionId: 'session-a',
      sourceType: 'flow',
      text: 'Biaya pendaftaran dari source stale tidak boleh muncul.',
      contentHash: 'source-a-stale',
      vector: [1, 0, 0],
      profileId: 10,
      profileHash: 'profile-one',
      lexicalStatus: 'STALE',
      indexedRevision: 0
    });
    await insertSource(db, {
      id: 103,
      userId: 1,
      sessionId: 'session-a',
      sourceType: 'flow',
      text: 'Biaya pendaftaran dari source nonaktif tidak boleh muncul.',
      contentHash: 'source-a-inactive',
      vector: [1, 0, 0],
      profileId: 10,
      profileHash: 'profile-one',
      isActive: 0
    });

    const results = await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'biaya pendaftaran',
      candidateLimit: 20
    }, client);

    assert.deepEqual(results.map((item) => item.source_id), [100]);
    assert.ok(results.every((item) => item.source_id !== 110 && item.source_id !== 200));
  });
});

test('lexical search: FTS update and delete triggers are reflected in actual retrieval', async () => {
  await withRetrieverFixture(async ({ client, db }) => {
    await run(
      db,
      `UPDATE rag_chunks SET chunk_text = 'Kontak admisi resmi ada di situs kampus.' WHERE id = 1000`
    );
    assert.equal((await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'biaya pendaftaran'
    }, client)).length, 0);
    assert.equal((await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'kontak admisi'
    }, client))[0].chunk_id, 1000);

    await run(db, 'DELETE FROM rag_chunks WHERE id = 1000');
    assert.equal((await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'kontak admisi'
    }, client)).length, 0);
  });
});

test('lexical search: rejects a forged tenant/session pair and invalid source type', async () => {
  await withRetrieverFixture(async ({ client }) => {
    await assert.rejects(
      searchRagLexical({ userId: 2, sessionId: 'session-a', query: 'biaya' }, client),
      (error) => error.code === 'RAG_RETRIEVAL_SESSION_NOT_FOUND'
    );
    await assert.rejects(
      searchRagLexical({
        userId: 1,
        sessionId: 'session-a',
        query: 'biaya',
        sourceTypes: ['flow', 'unknown']
      }, client),
      (error) => error.code === 'RAG_RETRIEVAL_INVALID_SOURCE_TYPE'
    );
  });
});

test('retrieval source mode: lexical and semantic searches honor manual/flow selection', async () => {
  await withRetrieverFixture(async ({ client }) => {
    const lexicalManual = await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'pendaftaran mahasiswa',
      sourceTypes: ['manual']
    }, client);
    const lexicalFlow = await searchRagLexical({
      userId: 1,
      sessionId: 'session-a',
      query: 'pendaftaran mahasiswa',
      sourceTypes: ['flow']
    }, client);
    const semanticFlow = await searchRagSemantic({
      userId: 1,
      sessionId: 'session-a',
      queryVector: [0, 1, 0],
      sourceTypes: ['flow']
    }, client);

    assert.deepEqual(lexicalManual.map((item) => item.source_id), [100]);
    assert.deepEqual(lexicalFlow.map((item) => item.source_id), [101]);
    assert.deepEqual(semanticFlow.map((item) => item.source_id), [101]);
  });
});

test('semantic search: ranks current vectors and excludes other sessions and tenants', async () => {
  await withRetrieverFixture(async ({ client }) => {
    const results = await searchRagSemantic({
      userId: 1,
      sessionId: 'session-a',
      queryVector: new Float32Array([1, 0, 0])
    }, client);

    assert.deepEqual(results.map((item) => item.source_id), [100, 101]);
    assert.equal(results[0].semantic_score, 1);
    assert.equal(results[1].semantic_score, 0);
    assert.ok(results.every((item) => item.source_id !== 110 && item.source_id !== 200));
  });
});

test('semantic search: excludes stale profile vectors and requires a supported active profile', async () => {
  await withRetrieverFixture(async ({ client, db }) => {
    await run(db, `UPDATE rag_chunks SET embedding_config_hash = 'old-profile' WHERE id = 1010`);
    const results = await searchRagSemantic({
      userId: 1,
      sessionId: 'session-a',
      queryVector: [1, 0, 0]
    }, client);
    assert.deepEqual(results.map((item) => item.source_id), [100]);

    await run(db, `UPDATE rag_embedding_profiles SET capability_status = 'FAILED' WHERE id = 10`);
    await assert.rejects(
      searchRagSemantic({
        userId: 1,
        sessionId: 'session-a',
        queryVector: [1, 0, 0]
      }, client),
      (error) => error.code === 'RAG_RETRIEVAL_EMBEDDING_UNAVAILABLE'
    );
  });
});

test('reciprocal rank fusion: rewards chunks found by both channels and is deterministic', () => {
  const lexicalResults = [
    { chunk_id: 1, chunk_text: 'lexical first', lexical_score: 0.9 },
    { chunk_id: 2, chunk_text: 'lexical second', lexical_score: 0.8 }
  ];
  const semanticResults = [
    { chunk_id: 2, chunk_text: 'semantic first', semantic_score: 0.95 },
    { chunk_id: 3, chunk_text: 'semantic second', semantic_score: 0.7 }
  ];

  const fused = reciprocalRankFusion({ lexicalResults, semanticResults, rrfK: 60 });

  assert.deepEqual(fused.map((item) => item.chunk_id), [2, 1, 3]);
  assert.deepEqual(fused[0].retrieval_channels, ['lexical', 'semantic']);
  assert.equal(fused[0].lexical_rank, 2);
  assert.equal(fused[0].semantic_rank, 1);
  assert.ok(fused[0].rrf_score > fused[1].rrf_score);
});

test('deduplication/MMR: removes repeated knowledge and promotes a diverse second result', () => {
  const results = [
    {
      chunk_id: 1,
      content_hash: 'same-answer',
      chunk_text: 'Biaya daftar mahasiswa baru secara online',
      rrf_score: 1
    },
    {
      chunk_id: 4,
      content_hash: 'same-answer',
      chunk_text: 'Biaya daftar mahasiswa baru secara online',
      rrf_score: 0.99
    },
    {
      chunk_id: 2,
      content_hash: 'similar-answer',
      chunk_text: 'Biaya daftar mahasiswa baru melalui daring',
      rrf_score: 0.95
    },
    {
      chunk_id: 3,
      content_hash: 'different-answer',
      chunk_text: 'Jadwal kelas malam berlangsung hari Sabtu',
      rrf_score: 0.8
    }
  ];

  const selected = deduplicateAndDiversifyRagResults(results, { lambda: 0.4 });

  assert.deepEqual(selected.map((item) => item.chunk_id), [1, 3, 2]);
  assert.deepEqual(selected.map((item) => item.mmr_rank), [1, 2, 3]);
  assert.ok(selected[2].max_selected_similarity > selected[1].max_selected_similarity);
});
