import { createHash } from 'node:crypto';
import { OpenAI } from 'openai';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../utils/outbound_url.js';
import { revealSecret } from './secret.service.js';
import {
  createAIRequestContext,
  createAIRetryContext,
  recordChatbotAIUsageSafely,
  resolveAIProvider
} from './chatbot_ai_usage.service.js';
import { logError } from '../logger.js';

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

export function isRetryableEmbeddingError(error) {
  const status = Number(error?.status);
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  return RETRYABLE_NETWORK_CODES.has(String(error?.code || '').toUpperCase());
}

export const EMBEDDING_DEFAULTS = Object.freeze({
  MODEL: 'text-embedding-3-small',
  DIMENSIONS: 1536,
  TIMEOUT_MS: 10000,
  MAX_BATCH_SIZE: 16,
  MAX_ATTEMPTS: 2,
  RETRY_DELAY_MS: 250
});

export const EMBEDDING_CAPABILITY_STATUSES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  FAILED: 'FAILED'
});

export function createEmbeddingError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createEmbeddingError('EMBEDDING_INVALID_INPUT', `${field} harus berupa integer positif.`);
  }
  return value;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createEmbeddingError('EMBEDDING_INVALID_INPUT', `${field} wajib diisi string non-kosong.`);
  }
  return value.trim();
}

let runtimeDatabaseClientPromise = null;

async function getRuntimeDatabaseClient() {
  if (!runtimeDatabaseClientPromise) {
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbGet, dbRun, dbAll }) => ({
      get: dbGet,
      run: dbRun,
      all: dbAll
    }));
  }
  return runtimeDatabaseClientPromise;
}

async function resolveDatabaseClient(databaseClient = null) {
  if (databaseClient && typeof databaseClient.run === 'function' && typeof databaseClient.get === 'function') {
    return databaseClient;
  }
  return getRuntimeDatabaseClient();
}

// ============================================================================
// Vector Mathematics & Binary Serialization
// ============================================================================

export function serializeEmbeddingVector(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
    throw createEmbeddingError(
      'EMBEDDING_INVALID_VECTOR',
      'Vector embedding harus berupa Array atau Float32Array.'
    );
  }
  if (vector.length === 0) {
    throw createEmbeddingError(
      'EMBEDDING_INVALID_VECTOR',
      'Vector embedding tidak boleh kosong.'
    );
  }

  const float32 = vector instanceof Float32Array ? vector : new Float32Array(vector);
  for (let i = 0; i < float32.length; i += 1) {
    if (!Number.isFinite(float32[i])) {
      throw createEmbeddingError(
        'EMBEDDING_INVALID_VECTOR',
        `Vector embedding memuat elemen tidak valid pada indeks ${i}.`
      );
    }
  }

  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

export function deserializeEmbeddingVector(buffer, expectedDimensions = null) {
  if (!Buffer.isBuffer(buffer)) {
    throw createEmbeddingError(
      'EMBEDDING_INVALID_BUFFER',
      'Buffer embedding harus berupa Node.js Buffer.'
    );
  }
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) {
    throw createEmbeddingError(
      'EMBEDDING_INVALID_BUFFER',
      'Ukuran buffer embedding harus kelipatan 4 bytes (Float32).'
    );
  }

  const dimensions = buffer.byteLength / 4;
  if (expectedDimensions !== null) {
    const expected = Number(expectedDimensions);
    if (dimensions !== expected) {
      throw createEmbeddingError(
        'EMBEDDING_DIMENSION_MISMATCH',
        `Dimensi vector tidak sesuai: diharapkan ${expected}, diperoleh ${dimensions}.`,
        { expected, actual: dimensions }
      );
    }
  }

  return new Float32Array(buffer.buffer, buffer.byteOffset, dimensions);
}

export function dotProduct(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw createEmbeddingError(
      'EMBEDDING_DIMENSION_MISMATCH',
      'Kedua vector harus memiliki panjang yang sama untuk dot product.',
      { lengthA: vecA?.length, lengthB: vecB?.length }
    );
  }

  let sum = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

export function vectorNorm(vec) {
  if (!vec || vec.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sumSquares += vec[i] * vec[i];
  }
  return Math.sqrt(sumSquares);
}

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw createEmbeddingError(
      'EMBEDDING_DIMENSION_MISMATCH',
      'Kedua vector harus memiliki panjang yang sama untuk cosine similarity.',
      { lengthA: vecA?.length, lengthB: vecB?.length }
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Profile & Config Hashing
// ============================================================================

export function calculateEmbeddingConfigHash({ model, dimensions, baseUrl = '' }) {
  const normalized = JSON.stringify({
    baseUrl: String(baseUrl || '').trim().toLowerCase().replace(/\/$/, ''),
    model: String(model || '').trim().toLowerCase(),
    dimensions: Number(dimensions)
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export async function getTenantEmbeddingProfile(userId, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const client = await resolveDatabaseClient(databaseClient);

  const profile = await client.get(
    `SELECT p.*, c.name AS credential_name, c.base_url, c.is_active AS credential_is_active
     FROM rag_embedding_profiles p
     LEFT JOIN chatbot_ai_credentials c ON c.id = p.credential_id AND c.user_id = p.user_id
     WHERE p.user_id = ?`,
    [userId]
  );

  return profile || null;
}

export async function upsertTenantEmbeddingProfile({
  userId,
  credentialId = null,
  model = EMBEDDING_DEFAULTS.MODEL,
  dimensions = EMBEDDING_DEFAULTS.DIMENSIONS,
  capabilityStatus = EMBEDDING_CAPABILITY_STATUSES.UNKNOWN
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeModel = requireNonEmptyString(model, 'model');
  const safeDimensions = requirePositiveInteger(Number(dimensions), 'dimensions');
  const client = await resolveDatabaseClient(databaseClient);

  let baseUrl = '';
  if (credentialId !== null && credentialId !== undefined) {
    requirePositiveInteger(credentialId, 'credentialId');
    const cred = await client.get(
      `SELECT id, base_url, is_active FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?`,
      [credentialId, userId]
    );
    if (!cred) {
      throw createEmbeddingError(
        'EMBEDDING_CREDENTIAL_NOT_FOUND',
        'Kredensial terpilih tidak ditemukan atau bukan milik tenant.'
      );
    }
    baseUrl = cred.base_url || '';
  }

  const newConfigHash = calculateEmbeddingConfigHash({
    model: safeModel,
    dimensions: safeDimensions,
    baseUrl
  });

  const existing = await client.get(
    `SELECT id, user_id, config_revision, config_hash FROM rag_embedding_profiles WHERE user_id = ?`,
    [userId]
  );

  if (existing) {
    const configChanged = existing.config_hash !== newConfigHash;
    const nextRevision = configChanged ? Number(existing.config_revision) + 1 : Number(existing.config_revision);

    await client.run(
      `UPDATE rag_embedding_profiles
       SET credential_id = ?,
           model = ?,
           dimensions = ?,
           config_revision = ?,
           config_hash = ?,
           capability_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        credentialId,
        safeModel,
        safeDimensions,
        nextRevision,
        newConfigHash,
        capabilityStatus,
        existing.id,
        userId
      ]
    );

    if (configChanged) {
      // Mark all tenant sources as needing re-embedding
      await client.run(
        `UPDATE rag_sources
         SET embedding_status = 'PENDING',
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND is_active = 1`,
        [userId]
      );
      // Invalidate cache for tenant
      await client.run(
        `DELETE FROM rag_response_cache WHERE user_id = ?`,
        [userId]
      );
    }

    return {
      id: existing.id,
      user_id: userId,
      credential_id: credentialId,
      model: safeModel,
      dimensions: safeDimensions,
      config_revision: nextRevision,
      config_hash: newConfigHash,
      capability_status: capabilityStatus,
      configChanged
    };
  }

  const result = await client.run(
    `INSERT INTO rag_embedding_profiles (
       user_id, credential_id, model, dimensions, config_revision, config_hash, capability_status
     ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [userId, credentialId, safeModel, safeDimensions, newConfigHash, capabilityStatus]
  );

  return {
    id: result.id,
    user_id: userId,
    credential_id: credentialId,
    model: safeModel,
    dimensions: safeDimensions,
    config_revision: 1,
    config_hash: newConfigHash,
    capability_status: capabilityStatus,
    configChanged: true
  };
}

export async function validateSessionEmbeddingProfile({ sessionId, userId, profileId }, databaseClient = null) {
  requireNonEmptyString(sessionId, 'sessionId');
  requirePositiveInteger(userId, 'userId');
  if (profileId === null || profileId === undefined) return null;
  requirePositiveInteger(profileId, 'profileId');
  const client = await resolveDatabaseClient(databaseClient);

  const profile = await client.get(
    `SELECT id, user_id, capability_status FROM rag_embedding_profiles WHERE id = ? AND user_id = ?`,
    [profileId, userId]
  );

  if (!profile) {
    throw createEmbeddingError(
      'EMBEDDING_PROFILE_NOT_FOUND',
      'Profil embedding tidak ditemukan atau bukan milik tenant sesi ini.'
    );
  }

  return profile;
}

// ============================================================================
// Safe Client & Capability Testing
// ============================================================================

export async function createSafeEmbeddingOpenAIClient({
  baseUrl,
  apiKey,
  timeoutMs = EMBEDDING_DEFAULTS.TIMEOUT_MS
}) {
  const safeBaseUrl = await assertSafeOutboundUrl(baseUrl || 'https://ai.sumopod.com/v1');
  const safeFetch = createSafeOutboundFetch();

  return {
    openai: new OpenAI({
      apiKey: String(apiKey || '').trim(),
      baseURL: safeBaseUrl,
      timeout: timeoutMs,
      fetch: safeFetch,
      maxRetries: 0
    }),
    safeBaseUrl,
    provider: resolveAIProvider(safeBaseUrl)
  };
}

export async function testEmbeddingCapability({
  baseUrl,
  apiKey,
  model = EMBEDDING_DEFAULTS.MODEL,
  dimensions = EMBEDDING_DEFAULTS.DIMENSIONS,
  timeoutMs = EMBEDDING_DEFAULTS.TIMEOUT_MS,
  openaiClient = null
}) {
  const safeModel = requireNonEmptyString(model, 'model');
  const safeDimensions = requirePositiveInteger(Number(dimensions), 'dimensions');

  if (!openaiClient && (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '')) {
    return {
      capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.FAILED,
      error: 'API Key wajib disediakan untuk pengujian capability embedding.',
      errorCode: 'API_KEY_REQUIRED'
    };
  }

  const startedAt = Date.now();
  try {
    const { openai, safeBaseUrl, provider } = openaiClient
      ? { openai: openaiClient, safeBaseUrl: baseUrl || 'https://ai.sumopod.com/v1', provider: 'test-provider' }
      : await createSafeEmbeddingOpenAIClient({
          baseUrl,
          apiKey,
          timeoutMs
        });

    const response = await openai.embeddings.create({
      model: safeModel,
      input: ['test ping']
    });

    const latencyMs = Date.now() - startedAt;
    const vector = response?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      return {
        capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED,
        error: 'Provider mengembalikan response embedding kosong.',
        errorCode: 'EMPTY_EMBEDDING_RESPONSE',
        latencyMs,
        provider,
        baseUrl: safeBaseUrl
      };
    }

    if (vector.length !== safeDimensions) {
      return {
        capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED,
        error: `Dimensi embedding (${vector.length}) tidak sesuai konfigurasi (${safeDimensions}).`,
        errorCode: 'DIMENSION_MISMATCH',
        actualDimensions: vector.length,
        expectedDimensions: safeDimensions,
        latencyMs,
        provider,
        baseUrl: safeBaseUrl
      };
    }

    return {
      capabilityStatus: EMBEDDING_CAPABILITY_STATUSES.SUPPORTED,
      actualDimensions: vector.length,
      expectedDimensions: safeDimensions,
      latencyMs,
      provider,
      baseUrl: safeBaseUrl
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const status = Number(error?.status);
    const isUnsupported = status === 404 || status === 400;

    return {
      capabilityStatus: isUnsupported
        ? EMBEDDING_CAPABILITY_STATUSES.UNSUPPORTED
        : EMBEDDING_CAPABILITY_STATUSES.FAILED,
      error: error?.message || 'Gagal menghubungi endpoint embedding.',
      errorCode: error?.code || (isUnsupported ? 'EMBEDDING_UNSUPPORTED' : 'EMBEDDING_CALL_FAILED'),
      httpStatus: status || null,
      latencyMs
    };
  }
}

// ============================================================================
// Batch Chunk Embedding
// ============================================================================

export async function generateBatchChunkEmbeddings({
  chunks,
  model = EMBEDDING_DEFAULTS.MODEL,
  dimensions = EMBEDDING_DEFAULTS.DIMENSIONS,
  baseUrl,
  apiKey,
  userId,
  maxBatchSize = EMBEDDING_DEFAULTS.MAX_BATCH_SIZE,
  timeoutMs = EMBEDDING_DEFAULTS.TIMEOUT_MS,
  maxAttempts = EMBEDDING_DEFAULTS.MAX_ATTEMPTS,
  retryDelayMs = EMBEDDING_DEFAULTS.RETRY_DELAY_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  openaiClient = null,
  databaseClient = null
}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { chunkEmbeddings: [], totalTokens: 0, latencyMs: 0 };
  }
  requirePositiveInteger(userId, 'userId');
  const safeModel = requireNonEmptyString(model, 'model');
  const safeDimensions = requirePositiveInteger(Number(dimensions), 'dimensions');

  const { openai, safeBaseUrl, provider } = openaiClient
    ? { openai: openaiClient, safeBaseUrl: baseUrl || 'https://ai.sumopod.com/v1', provider: 'test-provider' }
    : await createSafeEmbeddingOpenAIClient({
        baseUrl,
        apiKey,
        timeoutMs
      });

  const batchResults = [];
  let aggregateTokens = 0;
  const startedAt = Date.now();

  for (let offset = 0; offset < chunks.length; offset += maxBatchSize) {
    const slice = chunks.slice(offset, offset + maxBatchSize);
    const inputs = slice.map((c) => String(c.chunk_text || ''));

    let context = createAIRequestContext({
      requestKind: 'embedding',
      operation: 'source_embedding'
    });

    let succeeded = false;
    let lastError = null;

    while (context.attemptNo <= maxAttempts && !succeeded) {
      const attemptStart = Date.now();
      try {
        const response = await openai.embeddings.create({
          model: safeModel,
          input: inputs
        });

        const attemptLatency = Date.now() - attemptStart;
        const promptTokens = response?.usage?.prompt_tokens ?? response?.usage?.total_tokens ?? 0;
        aggregateTokens += promptTokens;

        await recordChatbotAIUsageSafely({
          context,
          userId,
          sessionId: null,
          provider,
          model: safeModel,
          response,
          deliveryStatus: 'NOT_APPLICABLE',
          latencyMs: attemptLatency
        }, databaseClient);

        const data = response?.data || [];
        if (data.length !== slice.length) {
          throw createEmbeddingError(
            'EMBEDDING_BATCH_LENGTH_MISMATCH',
            `Panjang embedding response (${data.length}) tidak sama dengan batch input (${slice.length}).`
          );
        }

        for (let i = 0; i < slice.length; i += 1) {
          const rawVector = data[i]?.embedding;
          if (!Array.isArray(rawVector) || rawVector.length !== safeDimensions) {
            throw createEmbeddingError(
              'EMBEDDING_DIMENSION_MISMATCH',
              `Dimensi vector item ${i} (${rawVector?.length}) tidak sesuai konfigurasi (${safeDimensions}).`
            );
          }
          batchResults.push({
            chunk_index: slice[i].chunk_index,
            embedding_blob: serializeEmbeddingVector(rawVector),
            dimensions: safeDimensions,
            model: safeModel
          });
        }

        succeeded = true;
      } catch (err) {
        lastError = err;
        const attemptLatency = Date.now() - attemptStart;
        await recordChatbotAIUsageSafely({
          context,
          userId,
          sessionId: null,
          provider,
          model: safeModel,
          error: err,
          deliveryStatus: 'NOT_APPLICABLE',
          latencyMs: attemptLatency
        }, databaseClient);

        if (context.attemptNo >= maxAttempts || !isRetryableEmbeddingError(err)) {
          break;
        }
        if (retryDelayMs > 0) await sleep(retryDelayMs);
        context = createAIRetryContext(context);
      }
    }

    if (!succeeded) {
      throw lastError || createEmbeddingError('EMBEDDING_BATCH_FAILED', 'Batch chunk embedding gagal.');
    }
  }

  return {
    chunkEmbeddings: batchResults,
    totalTokens: aggregateTokens,
    latencyMs: Date.now() - startedAt,
    provider,
    baseUrl: safeBaseUrl
  };
}

// ============================================================================
// Query Embedding
// ============================================================================

export async function generateQueryEmbedding({
  query,
  model = EMBEDDING_DEFAULTS.MODEL,
  dimensions = EMBEDDING_DEFAULTS.DIMENSIONS,
  baseUrl,
  apiKey,
  userId,
  sessionId = null,
  timeoutMs = EMBEDDING_DEFAULTS.TIMEOUT_MS,
  maxAttempts = EMBEDDING_DEFAULTS.MAX_ATTEMPTS,
  retryDelayMs = EMBEDDING_DEFAULTS.RETRY_DELAY_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  openaiClient = null,
  databaseClient = null
}) {
  const safeQuery = requireNonEmptyString(query, 'query');
  requirePositiveInteger(userId, 'userId');
  const safeModel = requireNonEmptyString(model, 'model');
  const safeDimensions = requirePositiveInteger(Number(dimensions), 'dimensions');

  const { openai, safeBaseUrl, provider } = openaiClient
    ? { openai: openaiClient, safeBaseUrl: baseUrl || 'https://ai.sumopod.com/v1', provider: 'test-provider' }
    : await createSafeEmbeddingOpenAIClient({
        baseUrl,
        apiKey,
        timeoutMs
      });

  let context = createAIRequestContext({
    requestKind: 'embedding',
    operation: 'query_embedding'
  });

  while (context.attemptNo <= maxAttempts) {
    const startedAt = Date.now();
    try {
      const response = await openai.embeddings.create({
        model: safeModel,
        input: [safeQuery]
      });

      const latencyMs = Date.now() - startedAt;
      await recordChatbotAIUsageSafely({
        context,
        userId,
        sessionId,
        provider,
        model: safeModel,
        response,
        deliveryStatus: 'NOT_APPLICABLE',
        latencyMs
      }, databaseClient);

      const vector = response?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length !== safeDimensions) {
        throw createEmbeddingError(
          'EMBEDDING_DIMENSION_MISMATCH',
          `Dimensi query embedding (${vector?.length}) tidak sesuai konfigurasi (${safeDimensions}).`
        );
      }

      return {
        vector: new Float32Array(vector),
        vectorBlob: serializeEmbeddingVector(vector),
        dimensions: safeDimensions,
        model: safeModel,
        provider,
        tokens: response?.usage?.prompt_tokens ?? response?.usage?.total_tokens ?? 0,
        latencyMs
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      await recordChatbotAIUsageSafely({
        context,
        userId,
        sessionId,
        provider,
        model: safeModel,
        error: err,
        deliveryStatus: 'NOT_APPLICABLE',
        latencyMs
      }, databaseClient);

      if (context.attemptNo >= maxAttempts || !isRetryableEmbeddingError(err)) {
        throw err;
      }
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      context = createAIRetryContext(context);
    }
  }

  throw createEmbeddingError('EMBEDDING_QUERY_FAILED', 'Query embedding gagal setelah retry.');
}

// ============================================================================
// Publish Chunk Embeddings to SQLite
// ============================================================================

export async function publishRagChunkEmbeddings({
  sourceId,
  userId,
  sourceRevision,
  chunkEmbeddings,
  profile,
  databaseClient = null
}) {
  requirePositiveInteger(sourceId, 'sourceId');
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(sourceRevision, 'sourceRevision');
  if (!profile?.config_hash) {
    throw createEmbeddingError('EMBEDDING_PROFILE_INVALID', 'Profil embedding tidak valid untuk publikasi.');
  }
  const client = await resolveDatabaseClient(databaseClient);

  for (const item of chunkEmbeddings) {
    await client.run(
      `UPDATE rag_chunks
       SET embedding = ?,
           embedding_model = ?,
           embedding_dimensions = ?,
           embedding_config_hash = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE source_id = ?
         AND user_id = ?
         AND source_revision = ?
         AND chunk_index = ?`,
      [
        item.embedding_blob,
        profile.model,
        profile.dimensions,
        profile.config_hash,
        sourceId,
        userId,
        sourceRevision,
        item.chunk_index
      ]
    );
  }

  await client.run(
    `UPDATE rag_sources
     SET embedding_status = 'READY',
         embedding_profile_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND current_revision = ?`,
    [profile.id, sourceId, userId, sourceRevision]
  );

  return {
    sourceId,
    userId,
    sourceRevision,
    publishedCount: chunkEmbeddings.length,
    embeddingStatus: 'READY'
  };
}

// ============================================================================
// Fallback Mode Resolver
// ============================================================================

export function resolveEffectiveRagRetrievalMode({ ragMode, profile }) {
  const requestedMode = String(ragMode || 'off').toLowerCase();
  if (requestedMode === 'off') return 'off';
  if (requestedMode === 'fts') return 'fts';
  if (requestedMode === 'hybrid') {
    if (!profile || profile.capability_status !== EMBEDDING_CAPABILITY_STATUSES.SUPPORTED) {
      return 'fts'; // Fallback to FTS-only if embedding is unavailable
    }
    return 'hybrid';
  }
  return 'off';
}
