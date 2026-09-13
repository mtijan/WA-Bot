import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import { serializeEmbeddingVector } from '../src/services/chatbot_ai_embedding.service.js';
import {
  deduplicateAndDiversifyRagResults,
  reciprocalRankFusion,
  searchRagLexical,
  searchRagSemantic
} from '../src/services/chatbot_ai_rag_retriever.service.js';
import {
  RAG_CONTEXT_DEFAULTS,
  retrieveRagContext
} from '../src/services/chatbot_ai_rag_context.service.js';
import {
  calibrateRagRelevanceThreshold,
  evaluateRagRetrievalOutcomes,
  validateRagEvaluationDataset
} from '../src/services/chatbot_ai_rag_evaluation.service.js';

const rawEvaluationCases = JSON.parse(readFileSync(
  new URL('./fixtures/rag_retrieval_evaluation.json', import.meta.url),
  'utf8'
));
const evaluationCases = validateRagEvaluationDataset(rawEvaluationCases);
const DATASET_SHA256 = 'a7adfa83ae6ea0633764cf2190e4f525532ad3a9310c9a4043bf1c8db565c202';
const silentLogger = { log() {} };
const SESSION_ID = 'evaluation-session';

const SOURCES = Object.freeze([
  [301, 'Biaya pendaftaran program reguler adalah Rp150.000. Formulir resmi tersedia di https://daftar.example.id.'],
  [302, 'Pendaftaran mahasiswa baru dibuka 1 Agustus 2026 dan ditutup 30 September 2026.'],
  [303, 'Syarat pendaftaran meliputi KTP, kartu keluarga, ijazah, dan pas foto.'],
  [304, 'Beasiswa prestasi memberikan potongan biaya kuliah 50 persen bagi peserta berprestasi.'],
  [305, 'Kelas daring menggunakan Zoom dan portal belajar setiap hari Sabtu.'],
  [306, 'Layanan bantuan admisi dapat dihubungi melalui WhatsApp 0812-0000-1234.'],
  [307, 'Pembayaran dapat dilakukan melalui transfer bank BCA atau virtual account.'],
  [308, 'Program studi tersedia: Manajemen, Akuntansi, dan Sistem Informasi.']
]);

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
  vector,
  profileId,
  profileHash
}) {
  await run(
    db,
    `INSERT INTO chatbot_flows (
       id, flow_name, session_ids, keywords, nodes, status, user_id
     ) VALUES (?, ?, ?, 'evaluasi', '[]', 'ACTIVE', ?)`,
    [id, `Flow Evaluasi ${id}`, JSON.stringify([sessionId]), userId]
  );
  await run(
    db,
    `INSERT INTO rag_sources (
       id, user_id, source_type, flow_id, content_hash, current_revision,
       indexed_revision, lexical_status, embedding_status, embedding_profile_id, is_active
     ) VALUES (?, ?, 'flow', ?, ?, 1, 1, 'READY', 'READY', ?, 1)`,
    [id, userId, id, `source-${id}`, profileId]
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
     ) VALUES (?, ?, ?, 1, 0, ?, 24, ?, ?, ?, 'evaluation-model', 8, ?)`,
    [
      id * 10,
      id,
      userId,
      text,
      JSON.stringify({
        flow_id: id,
        flow_name: `Flow Evaluasi ${id}`,
        node_id: `node-${id}`,
        node_name: 'Jawaban',
        branch_path: ['root', `source-${id}`],
        session_id: sessionId,
        internal_note: 'tidak boleh masuk provenance'
      }),
      `chunk-${id}`,
      serializeEmbeddingVector(vector),
      profileHash
    ]
  );
}

async function createFixture() {
  const db = new sqlite3.Database(':memory:');
  await runMigrations(db, { logger: silentLogger });
  await run(db, 'DELETE FROM users');
  await run(
    db,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
     VALUES (1, 'evaluation-owner', 'hash-1', 'Evaluation Owner', 'admin', 1),
            (2, 'other-tenant', 'hash-2', 'Other Tenant', 'user', 1)`
  );
  await run(
    db,
    `INSERT INTO sessions (session_id, status, user_id)
     VALUES (?, 'CONNECTED', 1),
            ('other-owned-session', 'CONNECTED', 1),
            ('other-session', 'CONNECTED', 2)`,
    [SESSION_ID]
  );
  await run(
    db,
    `INSERT INTO rag_embedding_profiles (
       id, user_id, model, dimensions, config_hash, capability_status
     ) VALUES (31, 1, 'evaluation-model', 8, 'evaluation-profile', 'SUPPORTED'),
              (91, 2, 'evaluation-model', 8, 'other-profile', 'SUPPORTED')`
  );
  await run(
    db,
    `INSERT INTO chatbot_ai_settings (
       session_id, user_id, rag_mode, embedding_profile_id
     ) VALUES (?, 1, 'hybrid', 31),
              ('other-owned-session', 1, 'hybrid', 31),
              ('other-session', 2, 'hybrid', 91)`,
    [SESSION_ID]
  );
  for (let index = 0; index < SOURCES.length; index += 1) {
    const vector = Array(8).fill(0);
    vector[index] = 1;
    await insertSource(db, {
      id: SOURCES[index][0],
      userId: 1,
      sessionId: SESSION_ID,
      text: SOURCES[index][1],
      vector,
      profileId: 31,
      profileHash: 'evaluation-profile'
    });
  }
  await insertSource(db, {
    id: 902,
    userId: 1,
    sessionId: 'other-owned-session',
    text: 'Promo rahasia sesi bayangan hanya berlaku pada sesi lain milik tenant yang sama.',
    vector: [0, 1, 0, 0, 0, 0, 0, 0],
    profileId: 31,
    profileHash: 'evaluation-profile'
  });
  await insertSource(db, {
    id: 901,
    userId: 2,
    sessionId: 'other-session',
    text: 'Kode rahasia tenant omega memberi diskon khusus sembilan puluh sembilan persen dan nomor privat.',
    vector: [1, 0, 0, 0, 0, 0, 0, 0],
    profileId: 91,
    profileHash: 'other-profile'
  });
  return { db, client: createClient(db) };
}

async function retrieveCandidates(item, client) {
  const lexicalResults = await searchRagLexical({
    userId: 1,
    sessionId: SESSION_ID,
    query: item.query
  }, client);
  const semanticResults = await searchRagSemantic({
    userId: 1,
    sessionId: SESSION_ID,
    queryVector: new Float32Array(item.vector)
  }, client);
  return deduplicateAndDiversifyRagResults(reciprocalRankFusion({
    lexicalResults,
    semanticResults
  }));
}

test('RAG-0901 sampai RAG-0904 mengunci dataset, pola chat, klaim, dan negative isolation', () => {
  assert.equal(
    createHash('sha256').update(JSON.stringify(rawEvaluationCases)).digest('hex'),
    DATASET_SHA256,
    'dataset berubah tanpa pembaruan baseline yang disengaja'
  );
  assert.equal(evaluationCases.length, 50);
  assert.deepEqual(
    Object.fromEntries([...new Set(evaluationCases.map((item) => item.category))]
      .map((category) => [
        category,
        evaluationCases.filter((item) => item.category === category).length
      ])),
    {
      exact: 15,
      synonym: 10,
      typo: 5,
      multi_source: 5,
      follow_up: 5,
      out_of_scope: 5,
      adversarial_tenant: 5
    }
  );

  const requiredClaimTypes = new Set(evaluationCases.flatMap((item) => item.claim_types));
  for (const claimType of ['price', 'link', 'contact']) {
    assert.ok(requiredClaimTypes.has(claimType), `dataset belum mencakup ${claimType}`);
  }
  assert.equal(
    evaluationCases.filter((item) => item.category === 'multi_source')
      .every((item) => item.gold_source_ids.length >= 2 && item.required_claims.length >= 2),
    true
  );
  assert.equal(
    evaluationCases.filter((item) => item.category === 'adversarial_tenant').length,
    5
  );
});

test('RAG-0510/RAG-0905 mengukur Top-1, Top-3, negative rejection, dan klaim aktual', async (t) => {
  const { db, client } = await createFixture();
  try {
    const candidatesById = new Map();
    for (const item of evaluationCases) {
      candidatesById.set(item.id, await retrieveCandidates(item, client));
    }
    const calibrationCases = evaluationCases
      .filter((item) => item.calibration)
      .map((item) => ({
        expected_relevant: item.gold_source_ids.length > 0,
        top_score: candidatesById.get(item.id)[0]?.relevance_score || 0
      }));
    assert.equal(calibrationCases.length, 20);
    const calibration = calibrateRagRelevanceThreshold(calibrationCases, {
      minimumRecall: 0.9,
      maximumFalsePositiveRate: 0
    });
    assert.ok(Math.abs(calibration.threshold - RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD) < 0.000001);

    const outcomes = [];
    for (const item of evaluationCases) {
      const result = await retrieveRagContext({
        userId: 1,
        sessionId: SESSION_ID,
        query: item.query,
        queryVector: new Float32Array(item.vector),
        relevanceThreshold: calibration.threshold,
        topK: 4,
        contextTokenBudget: 1000,
        baseInputTokens: 120
      }, client);
      const retrievedSourceIds = result.results.map((candidate) => candidate.source_id);
      outcomes.push({ item, result, retrievedSourceIds });
      assert.ok(result.context_tokens <= 1000, `${item.id}: context melewati budget`);
      assert.ok(result.estimated_total_input_tokens <= 2200, `${item.id}: input melewati hard budget`);
      assert.equal(
        result.results.some((candidate) => [901, 902].includes(candidate.source_id)),
        false,
        `${item.id}: cross-tenant source bocor`
      );
      for (const candidate of result.results) {
        assert.equal('session_id' in candidate.provenance, false);
        assert.equal('internal_note' in candidate.provenance, false);
      }
      for (const requiredClaim of item.required_claims) {
        assert.ok(
          result.context.toLocaleLowerCase('id-ID').includes(requiredClaim.toLocaleLowerCase('id-ID')),
          `${item.id}: klaim wajib '${requiredClaim}' tidak tersedia di context aktual`
        );
      }
    }

    const metrics = evaluateRagRetrievalOutcomes(outcomes.map(({ item, retrievedSourceIds }) => ({
      id: item.id,
      category: item.category,
      gold_source_ids: item.gold_source_ids,
      retrieved_source_ids: retrievedSourceIds
    })));
    assert.equal(metrics.answerable_cases, 35);
    assert.equal(metrics.negative_cases, 15);
    assert.ok(metrics.top_1_accuracy >= 0.9, `top-1 accuracy hanya ${metrics.top_1_accuracy}`);
    assert.ok(metrics.top_3_accuracy >= 0.9, `top-3 accuracy hanya ${metrics.top_3_accuracy}`);
    assert.equal(metrics.negative_rejection_rate, 1);
    assert.deepEqual(metrics.failed_case_ids, []);

    const priceCase = outcomes.find(({ item }) => item.id === 'EX-02');
    const urlCase = outcomes.find(({ item }) => item.id === 'EX-03');
    const contactCase = outcomes.find(({ item }) => item.id === 'EX-12');
    assert.match(priceCase.result.context, /Rp150\.000/);
    assert.match(urlCase.result.context, /https:\/\/daftar\.example\.id/);
    assert.match(contactCase.result.context, /WhatsApp 0812-0000-1234/);

    t.diagnostic(`calibrated_threshold=${calibration.threshold.toFixed(6)}`);
    t.diagnostic(`top1_accuracy=${(metrics.top_1_accuracy * 100).toFixed(2)}%`);
    t.diagnostic(`top3_accuracy=${(metrics.top_3_accuracy * 100).toFixed(2)}%`);
    t.diagnostic(`negative_rejection=${(metrics.negative_rejection_rate * 100).toFixed(2)}%`);
    t.diagnostic(`category_results=${JSON.stringify(metrics.by_category)}`);
    t.diagnostic(`case_results=${JSON.stringify(outcomes.map(({ item, retrievedSourceIds }) => ({
      id: item.id,
      query: item.query,
      gold: item.gold_source_ids,
      top_3: retrievedSourceIds.slice(0, 3)
    })))}`);
  } finally {
    await close(db);
  }
});
