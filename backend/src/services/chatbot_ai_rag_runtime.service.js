import { dbGet, dbAll } from '../database.js';
import { config } from '../config.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../utils/outbound_url.js';
import { revealSecret } from './secret.service.js';
import { resolveKnowledgeBase } from './chatbot_ai.service.js';
import { buildChatCompletionPayload, resolveChatTemperature } from './chatbot_ai_runtime.service.js';
import {
  buildProductionMessages,
  buildRagProductionMessages
} from './chatbot_ai_prompt.service.js';
import { executeInstrumentedChatCompletion } from './chatbot_ai_provider.service.js';
import {
  recordChatbotAIUsageSafely,
  resolveAIProvider
} from './chatbot_ai_usage.service.js';
import {
  getTenantEmbeddingProfile,
  generateQueryEmbedding,
  resolveEffectiveRagRetrievalMode
} from './chatbot_ai_embedding.service.js';
import {
  RAG_CONTEXT_DEFAULTS,
  retrieveRagContext
} from './chatbot_ai_rag_context.service.js';
import { estimateRagTokens } from './chatbot_ai_rag_extractor.service.js';
import { recordRagRuntimeEvent } from './chatbot_ai_rag_telemetry.service.js';
import {
  lookupCachedResponse,
  storeCachedResponse,
  shouldCacheResult
} from './chatbot_ai_rag_cache.service.js';

export const CS_FALLBACK_MESSAGE =
  'Mohon maaf, saya belum bisa menjawab pertanyaan tersebut saat ini. ' +
  'Silakan hubungi customer service kami untuk informasi lebih lanjut.';

export const RAG_RUNTIME_STATUSES = Object.freeze({
  REPLIED: 'REPLIED',
  EMPTY_REPLY: 'EMPTY_REPLY',
  CS_FALLBACK: 'CS_FALLBACK',
  ERROR: 'ERROR',
  SKIPPED: 'SKIPPED'
});

const CHATBOT_MODES = new Set(['off', 'flow', 'ai', 'both']);

function createRuntimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRuntimeError('RAG_RUNTIME_INVALID_INPUT', `${field} harus integer positif.`);
  }
  return value;
}

function requireNonEmptyString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createRuntimeError('RAG_RUNTIME_INVALID_INPUT', `${field} wajib diisi.`);
  }
  return normalized;
}

function resolveDatabaseClient(databaseClient = null) {
  if (databaseClient) {
    if (typeof databaseClient.get !== 'function' || typeof databaseClient.all !== 'function') {
      throw createRuntimeError(
        'RAG_RUNTIME_DATABASE_CLIENT_REQUIRED',
        'Database client runtime harus menyediakan fungsi get dan all.'
      );
    }
    return databaseClient;
  }
  return { get: dbGet, all: dbAll };
}

export function normalizeChatbotMode(value) {
  const normalized = String(value || 'both').trim().toLowerCase();
  return CHATBOT_MODES.has(normalized) ? normalized : 'both';
}

export function shouldEvaluateFlow(chatbotMode) {
  const mode = normalizeChatbotMode(chatbotMode);
  return mode === 'flow' || mode === 'both';
}

export function shouldProcessAIFallback({
  chatbotMode,
  matchedFlow = null,
  isGroup = false,
  aiSettings = null
} = {}) {
  const mode = normalizeChatbotMode(chatbotMode);
  return !matchedFlow
    && !isGroup
    && (mode === 'ai' || mode === 'both')
    && aiSettings?.is_active === 1;
}

export function isSessionRagRolloutEnabled(sessionId, {
  aiSettings = null,
  rolloutMode = config?.rag?.rolloutMode || 'all',
  rolloutSessions = config?.rag?.rolloutSessions || [],
  overrideFlag = null
} = {}) {
  if (typeof overrideFlag === 'boolean') {
    return overrideFlag;
  }
  if (aiSettings && typeof aiSettings.rag_enabled === 'boolean') {
    return aiSettings.rag_enabled;
  }
  if (aiSettings && (aiSettings.rag_enabled === 1 || aiSettings.rag_enabled === 0)) {
    return Boolean(aiSettings.rag_enabled);
  }

  const mode = String(rolloutMode || 'all').trim().toLowerCase();
  if (mode === 'disabled' || mode === 'off') {
    return false;
  }
  if (mode === 'allowlist' || mode === 'sessions') {
    if (!sessionId) return false;
    const safeSessionId = String(sessionId).trim();
    const allowed = Array.isArray(rolloutSessions) ? rolloutSessions : [];
    return allowed.includes(safeSessionId);
  }
  return true;
}

export function shouldUseRag(aiSettings, {
  sessionId = null,
  rolloutMode = null,
  rolloutSessions = null,
  overrideFlag = null
} = {}) {
  const mode = String(aiSettings?.rag_mode || 'off').trim().toLowerCase();
  const isModeEnabled = mode === 'fts' || mode === 'hybrid';
  if (!isModeEnabled) return false;

  return isSessionRagRolloutEnabled(sessionId, {
    aiSettings,
    rolloutMode: rolloutMode ?? config?.rag?.rolloutMode,
    rolloutSessions: rolloutSessions ?? config?.rag?.rolloutSessions,
    overrideFlag
  });
}

export function estimateChatInputTokens(messages, tokenEstimator = estimateRagTokens) {
  if (!Array.isArray(messages)) {
    throw createRuntimeError('RAG_RUNTIME_INVALID_INPUT', 'messages harus berupa array.');
  }
  return messages.reduce((total, message) => {
    const role = String(message?.role || '');
    const content = String(message?.content || '');
    return total + 4 + tokenEstimator(role) + tokenEstimator(content);
  }, 2);
}

function resolveHardInputBudget(aiSettings) {
  const configured = Number(aiSettings?.rag_input_budget_tokens);
  if (!Number.isInteger(configured) || configured <= 0) {
    return RAG_CONTEXT_DEFAULTS.HARD_TOTAL_INPUT_TOKENS;
  }
  return Math.min(configured, RAG_CONTEXT_DEFAULTS.HARD_TOTAL_INPUT_TOKENS);
}

function buildFallbackResult(reason, ragMetadata = {}) {
  return {
    status: RAG_RUNTIME_STATUSES.CS_FALLBACK,
    reply: CS_FALLBACK_MESSAGE,
    delivered: false,
    ragMetadata: {
      ...ragMetadata,
      retrieval_reason: reason,
      cs_fallback: true
    },
    usageContext: null,
    error: null
  };
}

export async function checkSessionIndexReadiness(
  userId,
  sessionId,
  databaseClient = null
) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = requireNonEmptyString(sessionId, 'sessionId');
  const client = resolveDatabaseClient(databaseClient);
  const rows = await client.all(
    `SELECT s.id, s.lexical_status, s.current_revision, s.indexed_revision
     FROM sessions AS sess
     JOIN rag_session_sources AS rss
       ON rss.session_id = sess.session_id AND rss.user_id = sess.user_id
     JOIN rag_sources AS s
       ON s.id = rss.source_id AND s.user_id = rss.user_id
     WHERE sess.session_id = ? AND sess.user_id = ? AND s.is_active = 1`,
    [safeSessionId, userId]
  );
  const readyCount = rows.filter((row) =>
    row.lexical_status === 'READY'
      && Number(row.current_revision) === Number(row.indexed_revision)).length;
  return Object.freeze({
    ready: readyCount > 0,
    sourceCount: rows.length,
    readyCount
  });
}

export async function resolveAICredentials(
  aiSettings,
  tenantUserId,
  databaseClient = null
) {
  requirePositiveInteger(tenantUserId, 'tenantUserId');
  if (!aiSettings || typeof aiSettings !== 'object') return null;
  const client = resolveDatabaseClient(databaseClient);
  let apiKey = null;
  let baseUrl = aiSettings.base_url || 'https://ai.sumopod.com/v1';
  let model = aiSettings.model_name || 'gpt-4o-mini';

  if (aiSettings.credential_id) {
    const credential = await client.get(
      `SELECT id, api_key, base_url, model_name
       FROM chatbot_ai_credentials
       WHERE id = ? AND user_id = ? AND is_active = 1`,
      [aiSettings.credential_id, tenantUserId]
    );
    if (!credential?.api_key) return null;
    apiKey = revealSecret(credential.api_key);
    baseUrl = credential.base_url || baseUrl;
    model = credential.model_name || model;
  } else if (aiSettings.api_key) {
    apiKey = revealSecret(aiSettings.api_key);
  }

  return apiKey ? Object.freeze({ apiKey, baseUrl, model }) : null;
}

async function createDefaultChatClient({ apiKey, safeBaseUrl }) {
  const { OpenAI } = await import('openai');
  return new OpenAI({
    apiKey,
    baseURL: safeBaseUrl,
    timeout: 15000,
    maxRetries: 0,
    fetch: createSafeOutboundFetch()
  });
}

export async function recheckDeliveryAccess({
  userId,
  sessionId,
  databaseClient = null
}) {
  requirePositiveInteger(userId, 'userId');
  const safeSessionId = requireNonEmptyString(sessionId, 'sessionId');
  if (!databaseClient) {
    return { allowed: true, reason: 'OK' };
  }
  const client = resolveDatabaseClient(databaseClient);

  try {
    const sessionRow = await client.get(
      `SELECT session_id, user_id, status FROM sessions WHERE session_id = ?`,
      [safeSessionId]
    );
    if (sessionRow) {
      if (Number(sessionRow.user_id) !== Number(userId)) {
        return { allowed: false, reason: 'TENANT_MISMATCH' };
      }
      if (sessionRow.status === 'DELETED') {
        return { allowed: false, reason: 'SESSION_DELETED' };
      }
    } else {
      const anySession = await client.get(`SELECT session_id FROM sessions LIMIT 1`);
      if (anySession) {
        return { allowed: false, reason: 'SESSION_NOT_FOUND' };
      }
    }

    const settingsRow = await client.get(
      `SELECT is_active FROM chatbot_ai_settings WHERE session_id = ? AND user_id = ?`,
      [safeSessionId, userId]
    );
    if (settingsRow && settingsRow.is_active !== 1) {
      return { allowed: false, reason: 'SETTINGS_INACTIVE' };
    }

    return { allowed: true, reason: 'OK' };
  } catch {
    return { allowed: true, reason: 'CHECK_SKIPPED' };
  }
}

function resolveDependencies(overrides = {}) {
  return {
    assertSafeOutboundUrl,
    buildChatCompletionPayload,
    checkSessionIndexReadiness,
    createChatClient: createDefaultChatClient,
    estimateChatInputTokens,
    executeChatCompletion: executeInstrumentedChatCompletion,
    executeRagRetrieval,
    generateQueryEmbedding,
    getTenantEmbeddingProfile,
    isSessionRagRolloutEnabled,
    lookupCachedResponse,
    recheckDeliveryAccess,
    recordUsage: recordChatbotAIUsageSafely,
    recordRuntimeEvent: recordRagRuntimeEvent,
    resolveAIProvider,
    resolveKnowledgeBase,
    retrieveRagContext,
    shouldCacheResult,
    shouldUseRag,
    storeCachedResponse,
    ...overrides
  };
}

export async function executeRagRetrieval({
  userId,
  sessionId,
  cleanText,
  aiSettings,
  baseInputTokens,
  databaseClient = null
}, dependencyOverrides = {}) {
  const dependencies = resolveDependencies(dependencyOverrides);
  const readiness = await dependencies.checkSessionIndexReadiness(
    userId,
    sessionId,
    databaseClient
  );
  if (!readiness.ready) {
    return { ragResult: null, effectiveMode: 'fts', reason: 'index_not_ready' };
  }

  let effectiveMode = 'fts';
  let embeddingFallback = false;
  let queryVector = null;

  if (String(aiSettings.rag_mode).trim().toLowerCase() === 'hybrid') {
    try {
      const profile = await dependencies.getTenantEmbeddingProfile(userId, databaseClient);
      effectiveMode = resolveEffectiveRagRetrievalMode({ ragMode: 'hybrid', profile });
      embeddingFallback = effectiveMode !== 'hybrid';
      if (effectiveMode === 'hybrid') {
        const embedding = await dependencies.generateQueryEmbedding({
          query: cleanText,
          model: profile.model,
          dimensions: profile.dimensions,
          baseUrl: profile.base_url,
          credentialId: profile.credential_id,
          userId,
          sessionId,
          databaseClient
        });
        queryVector = embedding.vector;
        if (!queryVector || queryVector.length !== Number(profile.dimensions)
          || !Array.from(queryVector).every(Number.isFinite)) {
          throw createRuntimeError('INVALID_QUERY_VECTOR', 'Invalid query vector.');
        }
      }
    } catch {
      effectiveMode = 'fts';
      queryVector = null;
      embeddingFallback = true;
    }
  }

  const hardInputBudget = resolveHardInputBudget(aiSettings);
  const retrievalOptions = {
    userId,
    sessionId,
    query: cleanText,
    queryVector,
    mode: queryVector ? 'hybrid' : 'fts',
    relevanceThreshold: RAG_CONTEXT_DEFAULTS.RELEVANCE_THRESHOLD,
    topK: aiSettings.rag_top_k || RAG_CONTEXT_DEFAULTS.TOP_K,
    contextTokenBudget:
      aiSettings.rag_context_tokens || RAG_CONTEXT_DEFAULTS.CONTEXT_TOKEN_BUDGET,
    baseInputTokens,
    targetTotalInputTokens: RAG_CONTEXT_DEFAULTS.TARGET_TOTAL_INPUT_TOKENS,
    hardTotalInputTokens: hardInputBudget
  };
  let ragResult;
  try {
    ragResult = await dependencies.retrieveRagContext(retrievalOptions, databaseClient);
  } catch (error) {
    if (effectiveMode !== 'hybrid') throw error;
    effectiveMode = 'fts';
    embeddingFallback = true;
    ragResult = await dependencies.retrieveRagContext({
      ...retrievalOptions, mode: 'fts', queryVector: null
    }, databaseClient);
  }

  return {
    ragResult,
    effectiveMode,
    embeddingFallback,
    reason: ragResult.selected_count > 0 ? 'ready' : 'no_relevant_chunks'
  };
}

async function processInboundAIMessageCore({
  sessionId,
  userId,
  cleanText,
  aiSettings,
  credentials,
  databaseClient = null,
  deliverReply = null
}, dependencyOverrides = {}) {
  const safeSessionId = requireNonEmptyString(sessionId, 'sessionId');
  const safeText = requireNonEmptyString(cleanText, 'cleanText');
  requirePositiveInteger(userId, 'userId');
  if (!aiSettings || typeof aiSettings !== 'object') {
    throw createRuntimeError('RAG_RUNTIME_INVALID_INPUT', 'aiSettings wajib diisi.');
  }
  if (!credentials?.apiKey || !credentials?.baseUrl) {
    throw createRuntimeError('RAG_RUNTIME_CREDENTIALS_REQUIRED', 'Kredensial AI tidak tersedia.');
  }
  if (deliverReply !== null && typeof deliverReply !== 'function') {
    throw createRuntimeError('RAG_RUNTIME_INVALID_INPUT', 'deliverReply harus berupa fungsi.');
  }

  const dependencies = resolveDependencies(dependencyOverrides);
  const ragEnabled = dependencies.shouldUseRag(aiSettings, {
    sessionId: safeSessionId,
    rolloutMode: dependencyOverrides?.rolloutMode,
    rolloutSessions: dependencyOverrides?.rolloutSessions,
    overrideFlag: dependencyOverrides?.ragOverrideFlag
  });
  const model = credentials.model || 'gpt-4o-mini';
  let usageContext = null;
  let providerResponse = null;
  let usageRecorded = false;
  let providerLatencyMs = null;
  let resolvedProvider = 'unknown';
  let ragMetadata = {
    rag_mode: ragEnabled ? String(aiSettings.rag_mode).toLowerCase() : 'off',
    effective_mode: ragEnabled ? null : 'legacy',
    selected_count: 0,
    retrieval_latency_ms: 0,
    provider_latency_ms: null
  };

  const fallback = async (reason, metadata = ragMetadata) => {
    const result = buildFallbackResult(reason, metadata);
    ragMetadata = result.ragMetadata;
    let delivered = false;
    if (deliverReply) {
      const accessCheck = await dependencies.recheckDeliveryAccess({
        userId,
        sessionId: safeSessionId,
        databaseClient
      });
      if (accessCheck.allowed) {
        await deliverReply(result.reply);
        delivered = true;
      } else {
        ragMetadata = {
          ...ragMetadata,
          delivery_cancelled_reason: accessCheck.reason
        };
      }
    }
    return { ...result, delivered, usageContext };
  };

  try {
    // RAG-0703 / RAG-0704: Response Cache Lookup
    if (aiSettings?.cache_enabled === 1) {
      try {
        const cached = await dependencies.lookupCachedResponse({
          userId,
          sessionId: safeSessionId,
          query: safeText,
          promptVersion: aiSettings.prompt_version || 1,
          configRevision: aiSettings.config_revision || 1,
          model,
          temperature: resolveChatTemperature(ragEnabled ? 'grounded' : 'existing'),
          databaseClient
        });
        if (cached?.cacheHit) {
          let delivered = false;
          if (deliverReply) {
            const accessCheck = await dependencies.recheckDeliveryAccess({
              userId,
              sessionId: safeSessionId,
              databaseClient
            });
            if (!accessCheck.allowed) {
              return {
                status: RAG_RUNTIME_STATUSES.SKIPPED,
                reply: null,
                delivered: false,
                ragMetadata: {
                  ...ragMetadata,
                  delivery_cancelled_reason: accessCheck.reason,
                  cache_hit: true
                },
                usageContext: null,
                error: `Delivery dibatalkan karena status akses berubah: ${accessCheck.reason}`
              };
            }
            await deliverReply(cached.reply);
            delivered = true;
          }
          return {
            status: RAG_RUNTIME_STATUSES.REPLIED,
            reply: cached.reply,
            delivered,
            fromCache: true,
            ragMetadata: {
              ...ragMetadata,
              cache_hit: true,
              effective_mode: 'cache'
            },
            usageContext: null,
            error: null
          };
        }
      } catch {
        // Cache lookup failure must not block normal AI generation.
      }
    }

    let messages;
    if (ragEnabled) {
      const baseMessages = buildRagProductionMessages({
        systemInstruction: aiSettings.system_instruction,
        ragContext: '',
        userMessage: safeText
      });
      const baseInputTokens = dependencies.estimateChatInputTokens(baseMessages);
      const hardInputBudget = resolveHardInputBudget(aiSettings);
      if (baseInputTokens > hardInputBudget) {
        return await fallback('input_budget_exceeded', {
          ...ragMetadata,
          base_input_tokens: baseInputTokens,
          hard_input_budget_tokens: hardInputBudget
        });
      }

      const retrievalStartedAt = performance.now();
      let retrieval;
      try {
        retrieval = await dependencies.executeRagRetrieval({
          userId,
          sessionId: safeSessionId,
          cleanText: safeText,
          aiSettings,
          baseInputTokens,
          databaseClient
        }, dependencies);
      } catch {
        ragMetadata.retrieval_latency_ms = performance.now() - retrievalStartedAt;
        return await fallback('retrieval_failed');
      }
      ragMetadata = {
        ...ragMetadata,
        effective_mode: retrieval.effectiveMode,
        embedding_fallback: retrieval.embeddingFallback === true,
        retrieval_latency_ms: performance.now() - retrievalStartedAt,
        retrieval_reason: retrieval.reason
      };
      if (retrieval.reason !== 'ready' || !retrieval.ragResult) {
        return await fallback(retrieval.reason);
      }

      messages = buildRagProductionMessages({
        systemInstruction: aiSettings.system_instruction,
        ragContext: retrieval.ragResult.context,
        userMessage: safeText
      });
      const estimatedInputTokens = dependencies.estimateChatInputTokens(messages);
      if (estimatedInputTokens > hardInputBudget) {
        return await fallback('final_input_budget_exceeded', {
          ...ragMetadata,
          estimated_total_input_tokens: estimatedInputTokens,
          hard_input_budget_tokens: hardInputBudget
        });
      }
      ragMetadata = {
        ...ragMetadata,
        selected_count: retrieval.ragResult.selected_count,
        context_tokens: retrieval.ragResult.context_tokens,
        estimated_total_input_tokens: estimatedInputTokens,
        hard_input_budget_tokens: hardInputBudget,
        within_hard_budget: true
      };
    } else {
      const knowledgeBase = await dependencies.resolveKnowledgeBase(aiSettings);
      messages = buildProductionMessages({
        systemInstruction: aiSettings.system_instruction,
        knowledgeBase,
        userMessage: safeText
      });
    }

    const safeBaseUrl = await dependencies.assertSafeOutboundUrl(credentials.baseUrl);
    resolvedProvider = dependencies.resolveAIProvider(safeBaseUrl);
    const openai = await dependencies.createChatClient({
      apiKey: credentials.apiKey,
      safeBaseUrl
    });
    const completion = await dependencies.executeChatCompletion({
      openai,
      payload: dependencies.buildChatCompletionPayload({
        model,
        messages,
        maxOutputTokens: aiSettings.max_output_tokens,
        temperature: resolveChatTemperature(ragEnabled ? 'grounded' : 'existing')
      }),
      requestKind: 'production',
      userId,
      sessionId: safeSessionId,
      provider: resolvedProvider,
      model,
      retrievalType: ragMetadata.effective_mode,
      chunkCount: ragMetadata.selected_count,
      databaseClient,
      maxAttempts: 2
    });
    usageContext = completion.context;
    providerResponse = completion.response;
    providerLatencyMs = completion.latencyMs;
    ragMetadata.provider_latency_ms = providerLatencyMs;
    const reply = String(providerResponse?.choices?.[0]?.message?.content || '').trim();

    // A partial/refused/tool response must never be presented as a complete grounded answer.
    const finishReason = providerResponse?.choices?.[0]?.finish_reason;
    if (ragEnabled && finishReason !== 'stop') {
      usageRecorded = await dependencies.recordUsage({
        context: usageContext, userId, sessionId: safeSessionId,
        provider: resolvedProvider, model, response: providerResponse,
        retrievalType: ragMetadata.effective_mode,
        chunkCount: ragMetadata.selected_count,
        deliveryStatus: 'NOT_APPLICABLE', latencyMs: providerLatencyMs
      }, databaseClient);
      return await fallback(finishReason === 'length' ? 'output_truncated' : 'output_rejected');
    }

    if (!reply) {
      usageRecorded = await dependencies.recordUsage({
        context: usageContext,
        userId,
        sessionId: safeSessionId,
        provider: resolvedProvider,
        model,
        response: providerResponse,
        retrievalType: ragMetadata.effective_mode,
        chunkCount: ragMetadata.selected_count,
        deliveryStatus: 'FAILED',
        latencyMs: providerLatencyMs
      }, databaseClient);
      return {
        status: RAG_RUNTIME_STATUSES.EMPTY_REPLY,
        reply: null,
        delivered: false,
        ragMetadata,
        usageContext,
        error: `Model '${model}' mengembalikan respon kosong.`
      };
    }

    if (deliverReply) {
      const accessCheck = await dependencies.recheckDeliveryAccess({
        userId,
        sessionId: safeSessionId,
        databaseClient
      });
      if (!accessCheck.allowed) {
        usageRecorded = await dependencies.recordUsage({
          context: usageContext,
          userId,
          sessionId: safeSessionId,
          provider: resolvedProvider,
          model,
          response: providerResponse,
          retrievalType: ragMetadata.effective_mode,
          chunkCount: ragMetadata.selected_count,
          deliveryStatus: 'NOT_APPLICABLE',
          latencyMs: providerLatencyMs
        }, databaseClient);
        return {
          status: RAG_RUNTIME_STATUSES.SKIPPED,
          reply: null,
          delivered: false,
          ragMetadata: {
            ...ragMetadata,
            delivery_cancelled_reason: accessCheck.reason
          },
          usageContext,
          error: `Delivery dibatalkan karena status akses berubah: ${accessCheck.reason}`
        };
      }
      await deliverReply(reply);
    }
    usageRecorded = await dependencies.recordUsage({
      context: usageContext,
      userId,
      sessionId: safeSessionId,
      provider: resolvedProvider,
      model,
      response: providerResponse,
      retrievalType: ragMetadata.effective_mode,
      chunkCount: ragMetadata.selected_count,
      deliveryStatus: deliverReply ? 'SENT' : 'NOT_APPLICABLE',
      latencyMs: providerLatencyMs
    }, databaseClient);

    // RAG-0703 / RAG-0705: Response Cache Store
    if (aiSettings?.cache_enabled === 1 && dependencies.shouldCacheResult({
      status: RAG_RUNTIME_STATUSES.REPLIED,
      reply,
      finishReason,
      error: null
    })) {
      try {
        await dependencies.storeCachedResponse({
          userId,
          sessionId: safeSessionId,
          query: safeText,
          promptVersion: aiSettings.prompt_version || 1,
          configRevision: aiSettings.config_revision || 1,
          model,
          temperature: resolveChatTemperature(ragEnabled ? 'grounded' : 'existing'),
          reply,
          ttlSeconds: aiSettings.cache_ttl_seconds,
          databaseClient
        });
      } catch {
        // Cache store failure must not fail the reply delivery.
      }
    }

    return {
      status: RAG_RUNTIME_STATUSES.REPLIED,
      reply,
      delivered: Boolean(deliverReply),
      ragMetadata,
      usageContext,
      error: null
    };
  } catch (error) {
    if (usageContext && !usageRecorded) {
      await dependencies.recordUsage({
        context: usageContext,
        userId,
        sessionId: safeSessionId,
        provider: resolvedProvider,
        model,
        response: providerResponse,
        retrievalType: ragMetadata.effective_mode,
        chunkCount: ragMetadata.selected_count,
        error: providerResponse ? null : error,
        deliveryStatus: providerResponse ? 'UNKNOWN' : 'NOT_APPLICABLE',
        latencyMs: providerLatencyMs ?? (Date.now() - usageContext.startedAtMs)
      }, databaseClient);
    }
    // Detailed inbound error handling remains with the caller; new telemetry uses closed fields.
    return {
      status: RAG_RUNTIME_STATUSES.ERROR,
      reply: null,
      delivered: false,
      ragMetadata,
      usageContext,
      error
    };
  }
}

export async function processInboundAIMessage(params, dependencyOverrides = {}) {
  const dependencies = resolveDependencies(dependencyOverrides);
  const startedAt = performance.now();
  const result = await processInboundAIMessageCore(params, dependencies);
  try {
    await dependencies.recordRuntimeEvent({
      userId: params.userId, result, totalLatencyMs: performance.now() - startedAt
    });
  } catch {
    // Observability failure must not retry a provider call or a delivered message.
  }
  return result;
}
