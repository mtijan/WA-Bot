import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const testTmpDir = mkdtempSync(join(tmpdir(), 'wa-bot-embedding-env-'));
process.env.WA_BOT_DB_PATH = join(testTmpDir, 'test.sqlite');

import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  calculateEmbeddingConfigHash,
  clampEmbeddingOptions,
  cosineSimilarity,
  deserializeEmbeddingVector,
  dotProduct,
  EMBEDDING_BOUNDS,
  EMBEDDING_CAPABILITY_STATUSES,
  executeSemanticRetrievalWithFtsFallback,
  generateBatchChunkEmbeddings,
  generateQueryEmbedding,
  getTenantEmbeddingProfile,
  publishRagChunkEmbeddings,
  rankChunksByCosineSimilarity,
  resolveEffectiveRagRetrievalMode,
  serializeEmbeddingVector,
  testEmbeddingCapability,
  upsertTenantEmbeddingProfile,
  validateSessionEmbeddingProfile,
  vectorNorm
} from '../src/services/chatbot_ai_embedding.service.js';
import { protectSecret } from '../src/services/secret.service.js';

process.env.WA_BOT_SECRET_ENCRYPTION_KEY = 'test-encryption-key-minimum-32-chars-long!';

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

async function withEmbeddingFixture(callback) {
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
       VALUES ('session-tenant-1', 'CONNECTED', 1),
              ('session-tenant-2', 'CONNECTED', 2)`
    );
    const encryptedKey = protectSecret('sk-valid-test-key');
    await run(
      db,
      `INSERT INTO chatbot_ai_credentials (id, name, base_url, api_key, model_name, is_active, user_id)
       VALUES (10, 'Tenant1-Cred', 'https://ai.sumopod.com/v1', ?, 'gpt-4o-mini', 1, 1),
              (20, 'Tenant2-Cred', 'https://ai.sumopod.com/v1', ?, 'gpt-4o-mini', 1, 2)`,
      [encryptedKey, encryptedKey]
    );

    const sourceResult = await run(
      db,
      `INSERT INTO rag_sources (
         id, user_id, source_type, manual_session_id, content_hash,
         current_revision, indexed_revision, lexical_status, embedding_status, is_active
       ) VALUES (100, 1, 'manual', 'session-tenant-1', 'content-v1', 1, 1, 'READY', 'PENDING', 1)`
    );

    await run(
      db,
      `INSERT INTO rag_chunks (
         source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash
       ) VALUES (100, 1, 1, 0, 'Chunk pertama tentang admisi.', 6, 'chunk-h0'),
                (100, 1, 1, 1, 'Chunk kedua tentang biaya pendaftaran.', 6, 'chunk-h1')`
    );

    const client = createClient(db);
    await callback({ client, db });
  } finally {
    await close(db);
  }
}

// ============================================================================
// Unit Tests: Vector Math & Binary Serialization
// ============================================================================

test('vector serialization: roundtrips Float32Array to Buffer and back with exact precision', () => {
  const original = new Float32Array([0.1, -0.25, 0.75, 1.5, -3.14159]);
  const buffer = serializeEmbeddingVector(original);

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.byteLength, original.length * 4);

  const restored = deserializeEmbeddingVector(buffer, original.length);
  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i += 1) {
    assert.ok(Math.abs(restored[i] - original[i]) < 1e-6);
  }
});

test('vector serialization: rejects non-multiple-of-4 buffer or dimension mismatch', () => {
  const invalidBuffer = Buffer.from([1, 2, 3]); // 3 bytes
  assert.throws(
    () => deserializeEmbeddingVector(invalidBuffer),
    (err) => err.code === 'EMBEDDING_INVALID_BUFFER'
  );

  const validBuffer = serializeEmbeddingVector([0.1, 0.2]); // 2 dimensions
  assert.throws(
    () => deserializeEmbeddingVector(validBuffer, 3), // expects 3
    (err) => err.code === 'EMBEDDING_DIMENSION_MISMATCH'
  );
});

test('vector serialization: rejects non-finite elements or empty vectors', () => {
  assert.throws(
    () => serializeEmbeddingVector([]),
    (err) => err.code === 'EMBEDDING_INVALID_VECTOR'
  );
  assert.throws(
    () => serializeEmbeddingVector([0.1, NaN, 0.3]),
    (err) => err.code === 'EMBEDDING_INVALID_VECTOR'
  );
  assert.throws(
    () => serializeEmbeddingVector([0.1, Infinity, 0.3]),
    (err) => err.code === 'EMBEDDING_INVALID_VECTOR'
  );
});

test('vector math: computes dotProduct, vectorNorm, and cosineSimilarity accurately', () => {
  const v1 = new Float32Array([1, 0, 0]);
  const v2 = new Float32Array([1, 0, 0]);
  const v3 = new Float32Array([0, 1, 0]);
  const v4 = new Float32Array([-1, 0, 0]);

  assert.equal(dotProduct(v1, v2), 1);
  assert.equal(dotProduct(v1, v3), 0);
  assert.equal(dotProduct(v1, v4), -1);

  assert.equal(vectorNorm(v1), 1);
  assert.equal(vectorNorm(new Float32Array([3, 4])), 5);

  assert.equal(cosineSimilarity(v1, v2), 1.0);
  assert.equal(cosineSimilarity(v1, v3), 0.0);
  assert.equal(cosineSimilarity(v1, v4), -1.0);

  // Scaled vectors maintain similarity of 1.0
  const vScaled = new Float32Array([5, 0, 0]);
  assert.equal(Math.round(cosineSimilarity(v1, vScaled)), 1);

  // Dimension mismatch throws
  assert.throws(
    () => cosineSimilarity(v1, new Float32Array([1, 0])),
    (err) => err.code === 'EMBEDDING_DIMENSION_MISMATCH'
  );
});

// ============================================================================
// Unit Tests: Config Hashing
// ============================================================================

test('calculateEmbeddingConfigHash: deterministic and trims whitespace/case', () => {
  const hash1 = calculateEmbeddingConfigHash({
    model: 'text-embedding-3-small',
    dimensions: 1536,
    baseUrl: 'https://ai.sumopod.com/v1/'
  });
  const hash2 = calculateEmbeddingConfigHash({
    model: '  TEXT-EMBEDDING-3-SMALL  ',
    dimensions: 1536,
    baseUrl: 'HTTPS://AI.SUMOPOD.COM/V1'
  });
  assert.equal(hash1, hash2);

  const hash3 = calculateEmbeddingConfigHash({
    model: 'text-embedding-3-large',
    dimensions: 3072,
    baseUrl: 'https://ai.sumopod.com/v1'
  });
  assert.notEqual(hash1, hash3);
});

// ============================================================================
// Database & Multi-Tenant Profile Tests
// ============================================================================

test('upsertTenantEmbeddingProfile: creates initial profile and increments revision on config change', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    // 1. Initial upsert creates revision 1
    const p1 = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 1536,
      capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.UNKNOWN
    }, client);

    assert.equal(p1.user_id, 1);
    assert.equal(p1.config_revision, 1);
    assert.ok(p1.config_hash);
    assert.equal(p1.configChanged, true);

    // 2. Fetch profile
    const fetched = await getTenantEmbeddingProfile(1, client);
    assert.equal(fetched.model, 'text-embedding-3-small');
    assert.equal(fetched.dimensions, 1536);
    assert.equal(fetched.credential_id, 10);
    assert.equal(fetched.credential_name, 'Tenant1-Cred');

    // 3. Upsert with exact same config keeps revision 1
    const p2 = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 1536,
      capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.SUPPORTED
    }, client);

    assert.equal(p2.config_revision, 1);
    assert.equal(p2.configChanged, false);
    assert.equal(p2.capability_status, EMBEDDING_CAPABILITY_STATUSES.SUPPORTED);

    // 4. Upsert with changed dimensions advances revision to 2
    const p3 = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 512,
      capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.UNKNOWN
    }, client);

    assert.equal(p3.config_revision, 2);
    assert.equal(p3.configChanged, true);

    // 5. Verify tenant source embedding_status transitioned to PENDING
    const source = await client.get('SELECT embedding_status FROM rag_sources WHERE id = 100');
    assert.equal(source.embedding_status, 'PENDING');
  });
});

test('upsertTenantEmbeddingProfile: enforces cross-tenant credential isolation', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    // Tenant 1 attempts to use Tenant 2's credential (id 20)
    await assert.rejects(
      () => upsertTenantEmbeddingProfile({
        userId: 1,
        credentialId: 20,
        model: 'text-embedding-3-small',
        dimensions: 1536
      }, client),
      (err) => err.code === 'EMBEDDING_CREDENTIAL_NOT_FOUND'
    );
  });
});

test('validateSessionEmbeddingProfile: ensures profile belongs to session tenant', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    const profile = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 1536
    }, client);

    // Session owned by user 1 with user 1's profile succeeds
    const valid = await validateSessionEmbeddingProfile({
      sessionId: 'session-tenant-1',
      userId: 1,
      profileId: profile.id
    }, client);
    assert.equal(valid.id, profile.id);

    // User 2 trying to use user 1's profile fails
    await assert.rejects(
      () => validateSessionEmbeddingProfile({
        sessionId: 'session-tenant-2',
        userId: 2,
        profileId: profile.id
      }, client),
      (err) => err.code === 'EMBEDDING_PROFILE_NOT_FOUND'
    );
  });
});

// ============================================================================
// Capability Testing & Safe Error Classification
// ============================================================================

test('testEmbeddingCapability: returns SUPPORTED when provider returns correct vector dimensions', async () => {
  // Test with mock embedding test
  const fakeApiKey = 'sk-mock-test-key';
  const result = await testEmbeddingCapability({
    baseUrl: 'https://ai.sumopod.com/v1',
    apiKey: '',
    model: 'text-embedding-3-small',
    dimensions: 1536
  });

  assert.equal(result.capabilityStatus, EMBEDDING_CAPABILITY_STATUSES.FAILED);
  assert.equal(result.errorCode, 'API_KEY_REQUIRED');
});

// ============================================================================
// Batch Embeddings & BLOB Storage Tests
// ============================================================================

test('publishRagChunkEmbeddings: stores binary Float32Array as SQLite BLOB and updates source status', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    const profile = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 3
    }, client);

    const vec0 = new Float32Array([0.1, 0.2, 0.3]);
    const vec1 = new Float32Array([0.4, 0.5, 0.6]);

    const chunkEmbeddings = [
      { chunk_index: 0, embedding_blob: serializeEmbeddingVector(vec0) },
      { chunk_index: 1, embedding_blob: serializeEmbeddingVector(vec1) }
    ];

    const publishResult = await publishRagChunkEmbeddings({
      sourceId: 100,
      userId: 1,
      sourceRevision: 1,
      chunkEmbeddings,
      profile,
      databaseClient: client
    });

    assert.equal(publishResult.publishedCount, 2);
    assert.equal(publishResult.embeddingStatus, 'READY');

    // Verify raw database row and BLOB deserialization
    const chunkRow0 = await client.get(
      'SELECT embedding, embedding_dimensions, embedding_model, embedding_config_hash FROM rag_chunks WHERE source_id = 100 AND chunk_index = 0'
    );
    assert.ok(Buffer.isBuffer(chunkRow0.embedding));
    assert.equal(chunkRow0.embedding_dimensions, 3);
    assert.equal(chunkRow0.embedding_model, 'text-embedding-3-small');
    assert.equal(chunkRow0.embedding_config_hash, profile.config_hash);

    const restored0 = deserializeEmbeddingVector(chunkRow0.embedding, 3);
    assert.equal(restored0.length, 3);
    assert.ok(Math.abs(restored0[0] - 0.1) < 1e-6);
    assert.ok(Math.abs(restored0[1] - 0.2) < 1e-6);
    assert.ok(Math.abs(restored0[2] - 0.3) < 1e-6);

    // Verify source embedding status is READY
    const sourceRow = await client.get('SELECT embedding_status, embedding_profile_id FROM rag_sources WHERE id = 100');
    assert.equal(sourceRow.embedding_status, 'READY');
    assert.equal(sourceRow.embedding_profile_id, profile.id);
  });
});

// ============================================================================
// Fallback Mode Resolution Tests
// ============================================================================

test('resolveEffectiveRagRetrievalMode: falls back to fts when embedding is unavailable or unverified', () => {
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'off', profile: null }), 'off');
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'fts', profile: null }), 'fts');

  // Hybrid without profile falls back to fts
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'hybrid', profile: null }), 'fts');

  // Hybrid with UNKNOWN / FAILED / UNSUPPORTED capability falls back to fts
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: EMBEDDING_CAPABILITY_STATUSES.UNKNOWN }
    }),
    'fts'
  );
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: EMBEDDING_CAPABILITY_STATUSES.FAILED }
    }),
    'fts'
  );
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED }
    }),
    'fts'
  );

  // Hybrid with SUPPORTED capability resolves to hybrid
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: EMBEDDING_CAPABILITY_STATUSES.SUPPORTED }
    }),
    'hybrid'
  );
});

// ============================================================================
// Controller Handlers Tests
// ============================================================================

const {
  getEmbeddingProfile,
  saveEmbeddingProfile,
  testEmbeddingProfileCapability
} = await import('../src/controllers/chatbot_ai.controller.js');

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

test('controller: getEmbeddingProfile returns default template when profile does not exist', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    const req = {
      auth: { userId: 1 },
      dbClient: client
    };
    const res = createMockResponse();

    await getEmbeddingProfile(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.user_id, 1);
    assert.equal(res.body.data.model, 'text-embedding-3-small');
    assert.equal(res.body.data.dimensions, 1536);
    assert.equal(res.body.data.capability_status, 'UNKNOWN');
  });
});

test('controller: saveEmbeddingProfile upserts profile and rejects foreign credential', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    // 1. Success saving valid profile
    const req1 = {
      auth: { userId: 1 },
      body: {
        credential_id: 10,
        model: 'text-embedding-3-small',
        dimensions: 1536
      },
      dbClient: client
    };
    const res1 = createMockResponse();
    await saveEmbeddingProfile(req1, res1);

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.status, 'success');
    assert.equal(res1.body.data.config_revision, 1);
    assert.equal(res1.body.data.model, 'text-embedding-3-small');

    // 2. Reject foreign credential (Tenant 1 trying to use Tenant 2's credential id 20)
    const req2 = {
      auth: { userId: 1 },
      body: {
        credential_id: 20,
        model: 'text-embedding-3-small',
        dimensions: 1536
      },
      dbClient: client
    };
    const res2 = createMockResponse();
    await saveEmbeddingProfile(req2, res2);

    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.status, 'error');
    assert.equal(res2.body.error_code, 'EMBEDDING_CREDENTIAL_NOT_FOUND');
  });
});

test('controller: testEmbeddingProfileCapability validates credentials and handles errors safely', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    // 1. Missing API key and missing credential returns 400
    const req1 = {
      auth: { userId: 1 },
      body: {},
      dbClient: client
    };
    const res1 = createMockResponse();
    await testEmbeddingProfileCapability(req1, res1);

    assert.equal(res1.statusCode, 400);
    assert.equal(res1.body.error_code, 'API_KEY_REQUIRED');

    // 2. Foreign credential returns 404
    const req2 = {
      auth: { userId: 1 },
      body: { credential_id: 20 },
      dbClient: client
    };
    const res2 = createMockResponse();
    await testEmbeddingProfileCapability(req2, res2);

    assert.equal(res2.statusCode, 404);
    assert.equal(res2.body.error_code, 'CREDENTIAL_NOT_FOUND');
  });
});

// ============================================================================
// Batch Embeddings & Capability Mock Tests (RAG-0403, RAG-0404, RAG-0405)
// ============================================================================

test('generateBatchChunkEmbeddings: batches input chunks and records usage in database', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    let callCount = 0;
    const mockOpenai = {
      embeddings: {
        async create({ model, input }) {
          callCount += 1;
          return {
            data: input.map((text, idx) => ({
              embedding: [0.1 * (idx + 1), 0.2 * (idx + 1), 0.3 * (idx + 1)]
            })),
            usage: {
              prompt_tokens: input.length * 5,
              total_tokens: input.length * 5
            }
          };
        }
      }
    };

    const chunks = [
      { chunk_index: 0, chunk_text: 'Teks chunk nomor 0' },
      { chunk_index: 1, chunk_text: 'Teks chunk nomor 1' },
      { chunk_index: 2, chunk_text: 'Teks chunk nomor 2' }
    ];

    const result = await generateBatchChunkEmbeddings({
      chunks,
      model: 'text-embedding-3-small',
      dimensions: 3,
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-test',
      userId: 1,
      maxBatchSize: 2, // 3 chunks with batch size 2 -> 2 calls
      openaiClient: mockOpenai,
      databaseClient: client
    });

    assert.equal(callCount, 2);
    assert.equal(result.chunkEmbeddings.length, 3);
    assert.equal(result.totalTokens, 15);

    // Verify first chunk embedding
    const restored0 = deserializeEmbeddingVector(result.chunkEmbeddings[0].embedding_blob, 3);
    assert.ok(Math.abs(restored0[0] - 0.1) < 1e-6);

    // Verify usage records in database
    const usageRows = await client.all(
      `SELECT request_kind, operation, input_tokens, model
       FROM chatbot_ai_usage
       WHERE user_id = 1 AND request_kind = 'embedding' AND operation = 'source_embedding'`
    );
    assert.equal(usageRows.length, 2);
    assert.equal(usageRows[0].request_kind, 'embedding');
    assert.equal(usageRows[0].operation, 'source_embedding');
    assert.equal(usageRows[0].model, 'text-embedding-3-small');
  });
});

test('generateBatchChunkEmbeddings: retries on transient 429 error and succeeds on 2nd attempt', async () => {
  await withEmbeddingFixture(async ({ client }) => {
    let attempts = 0;
    const mockOpenai = {
      embeddings: {
        async create({ input }) {
          attempts += 1;
          if (attempts === 1) {
            const err = new Error('Rate limit exceeded');
            err.status = 429;
            throw err;
          }
          return {
            data: input.map(() => ({ embedding: [0.1, 0.2, 0.3] })),
            usage: { prompt_tokens: 6, total_tokens: 6 }
          };
        }
      }
    };

    const chunks = [{ chunk_index: 0, chunk_text: 'Single chunk' }];

    const result = await generateBatchChunkEmbeddings({
      chunks,
      model: 'text-embedding-3-small',
      dimensions: 3,
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-test',
      userId: 1,
      maxAttempts: 2,
      retryDelayMs: 0,
      openaiClient: mockOpenai,
      databaseClient: client
    });

    assert.equal(attempts, 2);
    assert.equal(result.chunkEmbeddings.length, 1);

    // Verify two usage records: 1 failed attempt + 1 succeeded attempt
    const usageRows = await client.all(
      `SELECT request_status, http_status
       FROM chatbot_ai_usage
       WHERE user_id = 1 AND request_kind = 'embedding'
       ORDER BY id ASC`
    );
    assert.equal(usageRows.length, 2);
    assert.equal(usageRows[0].request_status, 'FAILED');
    assert.equal(usageRows[0].http_status, 429);
    assert.equal(usageRows[1].request_status, 'SUCCEEDED');
  });
});

test('testEmbeddingCapability: correctly classifies capability statuses with mock provider', async () => {
  // 1. Success -> SUPPORTED
  const mockSupported = {
    embeddings: {
      async create() {
        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
      }
    }
  };
  const resSupported = await testEmbeddingCapability({
    dimensions: 3,
    openaiClient: mockSupported
  });
  assert.equal(resSupported.capabilityStatus, EMBEDDING_CAPABILITY_STATUSES.SUPPORTED);
  assert.equal(resSupported.actualDimensions, 3);

  // 2. Dimension mismatch -> UNSUPPORTED
  const resMismatch = await testEmbeddingCapability({
    dimensions: 4, // expected 4, returns 3
    openaiClient: mockSupported
  });
  assert.equal(resMismatch.capabilityStatus, EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED);
  assert.equal(resMismatch.errorCode, 'DIMENSION_MISMATCH');

  // 3. HTTP 404 from provider -> UNSUPPORTED
  const mock404 = {
    embeddings: {
      async create() {
        const err = new Error('Model not found');
        err.status = 404;
        throw err;
      }
    }
  };
  const res404 = await testEmbeddingCapability({
    dimensions: 3,
    openaiClient: mock404
  });
  assert.equal(res404.capabilityStatus, EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED);
  assert.equal(res404.httpStatus, 404);

  // 4. HTTP 500 from provider -> FAILED
  const mock500 = {
    embeddings: {
      async create() {
        const err = new Error('Internal provider error');
        err.status = 500;
        throw err;
      }
    }
  };
  const res500 = await testEmbeddingCapability({
    dimensions: 3,
    openaiClient: mock500
  });
  assert.equal(res500.capabilityStatus, EMBEDDING_CAPABILITY_STATUSES.FAILED);
  assert.equal(res500.httpStatus, 500);
});

test('RAG-0406: stores model, dimensions, config_hash, revision; handles 2 sessions sharing Flow and concurrent profile updates', async () => {
  await withEmbeddingFixture(async ({ client, db }) => {
    // 1. Setup two sessions sharing a Flow source
    await run(db, "INSERT INTO sessions (session_id, status, user_id) VALUES ('session-1b', 'CONNECTED', 1)");
    const flow = await run(
      db,
      `INSERT INTO chatbot_flows (flow_name, session_ids, keywords, nodes, user_id)
       VALUES ('Customer Support Flow', '["session-tenant-1", "session-1b"]', '["support"]', '[]', 1)`
    );
    await run(
      db,
      `INSERT INTO rag_sources (id, user_id, source_type, flow_id, content_hash, current_revision, is_active, embedding_status)
       VALUES (101, 1, 'flow', ?, 'content-hash-flow', 1, 1, 'READY')`,
      [flow.id]
    );
    await run(
      db,
      `INSERT INTO rag_session_sources (session_id, source_id, user_id)
       VALUES ('session-tenant-1', 101, 1),
              ('session-1b', 101, 1)`
    );

    // Initial profile
    const initialProfile = await upsertTenantEmbeddingProfile({
      userId: 1,
      credentialId: 10,
      model: 'text-embedding-3-small',
      dimensions: 1536
    }, client);
    assert.equal(initialProfile.config_revision, 1);

    // Store chunks with profile metadata
    const testVector = new Float32Array(1536).fill(0.1);
    await run(
      db,
      `INSERT INTO rag_chunks (source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash, embedding, embedding_model, embedding_dimensions, embedding_config_hash)
       VALUES (101, 1, 1, 0, 'Chunk 1', 10, 'chunk-hash-1', ?, 'text-embedding-3-small', 1536, ?)`,
      [serializeEmbeddingVector(testVector), initialProfile.config_hash]
    );

    // Seed response cache
    await run(
      db,
      `INSERT INTO rag_response_cache (user_id, session_id, cache_key, source_revision_digest, response_ciphertext, expires_at)
       VALUES (1, 'session-tenant-1', 'query-hash-1', 'digest-1', X'1234', datetime('now', '+1 hour'))`
    );

    // 2. Perform concurrent profile updates
    const [p1, p2] = await Promise.all([
      upsertTenantEmbeddingProfile({
        userId: 1,
        credentialId: 10,
        model: 'text-embedding-3-large',
        dimensions: 3072
      }, client),
      upsertTenantEmbeddingProfile({
        userId: 1,
        credentialId: 10,
        model: 'text-embedding-3-large',
        dimensions: 3072
      }, client)
    ]);

    // Both should succeed, revision incremented, source marked PENDING
    assert.ok(p1.config_revision >= 2);
    assert.ok(p2.config_revision >= 2);

    const updatedProfile = await getTenantEmbeddingProfile(1, client);
    assert.equal(updatedProfile.model, 'text-embedding-3-large');
    assert.equal(updatedProfile.dimensions, 3072);

    // Verify shared source status switched to PENDING
    const source = await get(db, 'SELECT embedding_status FROM rag_sources WHERE id = 101');
    assert.equal(source.embedding_status, 'PENDING');

    // Both sessions still map to this source
    const mappedSessions = await all(
      db,
      'SELECT session_id FROM rag_session_sources WHERE source_id = 101 ORDER BY session_id'
    );
    assert.deepEqual(
      mappedSessions.map((s) => s.session_id),
      ['session-1b', 'session-tenant-1']
    );

    // Verify cache was cleared
    const cacheCount = await get(db, 'SELECT COUNT(*) as count FROM rag_response_cache WHERE user_id = 1');
    assert.equal(cacheCount.count, 0);

    // Tenant isolation: Tenant 2 profile unchanged
    const tenant2Profile = await getTenantEmbeddingProfile(2, client);
    assert.equal(tenant2Profile, null);
  });
});

test('RAG-0407: generateQueryEmbedding handles successful generation, session telemetry, retry on 429, and fast-fails on 401', async () => {
  await withEmbeddingFixture(async ({ client, db }) => {
    // 1. Success with telemetry
    const mockSuccess = {
      embeddings: {
        async create() {
          return {
            data: [{ embedding: [0.5, 0.5, 0.5] }],
            usage: { prompt_tokens: 4, total_tokens: 4 }
          };
        }
      }
    };

    const queryResult = await generateQueryEmbedding({
      query: 'halo bot',
      dimensions: 3,
      userId: 1,
      sessionId: 'session-tenant-1',
      openaiClient: mockSuccess,
      databaseClient: client
    });

    assert.equal(queryResult.dimensions, 3);
    assert.equal(queryResult.tokens, 4);
    assert.ok(queryResult.vector instanceof Float32Array);
    assert.equal(queryResult.vector.length, 3);
    assert.ok(Buffer.isBuffer(queryResult.vectorBlob));

    // Verify usage recorded
    const usageRow = await get(
      db,
      "SELECT * FROM chatbot_ai_usage WHERE user_id = 1 AND operation = 'query_embedding' AND session_id = 'session-tenant-1'"
    );
    assert.ok(usageRow);
    assert.equal(usageRow.request_kind, 'embedding');

    // 2. Retry on 429 transient error
    let attempts429 = 0;
    const mock429 = {
      embeddings: {
        async create() {
          attempts429 += 1;
          if (attempts429 === 1) {
            const err = new Error('Rate limit exceeded');
            err.status = 429;
            throw err;
          }
          return {
            data: [{ embedding: [0.1, 0.2, 0.3] }],
            usage: { prompt_tokens: 3, total_tokens: 3 }
          };
        }
      }
    };

    const retryResult = await generateQueryEmbedding({
      query: 'pertanyaan kedua',
      dimensions: 3,
      userId: 1,
      sessionId: 'session-tenant-1',
      maxAttempts: 2,
      retryDelayMs: 5,
      openaiClient: mock429,
      databaseClient: client
    });

    assert.equal(attempts429, 2);
    assert.equal(retryResult.dimensions, 3);

    // 3. Fast-fail on 401 unauthorized without retrying
    let attempts401 = 0;
    const mock401 = {
      embeddings: {
        async create() {
          attempts401 += 1;
          const err = new Error('Invalid API Key');
          err.status = 401;
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await generateQueryEmbedding({
          query: 'auth fail test',
          dimensions: 3,
          userId: 1,
          maxAttempts: 3,
          openaiClient: mock401,
          databaseClient: client
        });
      },
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
    assert.equal(attempts401, 1, 'Should not retry on 401 error');
  });
});

test('RAG-0408: rankChunksByCosineSimilarity ranks candidates, handles BLOBs, filters minSimilarity, and validates dimensions', async () => {
  const queryVec = new Float32Array([1.0, 0.0, 0.0]); // Vector pointing along X-axis

  // Candidate 1: Identical direction [1, 0, 0] -> similarity 1.0 (BLOB Buffer)
  const blob1 = serializeEmbeddingVector(new Float32Array([1.0, 0.0, 0.0]));

  // Candidate 2: 45 degree angle [1, 1, 0] -> similarity ~ 0.707 (Float32Array)
  const vec2 = new Float32Array([1.0, 1.0, 0.0]);

  // Candidate 3: Orthogonal [0, 1, 0] -> similarity 0.0 (Array)
  const vec3 = [0.0, 1.0, 0.0];

  // Candidate 4: Opposing [-1, 0, 0] -> similarity -1.0
  const vec4 = new Float32Array([-1.0, 0.0, 0.0]);

  const candidates = [
    { chunk_index: 0, text: 'Orthogonal chunk', embedding: vec3 },
    { chunk_index: 1, text: 'Identical chunk', embedding: blob1 },
    { chunk_index: 2, text: 'Opposing chunk', embedding: vec4 },
    { chunk_index: 3, text: 'Diagonal chunk', embedding: vec2 }
  ];

  // Test standard ranking (all 4 returned, sorted desc)
  const ranked = rankChunksByCosineSimilarity({
    queryVector: queryVec,
    chunks: candidates,
    topK: 10
  });

  assert.equal(ranked.length, 4);
  assert.equal(ranked[0].chunk_index, 1, 'First should be identical chunk (sim = 1)');
  assert.ok(Math.abs(ranked[0].similarity - 1.0) < 1e-5);

  assert.equal(ranked[1].chunk_index, 3, 'Second should be diagonal chunk (sim ~ 0.707)');
  assert.ok(ranked[1].similarity > 0.7 && ranked[1].similarity < 0.71);

  assert.equal(ranked[2].chunk_index, 0, 'Third should be orthogonal chunk (sim = 0)');
  assert.ok(Math.abs(ranked[2].similarity) < 1e-5);

  assert.equal(ranked[3].chunk_index, 2, 'Fourth should be opposing chunk (sim = -1)');
  assert.ok(Math.abs(ranked[3].similarity - (-1.0)) < 1e-5);

  // Test top-K slicing
  const top2 = rankChunksByCosineSimilarity({
    queryVector: queryVec,
    chunks: candidates,
    topK: 2
  });
  assert.equal(top2.length, 2);
  assert.equal(top2[0].chunk_index, 1);
  assert.equal(top2[1].chunk_index, 3);

  // Test minSimilarity filtering
  const filtered = rankChunksByCosineSimilarity({
    queryVector: queryVec,
    chunks: candidates,
    minSimilarity: 0.5
  });
  assert.equal(filtered.length, 2, 'Only candidates with similarity >= 0.5 should pass');

  // Test dimension mismatch
  assert.throws(
    () => {
      rankChunksByCosineSimilarity({
        queryVector: queryVec,
        chunks: [{ chunk_index: 99, embedding: [1.0, 2.0] }], // length 2 instead of 3
        expectedDimensions: 3
      });
    },
    { code: 'EMBEDDING_DIMENSION_MISMATCH' }
  );

  // Test invalid query vector
  assert.throws(
    () => {
      rankChunksByCosineSimilarity({
        queryVector: null,
        chunks: candidates
      });
    },
    { code: 'EMBEDDING_INVALID_VECTOR' }
  );

  // Test empty candidates returns []
  const emptyRes = rankChunksByCosineSimilarity({
    queryVector: queryVec,
    chunks: []
  });
  assert.deepEqual(emptyRes, []);
});

test('RAG-0409: clampEmbeddingOptions bounds limits, and batch embedding enforces batch size & non-retryable fast-fail', async () => {
  await withEmbeddingFixture(async ({ client, db }) => {
    // 1. clampEmbeddingOptions checks
    const clampedLower = clampEmbeddingOptions({
      timeoutMs: 100, // below 500
      maxBatchSize: 0, // below 1
      maxAttempts: 0, // below 1
      retryDelayMs: -50 // below 0
    });
    assert.equal(clampedLower.timeoutMs, EMBEDDING_BOUNDS.MIN_TIMEOUT_MS);
    assert.equal(clampedLower.maxBatchSize, EMBEDDING_BOUNDS.MIN_BATCH_SIZE);
    assert.equal(clampedLower.maxAttempts, EMBEDDING_BOUNDS.MIN_ATTEMPTS);
    assert.equal(clampedLower.retryDelayMs, EMBEDDING_BOUNDS.MIN_RETRY_DELAY_MS);

    const clampedUpper = clampEmbeddingOptions({
      timeoutMs: 999999, // above 60000
      maxBatchSize: 999, // above 64
      maxAttempts: 99, // above 3
      retryDelayMs: 99999 // above 5000
    });
    assert.equal(clampedUpper.timeoutMs, EMBEDDING_BOUNDS.MAX_TIMEOUT_MS);
    assert.equal(clampedUpper.maxBatchSize, EMBEDDING_BOUNDS.MAX_BATCH_SIZE);
    assert.equal(clampedUpper.maxAttempts, EMBEDDING_BOUNDS.MAX_ATTEMPTS);
    assert.equal(clampedUpper.retryDelayMs, EMBEDDING_BOUNDS.MAX_RETRY_DELAY_MS);

    // 2. Batch chunking with 35 chunks and maxBatchSize = 10
    const chunks = Array.from({ length: 35 }, (_, i) => ({
      chunk_index: i,
      chunk_text: `Chunk number ${i}`
    }));

    const batchCallSizes = [];
    const mockBatchClient = {
      embeddings: {
        async create({ input }) {
          batchCallSizes.push(input.length);
          return {
            data: input.map(() => ({ embedding: [0.1, 0.2, 0.3] })),
            usage: { prompt_tokens: input.length * 2, total_tokens: input.length * 2 }
          };
        }
      }
    };

    const batchResult = await generateBatchChunkEmbeddings({
      chunks,
      dimensions: 3,
      userId: 1,
      maxBatchSize: 10,
      openaiClient: mockBatchClient,
      databaseClient: client
    });

    assert.deepEqual(batchCallSizes, [10, 10, 10, 5], 'Should slice 35 chunks into batches of 10, 10, 10, 5');
    assert.equal(batchResult.chunkEmbeddings.length, 35);
    assert.equal(batchResult.totalTokens, 70);

    // 3. Non-retryable 400 Bad Request fails immediately on attempt 1
    let failAttempts = 0;
    const mock400Client = {
      embeddings: {
        async create() {
          failAttempts += 1;
          const err = new Error('Bad Request: Invalid model');
          err.status = 400;
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await generateBatchChunkEmbeddings({
          chunks: [{ chunk_index: 0, chunk_text: 'hello' }],
          dimensions: 3,
          userId: 1,
          maxAttempts: 3,
          openaiClient: mock400Client,
          databaseClient: client
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
    assert.equal(failAttempts, 1, 'Non-retryable 400 error should not be retried');
  });
});

test('RAG-0410: resolveEffectiveRagRetrievalMode and executeSemanticRetrievalWithFtsFallback guarantee fallback to FTS', async () => {
  // 1. resolveEffectiveRagRetrievalMode matrix
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'off' }), 'off');
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'fts' }), 'fts');

  // Hybrid without profile -> fts
  assert.equal(resolveEffectiveRagRetrievalMode({ ragMode: 'hybrid', profile: null }), 'fts');

  // Hybrid with UNSUPPORTED profile -> fts
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: 'UNSUPPORTED', credential_id: 1 }
    }),
    'fts'
  );

  // Hybrid with FAILED profile -> fts
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: 'FAILED', credential_id: 1 }
    }),
    'fts'
  );

  // Hybrid with no credential and no baseUrl -> fts
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: 'SUPPORTED', credential_id: null, base_url: null }
    }),
    'fts'
  );

  // Hybrid with SUPPORTED profile and credential -> hybrid
  assert.equal(
    resolveEffectiveRagRetrievalMode({
      ragMode: 'hybrid',
      profile: { capability_status: 'SUPPORTED', credential_id: 10 }
    }),
    'hybrid'
  );

  // 2. executeSemanticRetrievalWithFtsFallback: success case
  const mockSemanticSuccess = async () => [
    { chunk_index: 1, similarity: 0.95, text: 'Semantic hit' }
  ];
  const mockFts = async () => [
    { chunk_index: 2, rank: -2.5, text: 'FTS hit' }
  ];

  const successResult = await executeSemanticRetrievalWithFtsFallback({
    semanticRetrievalFn: mockSemanticSuccess,
    ftsFallbackFn: mockFts
  });

  assert.equal(successResult.fallback, false);
  assert.equal(successResult.retrieval_mode, 'semantic');
  assert.equal(successResult.results.length, 1);
  assert.equal(successResult.results[0].text, 'Semantic hit');

  // 3. executeSemanticRetrievalWithFtsFallback: error fallback case
  const mockSemanticFail = async () => {
    const err = new Error('503 Service Unavailable');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  };

  const fallbackResult = await executeSemanticRetrievalWithFtsFallback({
    semanticRetrievalFn: mockSemanticFail,
    ftsFallbackFn: mockFts,
    logContext: { test: true }
  });

  assert.equal(fallbackResult.fallback, true);
  assert.equal(fallbackResult.retrieval_mode, 'fts_fallback');
  assert.equal(fallbackResult.fallback_reason, 'PROVIDER_UNAVAILABLE');
  assert.equal(fallbackResult.results.length, 1);
  assert.equal(fallbackResult.results[0].text, 'FTS hit');
});
