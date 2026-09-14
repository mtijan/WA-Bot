import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import sqlite3 from 'sqlite3';
import { runMigrations } from '../../src/migrations/index.js';
import { serializeEmbeddingVector } from '../../src/services/chatbot_ai_embedding.service.js';
import {
  deduplicateAndDiversifyRagResults,
  reciprocalRankFusion,
  searchRagLexical,
  searchRagSemantic
} from '../../src/services/chatbot_ai_rag_retriever.service.js';
import { retrieveRagContext } from '../../src/services/chatbot_ai_rag_context.service.js';
import { validateRagEvaluationDataset } from '../../src/services/chatbot_ai_rag_evaluation.service.js';

export const RAW_EVALUATION_CASES = Object.freeze(JSON.parse(readFileSync(
  new URL('../fixtures/rag_retrieval_evaluation.json', import.meta.url),
  'utf8'
)));
export const EVALUATION_CASES = validateRagEvaluationDataset(RAW_EVALUATION_CASES);
export const EVALUATION_DATASET_SHA256 =
  'a7adfa83ae6ea0633764cf2190e4f525532ad3a9310c9a4043bf1c8db565c202';
export const EVALUATION_SESSION_ID = 'evaluation-session';

export const EVALUATION_SOURCES = Object.freeze([
  Object.freeze({
    id: 301,
    text: 'Biaya pendaftaran program reguler adalah Rp150.000. Formulir resmi tersedia di https://daftar.example.id.'
  }),
  Object.freeze({
    id: 302,
    text: 'Pendaftaran mahasiswa baru dibuka 1 Agustus 2026 dan ditutup 30 September 2026.'
  }),
  Object.freeze({
    id: 303,
    text: 'Syarat pendaftaran meliputi KTP, kartu keluarga, ijazah, dan pas foto.'
  }),
  Object.freeze({
    id: 304,
    text: 'Beasiswa prestasi memberikan potongan biaya kuliah 50 persen bagi peserta berprestasi.'
  }),
  Object.freeze({
    id: 305,
    text: 'Kelas daring menggunakan Zoom dan portal belajar setiap hari Sabtu.'
  }),
  Object.freeze({
    id: 306,
    text: 'Layanan bantuan admisi dapat dihubungi melalui WhatsApp 0812-0000-1234.'
  }),
  Object.freeze({
    id: 307,
    text: 'Pembayaran dapat dilakukan melalui transfer bank BCA atau virtual account.'
  }),
  Object.freeze({
    id: 308,
    text: 'Program studi tersedia: Manajemen, Akuntansi, dan Sistem Informasi.'
  })
]);

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
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
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

export async function createRagEvaluationFixture() {
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
    [EVALUATION_SESSION_ID]
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
    [EVALUATION_SESSION_ID]
  );
  for (let index = 0; index < EVALUATION_SOURCES.length; index += 1) {
    const vector = Array(8).fill(0);
    vector[index] = 1;
    await insertSource(db, {
      ...EVALUATION_SOURCES[index],
      userId: 1,
      sessionId: EVALUATION_SESSION_ID,
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

export async function closeRagEvaluationFixture(db) {
  await new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function retrieveRagEvaluationCandidates(item, client) {
  const lexicalResults = await searchRagLexical({
    userId: 1,
    sessionId: EVALUATION_SESSION_ID,
    query: item.query
  }, client);
  const semanticResults = await searchRagSemantic({
    userId: 1,
    sessionId: EVALUATION_SESSION_ID,
    queryVector: new Float32Array(item.vector)
  }, client);
  return deduplicateAndDiversifyRagResults(reciprocalRankFusion({
    lexicalResults,
    semanticResults
  }));
}

export async function retrieveRagEvaluationContext(item, client, options = {}) {
  return retrieveRagContext({
    userId: 1,
    sessionId: EVALUATION_SESSION_ID,
    query: item.query,
    queryVector: new Float32Array(item.vector),
    topK: 4,
    contextTokenBudget: 1000,
    baseInputTokens: 120,
    ...options
  }, client);
}

export function verifyRagEvaluationDatasetDigest() {
  return createHash('sha256').update(JSON.stringify(RAW_EVALUATION_CASES)).digest('hex')
    === EVALUATION_DATASET_SHA256;
}
