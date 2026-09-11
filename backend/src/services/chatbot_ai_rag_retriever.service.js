import {
  EMBEDDING_CAPABILITY_STATUSES,
  rankChunksByCosineSimilarity
} from './chatbot_ai_embedding.service.js';

const INDONESIAN_STOP_WORDS = new Set([
  'aku',
  'apa',
  'apakah',
  'atau',
  'bagaimana',
  'berapa',
  'dan',
  'dari',
  'dengan',
  'di',
  'dimana',
  'dong',
  'gimana',
  'info',
  'kah',
  'kami',
  'kapan',
  'ke',
  'kita',
  'minta',
  'nih',
  'pada',
  'saya',
  'siapa',
  'tentang',
  'tolong',
  'untuk',
  'ya',
  'yang'
]);

const ALLOWED_SOURCE_TYPES = new Set(['flow', 'manual']);

export const RAG_RETRIEVAL_DEFAULTS = Object.freeze({
  MAX_QUERY_CHARACTERS: 1000,
  MAX_QUERY_TOKENS: 32,
  LEXICAL_CANDIDATE_LIMIT: 50,
  SEMANTIC_CANDIDATE_LIMIT: 5000,
  MAX_LEXICAL_CANDIDATES: 200,
  MAX_SEMANTIC_CANDIDATES: 5000,
  RRF_K: 60,
  MMR_LAMBDA: 0.75
});

export function createRagRetrievalError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      `${field} harus berupa integer positif.`
    );
  }
  return value;
}

function requireSessionId(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (!normalized) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      'sessionId wajib diisi.'
    );
  }
  return normalized;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function normalizeIndonesianToken(token) {
  if (token.length > 5 && token.endsWith('nya')) {
    return token.slice(0, -3);
  }
  return token;
}

function buildFtsMatchQuery(tokens) {
  return tokens
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ');
}

export function normalizeIndonesianQuery(query, {
  removeStopWords = true,
  maxCharacters = RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_CHARACTERS,
  maxTokens = RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_TOKENS
} = {}) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_EMPTY_QUERY',
      'Query retrieval wajib berupa string non-kosong.'
    );
  }

  const safeMaxCharacters = clampInteger(
    maxCharacters,
    RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_CHARACTERS,
    1,
    RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_CHARACTERS
  );
  const safeMaxTokens = clampInteger(
    maxTokens,
    RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_TOKENS,
    1,
    RAG_RETRIEVAL_DEFAULTS.MAX_QUERY_TOKENS
  );
  const canonical = query
    .slice(0, safeMaxCharacters)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('id-ID');
  const rawTokens = canonical.match(/[\p{L}\p{N}]+/gu) || [];
  const normalizedTokens = rawTokens.map(normalizeIndonesianToken);
  const meaningfulTokens = removeStopWords
    ? normalizedTokens.filter((token) => !INDONESIAN_STOP_WORDS.has(token))
    : normalizedTokens;
  const sourceTokens = meaningfulTokens.length > 0 ? meaningfulTokens : normalizedTokens;
  const tokens = [...new Set(sourceTokens)].slice(0, safeMaxTokens);

  if (tokens.length === 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_EMPTY_QUERY',
      'Query retrieval tidak memiliki token lexical yang dapat dicari.'
    );
  }

  return Object.freeze({
    original: query,
    normalized: tokens.join(' '),
    tokens: Object.freeze(tokens),
    ftsQuery: buildFtsMatchQuery(tokens)
  });
}

let runtimeDatabaseClientPromise = null;

async function getRuntimeDatabaseClient() {
  if (!runtimeDatabaseClientPromise) {
    runtimeDatabaseClientPromise = import('../database.js').then(({ dbGet, dbAll }) => ({
      get: dbGet,
      all: dbAll
    }));
  }
  return runtimeDatabaseClientPromise;
}

async function resolveDatabaseClient(databaseClient = null) {
  const client = databaseClient || await getRuntimeDatabaseClient();
  if (!client || typeof client.get !== 'function' || typeof client.all !== 'function') {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_DATABASE_CLIENT_REQUIRED',
      'Database client retriever harus menyediakan fungsi get dan all.'
    );
  }
  return client;
}

function normalizeSourceTypes(sourceTypes) {
  const values = sourceTypes === undefined || sourceTypes === null
    ? [...ALLOWED_SOURCE_TYPES]
    : (Array.isArray(sourceTypes) ? sourceTypes : [sourceTypes]);
  const normalized = [...new Set(values.map((value) => String(value || '').trim().toLowerCase()))];
  if (normalized.length === 0 || normalized.some((value) => !ALLOWED_SOURCE_TYPES.has(value))) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_SOURCE_TYPE',
      'sourceTypes hanya boleh berisi flow dan/atau manual.'
    );
  }
  return normalized;
}

function parseChunkMetadata(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function assertOwnedSession(client, userId, sessionId) {
  const session = await client.get(
    'SELECT session_id FROM sessions WHERE session_id = ? AND user_id = ?',
    [sessionId, userId]
  );
  if (!session) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_SESSION_NOT_FOUND',
      'Sesi tidak ditemukan untuk tenant yang diminta.'
    );
  }
}

function mapBaseChunk(row) {
  return {
    chunk_id: Number(row.chunk_id),
    source_id: Number(row.source_id),
    source_type: row.source_type,
    source_revision: Number(row.source_revision),
    chunk_index: Number(row.chunk_index),
    chunk_text: row.chunk_text,
    token_count: Number(row.token_count),
    content_hash: row.content_hash,
    metadata: parseChunkMetadata(row.metadata_json)
  };
}

export async function searchRagLexical({
  userId,
  sessionId,
  query,
  sourceTypes = null,
  candidateLimit = RAG_RETRIEVAL_DEFAULTS.LEXICAL_CANDIDATE_LIMIT
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = requireSessionId(sessionId);
  const normalizedQuery = normalizeIndonesianQuery(query);
  const safeSourceTypes = normalizeSourceTypes(sourceTypes);
  const safeLimit = clampInteger(
    candidateLimit,
    RAG_RETRIEVAL_DEFAULTS.LEXICAL_CANDIDATE_LIMIT,
    1,
    RAG_RETRIEVAL_DEFAULTS.MAX_LEXICAL_CANDIDATES
  );
  const client = await resolveDatabaseClient(databaseClient);
  await assertOwnedSession(client, userId, safeSessionId);

  const sourceTypePlaceholders = safeSourceTypes.map(() => '?').join(', ');
  const rows = await client.all(
    `SELECT c.id AS chunk_id, c.source_id, s.source_type,
            c.source_revision, c.chunk_index, c.chunk_text, c.token_count,
            c.content_hash, c.metadata_json,
            bm25(rag_chunks_fts) AS bm25_score
     FROM rag_chunks_fts
     JOIN rag_chunks AS c ON c.id = rag_chunks_fts.rowid
     JOIN rag_sources AS s
       ON s.id = c.source_id AND s.user_id = c.user_id
     JOIN rag_session_sources AS rss
       ON rss.source_id = s.id AND rss.user_id = s.user_id
     JOIN sessions AS sess
       ON sess.session_id = rss.session_id AND sess.user_id = rss.user_id
     WHERE rag_chunks_fts MATCH ?
       AND sess.session_id = ? AND sess.user_id = ?
       AND s.user_id = ? AND s.is_active = 1
       AND s.lexical_status = 'READY'
       AND s.indexed_revision = s.current_revision
       AND c.source_revision = s.current_revision
       AND s.source_type IN (${sourceTypePlaceholders})
     ORDER BY bm25(rag_chunks_fts) ASC, c.id ASC
     LIMIT ?`,
    [normalizedQuery.ftsQuery, safeSessionId, userId, userId, ...safeSourceTypes, safeLimit]
  );

  return rows.map((row, index) => ({
    ...mapBaseChunk(row),
    lexical_rank: index + 1,
    lexical_score: -Number(row.bm25_score || 0),
    score: -Number(row.bm25_score || 0),
    retrieval_channel: 'lexical'
  }));
}

async function resolveSessionEmbeddingProfile(client, userId, sessionId) {
  const profile = await client.get(
    `SELECT p.id, p.model, p.dimensions, p.config_hash, p.capability_status
     FROM sessions AS sess
     JOIN chatbot_ai_settings AS settings
       ON settings.session_id = sess.session_id AND settings.user_id = sess.user_id
     JOIN rag_embedding_profiles AS p
       ON p.id = settings.embedding_profile_id AND p.user_id = settings.user_id
     WHERE sess.session_id = ? AND sess.user_id = ?
       AND settings.rag_mode = 'hybrid'`,
    [sessionId, userId]
  );
  if (!profile || profile.capability_status !== EMBEDDING_CAPABILITY_STATUSES.SUPPORTED) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_EMBEDDING_UNAVAILABLE',
      'Profil embedding aktif dan terverifikasi tidak tersedia untuk sesi.'
    );
  }
  return profile;
}

export async function searchRagSemantic({
  userId,
  sessionId,
  queryVector,
  sourceTypes = null,
  candidateLimit = RAG_RETRIEVAL_DEFAULTS.SEMANTIC_CANDIDATE_LIMIT,
  minSimilarity = null
}, databaseClient = null) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = requireSessionId(sessionId);
  const safeSourceTypes = normalizeSourceTypes(sourceTypes);
  const safeLimit = clampInteger(
    candidateLimit,
    RAG_RETRIEVAL_DEFAULTS.SEMANTIC_CANDIDATE_LIMIT,
    1,
    RAG_RETRIEVAL_DEFAULTS.MAX_SEMANTIC_CANDIDATES
  );
  const client = await resolveDatabaseClient(databaseClient);
  await assertOwnedSession(client, userId, safeSessionId);
  const profile = await resolveSessionEmbeddingProfile(client, userId, safeSessionId);

  const sourceTypePlaceholders = safeSourceTypes.map(() => '?').join(', ');
  const rows = await client.all(
    `SELECT c.id AS chunk_id, c.source_id, s.source_type,
            c.source_revision, c.chunk_index, c.chunk_text, c.token_count,
            c.content_hash, c.metadata_json, c.embedding
     FROM rag_chunks AS c
     JOIN rag_sources AS s
       ON s.id = c.source_id AND s.user_id = c.user_id
     JOIN rag_session_sources AS rss
       ON rss.source_id = s.id AND rss.user_id = s.user_id
     JOIN sessions AS sess
       ON sess.session_id = rss.session_id AND sess.user_id = rss.user_id
     WHERE sess.session_id = ? AND sess.user_id = ?
       AND s.user_id = ? AND s.is_active = 1
       AND s.embedding_status = 'READY'
       AND s.embedding_profile_id = ?
       AND s.indexed_revision = s.current_revision
       AND c.source_revision = s.current_revision
       AND c.embedding IS NOT NULL
       AND c.embedding_model = ?
       AND c.embedding_dimensions = ?
       AND c.embedding_config_hash = ?
       AND s.source_type IN (${sourceTypePlaceholders})
     ORDER BY c.id ASC
     LIMIT ?`,
    [
      safeSessionId,
      userId,
      userId,
      profile.id,
      profile.model,
      profile.dimensions,
      profile.config_hash,
      ...safeSourceTypes,
      safeLimit
    ]
  );

  const ranked = rankChunksByCosineSimilarity({
    queryVector,
    chunks: rows,
    topK: Math.max(1, rows.length),
    minSimilarity,
    expectedDimensions: Number(profile.dimensions)
  });

  return ranked.map((row, index) => ({
    ...mapBaseChunk(row),
    semantic_rank: index + 1,
    semantic_score: Number(row.similarity),
    score: Number(row.similarity),
    retrieval_channel: 'semantic'
  }));
}

function requireRankedResults(value, field) {
  if (!Array.isArray(value)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_INPUT',
      `${field} harus berupa array hasil retrieval.`
    );
  }
  return value;
}

function candidateKey(candidate) {
  const chunkId = Number(candidate?.chunk_id);
  if (!Number.isInteger(chunkId) || chunkId <= 0) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_CANDIDATE',
      'Setiap kandidat retrieval wajib memiliki chunk_id integer positif.'
    );
  }
  return chunkId;
}

export function reciprocalRankFusion({
  lexicalResults = [],
  semanticResults = [],
  rrfK = RAG_RETRIEVAL_DEFAULTS.RRF_K,
  lexicalWeight = 1,
  semanticWeight = 1
} = {}) {
  const lexical = requireRankedResults(lexicalResults, 'lexicalResults');
  const semantic = requireRankedResults(semanticResults, 'semanticResults');
  const safeRrfK = clampInteger(rrfK, RAG_RETRIEVAL_DEFAULTS.RRF_K, 1, 1000);
  const safeLexicalWeight = Number(lexicalWeight);
  const safeSemanticWeight = Number(semanticWeight);
  if (!Number.isFinite(safeLexicalWeight) || safeLexicalWeight < 0
      || !Number.isFinite(safeSemanticWeight) || safeSemanticWeight < 0
      || (safeLexicalWeight === 0 && safeSemanticWeight === 0)) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_WEIGHT',
      'Bobot lexical dan semantic harus non-negatif dan tidak boleh keduanya nol.'
    );
  }

  const fused = new Map();
  const addChannel = (items, channel, weight) => {
    const seen = new Set();
    items.forEach((item, index) => {
      const key = candidateKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      const existing = fused.get(key) || {
        ...item,
        lexical_rank: null,
        semantic_rank: null,
        lexical_score: null,
        semantic_score: null,
        rrf_score: 0,
        retrieval_channels: []
      };
      const rank = index + 1;
      existing[`${channel}_rank`] = rank;
      existing[`${channel}_score`] = Number(item[`${channel}_score`] ?? item.score ?? 0);
      existing.rrf_score += weight / (safeRrfK + rank);
      if (!existing.retrieval_channels.includes(channel)) {
        existing.retrieval_channels.push(channel);
      }
      fused.set(key, existing);
    });
  };

  addChannel(lexical, 'lexical', safeLexicalWeight);
  addChannel(semantic, 'semantic', safeSemanticWeight);

  return [...fused.values()]
    .sort((a, b) => {
      if (b.rrf_score !== a.rrf_score) return b.rrf_score - a.rrf_score;
      const aBestRank = Math.min(a.lexical_rank || Infinity, a.semantic_rank || Infinity);
      const bBestRank = Math.min(b.lexical_rank || Infinity, b.semantic_rank || Infinity);
      if (aBestRank !== bBestRank) return aBestRank - bBestRank;
      return Number(a.chunk_id) - Number(b.chunk_id);
    })
    .map((item, index) => ({ ...item, fused_rank: index + 1, score: item.rrf_score }));
}

function normalizedTextTokens(text) {
  const canonical = String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('id-ID');
  return new Set(canonical.match(/[\p{L}\p{N}]+/gu) || []);
}

function jaccardSimilarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function candidateRelevance(candidate) {
  const value = candidate?.rrf_score
    ?? candidate?.semantic_score
    ?? candidate?.lexical_score
    ?? candidate?.score
    ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function deduplicateAndDiversifyRagResults(results = [], {
  lambda = RAG_RETRIEVAL_DEFAULTS.MMR_LAMBDA,
  maxResults = null
} = {}) {
  const ranked = requireRankedResults(results, 'results');
  const safeLambda = Number(lambda);
  if (!Number.isFinite(safeLambda) || safeLambda < 0 || safeLambda > 1) {
    throw createRagRetrievalError(
      'RAG_RETRIEVAL_INVALID_MMR_LAMBDA',
      'lambda MMR harus berada pada rentang 0 sampai 1.'
    );
  }

  const seenChunkIds = new Set();
  const seenHashes = new Set();
  const seenTexts = new Set();
  const unique = [];
  ranked.forEach((candidate, originalIndex) => {
    const chunkId = candidateKey(candidate);
    const hash = String(candidate.content_hash || '').trim();
    const textKey = [...normalizedTextTokens(candidate.chunk_text)].sort().join(' ');
    if (seenChunkIds.has(chunkId)
        || (hash && seenHashes.has(hash))
        || (textKey && seenTexts.has(textKey))) {
      return;
    }
    seenChunkIds.add(chunkId);
    if (hash) seenHashes.add(hash);
    if (textKey) seenTexts.add(textKey);
    unique.push({
      candidate,
      originalIndex,
      relevance: candidateRelevance(candidate),
      tokens: normalizedTextTokens(candidate.chunk_text)
    });
  });

  if (unique.length === 0) return [];
  const safeMaxResults = maxResults === null || maxResults === undefined
    ? unique.length
    : clampInteger(maxResults, unique.length, 1, unique.length);
  const relevanceValues = unique.map((item) => item.relevance);
  const minRelevance = Math.min(...relevanceValues);
  const maxRelevance = Math.max(...relevanceValues);
  unique.forEach((item) => {
    item.normalizedRelevance = maxRelevance === minRelevance
      ? 1
      : (item.relevance - minRelevance) / (maxRelevance - minRelevance);
  });

  const remaining = [...unique];
  const selected = [];
  while (remaining.length > 0 && selected.length < safeMaxResults) {
    let bestIndex = 0;
    let bestMmr = -Infinity;
    let bestSimilarity = 0;
    remaining.forEach((item, index) => {
      const maxSimilarity = selected.length === 0
        ? 0
        : Math.max(...selected.map((chosen) => jaccardSimilarity(item.tokens, chosen.tokens)));
      const mmrScore = (safeLambda * item.normalizedRelevance)
        - ((1 - safeLambda) * maxSimilarity);
      const currentBest = remaining[bestIndex];
      if (mmrScore > bestMmr
          || (mmrScore === bestMmr && item.relevance > currentBest.relevance)
          || (mmrScore === bestMmr && item.relevance === currentBest.relevance
            && item.originalIndex < currentBest.originalIndex)) {
        bestIndex = index;
        bestMmr = mmrScore;
        bestSimilarity = maxSimilarity;
      }
    });
    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push({ ...chosen, mmrScore: bestMmr, maxSimilarity: bestSimilarity });
  }

  return selected.map((item, index) => ({
    ...item.candidate,
    mmr_rank: index + 1,
    mmr_score: item.mmrScore,
    max_selected_similarity: item.maxSimilarity,
    score: item.candidate.rrf_score ?? item.candidate.score ?? item.relevance
  }));
}
