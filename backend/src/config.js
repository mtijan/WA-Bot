import './env.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:4173',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://192.168.1.16:4173',
  'http://192.168.1.16:5173',
  'http://192.168.1.16:5174',
  'http://192.168.1.16:5175',
  'http://[::1]:4173',
  'http://[::1]:5173',
  'http://[::1]:5174',
  'http://[::1]:5175'
];

export function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseOptionalPositiveInteger(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

export function splitCsv(value, fallback = []) {
  if (!value) return fallback;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parsePositiveInteger(process.env.PORT, 3001),
  trustProxyHops: parseOptionalPositiveInteger(process.env.WA_BOT_TRUST_PROXY_HOPS),
  allowedOrigins: splitCsv(process.env.WA_BOT_ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS),
  apiKey: process.env.WA_BOT_API_KEY || '',
  admin: {
    username: process.env.WA_BOT_ADMIN_USERNAME || 'admin',
    password: process.env.WA_BOT_ADMIN_PASSWORD || '',
    sessionSecret: process.env.WA_BOT_ADMIN_SESSION_SECRET || '',
    sessionTtlMs: parsePositiveInteger(process.env.WA_BOT_ADMIN_SESSION_TTL_MS, 12 * 60 * 60 * 1000),
    cookieSecure: process.env.WA_BOT_COOKIE_SECURE === 'true'
  },
  security: {
    frameAncestors: process.env.WA_BOT_FRAME_ANCESTORS || "'none'",
    jsonBodyLimit: process.env.WA_BOT_JSON_BODY_LIMIT || '2mb',
    importBodyLimit: process.env.WA_BOT_IMPORT_BODY_LIMIT || '60mb',
    rateLimitWindowMs: parsePositiveInteger(process.env.WA_BOT_RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: parsePositiveInteger(process.env.WA_BOT_RATE_LIMIT_MAX, 120)
  },
  runtime: {
    role: (process.env.WA_BOT_PROCESS_ROLE || 'all').trim().toLowerCase(),
    heartbeatMs: parsePositiveInteger(process.env.WA_BOT_PROCESS_HEARTBEAT_MS, 60_000),
    campaignWorkerPollMs: parsePositiveInteger(process.env.WA_BOT_CAMPAIGN_WORKER_POLL_MS, 15_000),
    warmerWorkerPollMs: parsePositiveInteger(process.env.WA_BOT_WARMER_WORKER_POLL_MS, 30_000),
    ragIndexWorkerEnabled: parseBoolean(process.env.WA_BOT_RAG_INDEX_WORKER_ENABLED, false),
    ragIndexWorkerPollMs: parsePositiveInteger(process.env.WA_BOT_RAG_INDEX_WORKER_POLL_MS, 5_000),
    ragIndexWorkerBatchSize: parsePositiveInteger(process.env.WA_BOT_RAG_INDEX_WORKER_BATCH_SIZE, 10)
  },
  rag: {
    rolloutMode: (process.env.WA_BOT_RAG_ROLLOUT_MODE || 'all').trim().toLowerCase(),
    rolloutSessions: splitCsv(process.env.WA_BOT_RAG_ROLLOUT_SESSIONS, [])
  },
  internal: {
    token: process.env.WA_BOT_INTERNAL_TOKEN || '',
    port: parseOptionalPositiveInteger(process.env.WA_BOT_INTERNAL_PORT),
    sessionManagerUrl: process.env.WA_BOT_SESSION_MANAGER_URL || ''
  },
  integrations: {
    iplocateApiKey: process.env.WA_BOT_IPLOCATE_API_KEY || ''
  },
  aiBudget: {
    dailyLimitMicrousd: parseNonNegativeInteger(process.env.WA_BOT_AI_DAILY_BUDGET_MICROUSD, 0),
    attemptReservationMicrousd: parseNonNegativeInteger(process.env.WA_BOT_AI_ATTEMPT_RESERVATION_MICROUSD, 0),
    reservationTtlSeconds: parsePositiveInteger(process.env.WA_BOT_AI_BUDGET_RESERVATION_TTL_SECONDS, 120),
    circuitFailureThreshold: parseNonNegativeInteger(process.env.WA_BOT_AI_CIRCUIT_FAILURE_THRESHOLD, 5),
    circuitWindowSeconds: parsePositiveInteger(process.env.WA_BOT_AI_CIRCUIT_WINDOW_SECONDS, 300)
  },
  uploads: {
    mediaDir: process.env.WA_BOT_MEDIA_UPLOAD_DIR || '',
    contactImportMaxBytes: parsePositiveInteger(process.env.WA_BOT_CONTACT_IMPORT_MAX_BYTES, 5 * 1024 * 1024),
    imageMaxBytes: parsePositiveInteger(process.env.WA_BOT_IMAGE_UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
    videoMaxBytes: parsePositiveInteger(process.env.WA_BOT_VIDEO_UPLOAD_MAX_BYTES, 10 * 1024 * 1024)
  }
};
