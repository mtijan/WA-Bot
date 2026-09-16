import { RAG_CONTEXT_DEFAULTS } from './chatbot_ai_rag_context.service.js';

export const RAG_AUTO_CONFIGURATION = Object.freeze({
  rag_top_k: 4,
  rag_context_tokens: 1000,
  rag_input_budget_tokens: 2200,
  temperature: 0.3,
  cache_enabled: 0,
  direct_answer_enabled: 1,
  debounce_ms: 3000
});

export const RAG_RETENTION_POLICY = Object.freeze({
  response_cache_max_seconds: 86400,
  usage_days: 30,
  completed_index_job_days: 7,
  source_embeddings: 'SOURCE_LIFECYCLE',
  query_embeddings: 'TRANSIENT_NOT_STORED',
  prompt_and_reply_logging: 'PROHIBITED',
  pii_response_cache: 'PROHIBITED'
});

const ACTIVE_RAG_MODES = new Set(['fts', 'hybrid']);
const BUSINESS_MARKERS = new Set([
  'akreditasi', 'alamat', 'beasiswa', 'biaya', 'bayar', 'daftar', 'jadwal',
  'kelas', 'kontak', 'kuliah', 'pendaftaran', 'program', 'rekening', 'syarat',
  'transfer', 'uang', 'whatsapp', 'zoom'
]);
const SOCIAL_PATTERNS = Object.freeze([
  /^(?:hai+|halo+|hello+|hi+|hei+|hey+)(?:\s+(?:kak|admin|min|bot))?$/u,
  /^(?:selamat\s+(?:pagi|siang|sore|malam))(?:\s+(?:kak|admin|min|bot))?$/u,
  /^(?:apa\s+kabar|gimana\s+kabarnya)(?:\s+(?:kak|admin|min|bot))?$/u,
  /^(?:makasih|terima\s+kasih|thanks|thank\s+you)(?:\s+(?:ya|kak|admin|min|bot))?$/u,
  /^(?:siapa\s+(?:nama\s+)?kamu|kamu\s+siapa)$/u,
  /^(?:ass?alamu['’]?alaikum|wa['’]?alaikumsalam)$/u
]);

function normalizeQuery(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('id-ID')
    .replace(/[^\p{L}\p{N}'’\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeMode(value) {
  const mode = String(value || 'off').trim().toLowerCase();
  return ACTIVE_RAG_MODES.has(mode) ? mode : 'off';
}

export function classifyRagConversationQuery(query) {
  const normalized = normalizeQuery(query);
  if (!normalized || normalized.length > 120) {
    return Object.freeze({ kind: 'knowledge', reason: 'not_short_social' });
  }
  const tokens = normalized.split(' ');
  if (tokens.some((token) => BUSINESS_MARKERS.has(token))) {
    return Object.freeze({ kind: 'knowledge', reason: 'business_marker' });
  }
  const social = SOCIAL_PATTERNS.some((pattern) => pattern.test(normalized));
  return Object.freeze({
    kind: social ? 'social' : 'knowledge',
    reason: social ? 'social_pattern' : 'not_social_pattern'
  });
}

export function resolveRagQueryPolicy({
  query,
  mode = 'hybrid',
  hasQueryVector = false,
  explicitThreshold = null
} = {}) {
  const classification = classifyRagConversationQuery(query);
  if (classification.kind === 'social') {
    return Object.freeze({
      query_kind: 'social',
      should_retrieve: false,
      relevance_threshold: null,
      threshold_source: 'conversational_bypass'
    });
  }

  const safeMode = normalizeMode(mode);
  if (safeMode !== 'hybrid' || !hasQueryVector) {
    return Object.freeze({
      query_kind: 'knowledge',
      should_retrieve: true,
      relevance_threshold: 0,
      threshold_source: 'lexical'
    });
  }

  const parsedExplicit = Number(explicitThreshold);
  const hasExplicit = explicitThreshold !== null && explicitThreshold !== undefined
    && Number.isFinite(parsedExplicit) && parsedExplicit >= 0 && parsedExplicit <= 1;
  return Object.freeze({
    query_kind: 'knowledge',
    should_retrieve: true,
    relevance_threshold: hasExplicit
      ? parsedExplicit
      : RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD,
    threshold_source: hasExplicit ? 'explicit' : 'calibrated_hybrid'
  });
}

export function resolveRagAutoConfiguration({
  requestedMode,
  previousMode = 'off',
  payload = {}
} = {}) {
  const nextMode = normalizeMode(requestedMode);
  const activating = normalizeMode(previousMode) === 'off' && ACTIVE_RAG_MODES.has(nextMode);
  if (!activating) {
    return Object.freeze({ activating: false, applied: Object.freeze({}), source: 'unchanged' });
  }
  const applied = {};
  for (const [key, recommendedValue] of Object.entries(RAG_AUTO_CONFIGURATION)) {
    applied[key] = payload[key] === undefined ? recommendedValue : payload[key];
  }
  return Object.freeze({
    activating: true,
    applied: Object.freeze(applied),
    source: Object.keys(RAG_AUTO_CONFIGURATION).some((key) => payload[key] === undefined)
      ? 'recommended_defaults_with_explicit_overrides'
      : 'explicit_ui_configuration'
  });
}

function diagnosticCheck(id, passed, severity, message) {
  return Object.freeze({ id, passed: Boolean(passed), severity, message });
}

export function buildRagPreflightDiagnostic({ status = {}, settings = {} } = {}) {
  const mode = normalizeMode(settings.rag_mode ?? status.rag_mode);
  if (mode === 'off') {
    return Object.freeze({
      state: 'DISABLED',
      ready: false,
      requested_mode: 'off',
      effective_mode: 'off',
      checks: Object.freeze([]),
      blocking_codes: Object.freeze([]),
      warning_codes: Object.freeze([])
    });
  }

  const sourceCount = Number(status.sources_count ?? status.source_count) || 0;
  const chunkCount = Number(status.chunks_count ?? status.chunk_count) || 0;
  const checks = [
    diagnosticCheck('SOURCE_AVAILABLE', sourceCount > 0, 'blocking', 'Minimal satu sumber aktif harus tersedia.'),
    diagnosticCheck('CHUNK_AVAILABLE', chunkCount > 0, 'blocking', 'Minimal satu chunk hasil indeks harus tersedia.'),
    diagnosticCheck('LEXICAL_READY', status.lexical_ready === true, 'blocking', 'Indeks leksikal harus READY.'),
    diagnosticCheck('INDEX_JOB_IDLE', !status.active_job, 'warning', 'Job indeks masih berjalan.'),
    diagnosticCheck(
      'EMBEDDING_READY',
      mode !== 'hybrid' || status.embedding_ready === true,
      'warning',
      'Embedding belum siap; Hybrid akan memakai FTS-only.'
    ),
    diagnosticCheck(
      'CACHE_RETENTION_BOUNDED',
      Number(settings.cache_enabled ?? 0) !== 1
        || Number(settings.cache_ttl_seconds) <= RAG_RETENTION_POLICY.response_cache_max_seconds,
      'blocking',
      'TTL cache tidak boleh melebihi 24 jam.'
    )
  ];
  const blockingCodes = checks
    .filter((check) => check.severity === 'blocking' && !check.passed)
    .map((check) => check.id);
  const warningCodes = checks
    .filter((check) => check.severity === 'warning' && !check.passed)
    .map((check) => check.id);
  const lexicalReady = status.lexical_ready === true && sourceCount > 0 && chunkCount > 0;
  const effectiveMode = mode === 'hybrid' && status.embedding_ready === true
    ? 'hybrid'
    : (lexicalReady ? 'fts' : null);
  return Object.freeze({
    state: blockingCodes.length === 0 ? (warningCodes.length ? 'READY_WITH_WARNINGS' : 'READY') : 'BLOCKED',
    ready: blockingCodes.length === 0,
    requested_mode: mode,
    effective_mode: effectiveMode,
    checks: Object.freeze(checks),
    blocking_codes: Object.freeze(blockingCodes),
    warning_codes: Object.freeze(warningCodes)
  });
}
