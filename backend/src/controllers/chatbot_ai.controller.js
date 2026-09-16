import { OpenAI } from 'openai';
import { dbGet, dbRun, dbAll } from '../database.js';
import { protectSecret, revealSecret } from '../services/secret.service.js';
import { getFlowsKnowledgeBase } from '../services/chatbot_ai.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { assertSafeOutboundUrl, createSafeOutboundFetch } from '../utils/outbound_url.js';
import {
  buildChatCompletionPayload,
  normalizeMaxOutputTokens,
  resolveChatTemperature,
  validateMaxOutputTokens
} from '../services/chatbot_ai_runtime.service.js';
import {
  buildChatMessages,
  buildConnectionTestMessages,
  buildRagConversationalFallbackMessages,
  buildSandboxMessages
} from '../services/chatbot_ai_prompt.service.js';
import {
  recordChatbotAIUsageSafely,
  resolveAIProvider
} from '../services/chatbot_ai_usage.service.js';
import { executeInstrumentedChatCompletion } from '../services/chatbot_ai_provider.service.js';
import {
  syncManualKnowledgeSourceSafely,
  reindexSessionKnowledgeSources,
  getSessionRagStatus
} from '../services/chatbot_ai_rag_index.service.js';
import {
  retrieveRagContext
} from '../services/chatbot_ai_rag_context.service.js';
import {
  invalidateSessionCache
} from '../services/chatbot_ai_rag_cache.service.js';
import {
  buildRagPreflightDiagnostic,
  resolveRagAutoConfiguration,
  resolveRagQueryPolicy
} from '../services/chatbot_ai_rag_policy.service.js';
import {
  getTenantEmbeddingProfile,
  upsertTenantEmbeddingProfile,
  testEmbeddingCapability,
  getTenantEmbeddingUsageSummary,
  generateQueryEmbedding,
  generateSessionEmbeddings,
  EMBEDDING_CAPABILITY_STATUSES
} from '../services/chatbot_ai_embedding.service.js';

export const maskAISettings = (settings) => ({
  ...settings,
  api_key: '',
  has_api_key: Boolean(settings.api_key)
});

export const maskAICredential = (cred) => ({
  ...cred,
  api_key: '',
  has_api_key: Boolean(cred.api_key)
});

export const resolveStoredApiKey = (existingKey, submittedKey, clearApiKey) => {
  if (clearApiKey) return null;
  return submittedKey || existingKey || null;
};

// ==========================================
// AI Credentials CRUD & Toggle Handlers
// ==========================================

export const getCredentials = async (req, res) => {
  try {
    const sql = 'SELECT * FROM chatbot_ai_credentials WHERE user_id = ? ORDER BY created_at DESC';
    const rows = await dbAll(sql, [req.auth.userId]);
    const masked = rows.map(row => maskAICredential(row));
    return sendSuccess(res, masked);
  } catch (error) {
    logError('getCredentials', error);
    return sendError(res, 500, 'GET_CREDENTIALS_ERROR', 'Gagal memuat daftar kredensial.');
  }
};

export const createCredential = async (req, res) => {
  const { name, base_url, api_key, model_name, is_active } = req.body;

  try {
    if (base_url !== undefined && base_url !== null && base_url !== '') {
      await assertSafeOutboundUrl(base_url);
    }
    const encryptedKey = api_key ? protectSecret(api_key) : null;
    const isActive = is_active !== undefined ? (is_active ? 1 : 0) : 1;
    const baseUrl = base_url || 'https://ai.sumopod.com/v1';
    const modelName = model_name || 'gpt-4o-mini';

    const result = await dbRun(
      `INSERT INTO chatbot_ai_credentials (name, base_url, api_key, model_name, is_active, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, baseUrl, encryptedKey, modelName, isActive, req.auth.userId]
    );

    return sendSuccess(res, { id: result.id, name, base_url: baseUrl, model_name: modelName, is_active: isActive }, 200, { message: 'Kredensial berhasil ditambahkan.' });
  } catch (error) {
    if (error.code === 'UNSAFE_OUTBOUND_URL') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('createCredential', error, { body: req.body });
    return sendError(res, 500, 'CREATE_CREDENTIAL_ERROR', 'Gagal menambahkan kredensial.');
  }
};

export const updateCredential = async (req, res) => {
  const { id } = req.params;
  const { name, base_url, api_key, model_name, is_active, clear_api_key } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CREDENTIAL_NOT_FOUND', 'Kredensial tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kredensial ini.');
    }

    if (base_url !== undefined) {
      await assertSafeOutboundUrl(base_url);
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (base_url !== undefined) {
      updates.push('base_url = ?');
      values.push(base_url);
    }
    if (api_key !== undefined || clear_api_key !== undefined) {
      updates.push('api_key = ?');
      const resolvedKey = resolveStoredApiKey(existing.api_key, api_key, clear_api_key);
      values.push(resolvedKey ? protectSecret(resolvedKey) : null);
    }
    if (model_name !== undefined) {
      updates.push('model_name = ?');
      values.push(model_name);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      await dbRun(
        `UPDATE chatbot_ai_credentials SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return sendSuccess(res, null, 200, { message: 'Kredensial berhasil diperbarui.' });
  } catch (error) {
    if (error.code === 'UNSAFE_OUTBOUND_URL') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('updateCredential', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_CREDENTIAL_ERROR', 'Gagal memperbarui kredensial.');
  }
};

export const deleteCredential = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CREDENTIAL_NOT_FOUND', 'Kredensial tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kredensial ini.');
    }

    await dbRun('DELETE FROM chatbot_ai_credentials WHERE id = ?', [id]);
    await dbRun('UPDATE chatbot_ai_settings SET credential_id = NULL WHERE credential_id = ?', [id]);
    return sendSuccess(res, null, 200, { message: 'Kredensial berhasil dihapus.' });
  } catch (error) {
    logError('deleteCredential', error, { params: req.params });
    return sendError(res, 500, 'DELETE_CREDENTIAL_ERROR', 'Gagal menghapus kredensial.');
  }
};

export const toggleCredentialActive = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT is_active, user_id FROM chatbot_ai_credentials WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CREDENTIAL_NOT_FOUND', 'Kredensial tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kredensial ini.');
    }

    const newStatus = existing.is_active === 1 ? 0 : 1;
    await dbRun('UPDATE chatbot_ai_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
    return sendSuccess(res, { is_active: newStatus }, 200, { message: 'Status keaktifan kredensial berhasil diubah.' });
  } catch (error) {
    logError('toggleCredentialActive', error, { params: req.params });
    return sendError(res, 500, 'TOGGLE_CREDENTIAL_ACTIVE_ERROR', 'Gagal mengubah status keaktifan kredensial.');
  }
};

// ==========================================
// AI Settings Handlers
// ==========================================

export const getAISettings = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    let settings = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [sessionId]);
    if (!settings) {
      settings = {
        session_id: sessionId,
        is_active: 0,
        base_url: 'https://ai.sumopod.com/v1',
        api_key: '',
        model_name: 'gpt-4o-mini',
        system_instruction: '',
        knowledge_base: '',
        knowledge_source: 'manual',
        delay_seconds: 2,
        show_typing: 1,
        credential_id: null,
        chatbot_mode: 'both',
        max_output_tokens: 2048,
        temperature: 0.3,
        rag_mode: 'off',
        rag_top_k: 4,
        rag_context_tokens: 1000,
        rag_input_budget_tokens: 2200,
        embedding_profile_id: null,
        cache_enabled: 0,
        cache_ttl_seconds: 86400,
        direct_answer_enabled: 0,
        debounce_ms: 0,
        config_revision: 1,
        prompt_version: 1
      };
    } else {
      if (settings.knowledge_source === undefined || settings.knowledge_source === null) {
        settings.knowledge_source = 'manual';
      }
      if (settings.chatbot_mode === undefined || settings.chatbot_mode === null) {
        settings.chatbot_mode = 'both';
      }
      if (settings.max_output_tokens === undefined || settings.max_output_tokens === null) {
        settings.max_output_tokens = 2048;
      }
      if (settings.temperature === undefined || settings.temperature === null) {
        settings.temperature = 0.3;
      }
      if (settings.rag_mode === undefined || settings.rag_mode === null) {
        settings.rag_mode = 'off';
      }
      if (settings.rag_top_k === undefined || settings.rag_top_k === null) {
        settings.rag_top_k = 4;
      }
      if (settings.rag_context_tokens === undefined || settings.rag_context_tokens === null) {
        settings.rag_context_tokens = 1000;
      }
      if (settings.rag_input_budget_tokens === undefined || settings.rag_input_budget_tokens === null) {
        settings.rag_input_budget_tokens = 2200;
      }
      if (settings.cache_enabled === undefined || settings.cache_enabled === null) {
        settings.cache_enabled = 0;
      }
      if (settings.cache_ttl_seconds === undefined || settings.cache_ttl_seconds === null) {
        settings.cache_ttl_seconds = 86400;
      }
      if (settings.direct_answer_enabled === undefined || settings.direct_answer_enabled === null) {
        settings.direct_answer_enabled = 0;
      }
      if (settings.debounce_ms === undefined || settings.debounce_ms === null) {
        settings.debounce_ms = 0;
      }
      if (settings.config_revision === undefined || settings.config_revision === null) {
        settings.config_revision = 1;
      }
      if (settings.prompt_version === undefined || settings.prompt_version === null) {
        settings.prompt_version = 1;
      }
    }

    const flowsKB = await getFlowsKnowledgeBase(sessionId);
    const masked = maskAISettings(settings);
    masked.flows_knowledge_base = flowsKB;

    return sendSuccess(res, masked);
  } catch (error) {
    logError('getAISettings', error, { params: req.params });
    return sendError(res, 500, 'GET_AI_SETTINGS_ERROR', 'Gagal memuat pengaturan AI.');
  }
};

export const saveAISettings = async (req, res) => {
  const { session_id, credential_id } = req.body;

  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'max_output_tokens')) {
      const outputLimitError = validateMaxOutputTokens(req.body.max_output_tokens);
      if (outputLimitError) {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'Payload permintaan tidak valid.',
          { max_output_tokens: outputLimitError }
        );
      }
    }
    if (req.body.base_url !== undefined) {
      await assertSafeOutboundUrl(req.body.base_url);
    }
    if (req.body.rag_mode !== undefined && !['off', 'fts', 'hybrid'].includes(String(req.body.rag_mode).toLowerCase())) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'rag_mode harus berupa off, fts, atau hybrid.');
    }
    if (req.body.rag_top_k !== undefined) {
      const topK = Number(req.body.rag_top_k);
      if (!Number.isInteger(topK) || topK < 1 || topK > 5) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'rag_top_k harus berupa integer antara 1 dan 5.');
      }
    }
    if (req.body.rag_context_tokens !== undefined) {
      const ctxTokens = Number(req.body.rag_context_tokens);
      if (!Number.isInteger(ctxTokens) || ctxTokens < 100 || ctxTokens > 10000) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'rag_context_tokens harus berupa integer antara 100 dan 10000.');
      }
    }
    if (req.body.rag_input_budget_tokens !== undefined) {
      const budget = Number(req.body.rag_input_budget_tokens);
      if (!Number.isInteger(budget) || budget < 256 || budget > 32768) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'rag_input_budget_tokens harus berupa integer antara 256 dan 32768.');
      }
    }
    if (req.body.cache_ttl_seconds !== undefined) {
      const ttl = Number(req.body.cache_ttl_seconds);
      if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'cache_ttl_seconds harus berupa integer antara 60 dan 86400 detik.');
      }
    }
    if (req.body.debounce_ms !== undefined) {
      const debounce = Number(req.body.debounce_ms);
      if (!Number.isInteger(debounce) || debounce < 0 || debounce > 60000) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'debounce_ms harus berupa integer antara 0 dan 60000 ms.');
      }
    }
    if (req.body.temperature !== undefined) {
      const temp = Number(req.body.temperature);
      if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'temperature harus berupa angka antara 0 dan 2.');
      }
    }
    if (req.body.embedding_profile_id !== undefined && req.body.embedding_profile_id !== null) {
      const profileId = Number(req.body.embedding_profile_id);
      const profile = await dbGet('SELECT id FROM rag_embedding_profiles WHERE id = ? AND user_id = ?', [profileId, req.auth.userId]);
      if (!profile) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Profil embedding terpilih tidak valid.');
      }
    }

    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [session_id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    const isAdmin = req.auth?.role === 'admin';
    if (!isAdmin && sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }
    const targetUserId = isAdmin ? sess.user_id : req.auth.userId;

    if (credential_id) {
      const cred = await dbGet('SELECT user_id FROM chatbot_ai_credentials WHERE id = ?', [credential_id]);
      if (!cred || cred.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Kredensial terpilih tidak valid.');
      }
    }

    const existing = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]);
    const ragAutoConfiguration = resolveRagAutoConfiguration({
      requestedMode: req.body.rag_mode,
      previousMode: existing?.rag_mode || 'off',
      payload: req.body
    });
    const settingsBody = { ...req.body, ...ragAutoConfiguration.applied };
    if (existing) {
      const updates = [];
      const values = [];

      const keysToUpdate = [
        { key: 'is_active', dbKey: 'is_active', type: 'boolean' },
        { key: 'base_url', dbKey: 'base_url', type: 'string', default: 'https://ai.sumopod.com/v1' },
        { key: 'api_key', dbKey: 'api_key', type: 'secret' },
        { key: 'model_name', dbKey: 'model_name', type: 'string', default: 'gpt-4o-mini' },
        { key: 'system_instruction', dbKey: 'system_instruction', type: 'string' },
        { key: 'knowledge_base', dbKey: 'knowledge_base', type: 'string' },
        { key: 'knowledge_source', dbKey: 'knowledge_source', type: 'string', default: 'manual' },
        { key: 'delay_seconds', dbKey: 'delay_seconds', type: 'number' },
        { key: 'show_typing', dbKey: 'show_typing', type: 'boolean' },
        { key: 'credential_id', dbKey: 'credential_id', type: 'number' },
        { key: 'chatbot_mode', dbKey: 'chatbot_mode', type: 'string', default: 'both' },
        { key: 'max_output_tokens', dbKey: 'max_output_tokens', type: 'number' },
        { key: 'temperature', dbKey: 'temperature', type: 'float' },
        { key: 'rag_mode', dbKey: 'rag_mode', type: 'string', default: 'off' },
        { key: 'rag_top_k', dbKey: 'rag_top_k', type: 'number' },
        { key: 'rag_context_tokens', dbKey: 'rag_context_tokens', type: 'number' },
        { key: 'rag_input_budget_tokens', dbKey: 'rag_input_budget_tokens', type: 'number' },
        { key: 'embedding_profile_id', dbKey: 'embedding_profile_id', type: 'number' },
        { key: 'cache_enabled', dbKey: 'cache_enabled', type: 'boolean' },
        { key: 'cache_ttl_seconds', dbKey: 'cache_ttl_seconds', type: 'number' },
        { key: 'direct_answer_enabled', dbKey: 'direct_answer_enabled', type: 'boolean' },
        { key: 'debounce_ms', dbKey: 'debounce_ms', type: 'number' }
      ];

      for (const item of keysToUpdate) {
        if (settingsBody[item.key] !== undefined || (item.key === 'api_key' && settingsBody.clear_api_key !== undefined)) {
          updates.push(`${item.dbKey} = ?`);
          
          if (item.type === 'secret') {
            values.push(protectSecret(resolveStoredApiKey(existing.api_key, settingsBody.api_key, settingsBody.clear_api_key)));
          } else if (item.type === 'boolean') {
            values.push(settingsBody[item.key] ? 1 : 0);
          } else if (item.key === 'max_output_tokens') {
            values.push(normalizeMaxOutputTokens(settingsBody[item.key]));
          } else if (item.type === 'float') {
            values.push(settingsBody[item.key] !== null && settingsBody[item.key] !== undefined ? parseFloat(settingsBody[item.key]) : 0.3);
          } else if (item.type === 'number') {
            values.push(settingsBody[item.key] !== null && settingsBody[item.key] !== undefined ? parseInt(settingsBody[item.key], 10) : null);
          } else {
            values.push(settingsBody[item.key] !== undefined ? settingsBody[item.key] : item.default);
          }
        }
      }

      if (updates.length > 0) {
        values.push(session_id);
        await dbRun(
          `UPDATE chatbot_ai_settings SET ${updates.join(', ')} WHERE session_id = ?`,
          values
        );
      }

      if (settingsBody.knowledge_base !== undefined) {
        await syncManualKnowledgeSourceSafely({
          userId: targetUserId,
          sessionId: session_id,
          knowledgeBase: settingsBody.knowledge_base
        });
      }

      await invalidateSessionCache(targetUserId, session_id).catch(() => {});
    } else {
      const is_active = settingsBody.is_active !== undefined ? (settingsBody.is_active ? 1 : 0) : 0;
      const base_url = settingsBody.base_url || 'https://ai.sumopod.com/v1';
      const api_key = settingsBody.api_key ? protectSecret(settingsBody.api_key) : null;
      const model_name = settingsBody.model_name || 'gpt-4o-mini';
      const system_instruction = settingsBody.system_instruction || '';
      const knowledge_base = settingsBody.knowledge_base || '';
      const knowledge_source = settingsBody.knowledge_source || 'manual';
      const delay_seconds = settingsBody.delay_seconds !== undefined ? parseInt(settingsBody.delay_seconds, 10) : 2;
      const show_typing = settingsBody.show_typing !== undefined ? (settingsBody.show_typing ? 1 : 0) : 1;
      const cred_id = credential_id !== undefined && credential_id !== null ? parseInt(credential_id, 10) : null;
      const chatbot_mode = settingsBody.chatbot_mode || 'both';
      const max_output_tokens = normalizeMaxOutputTokens(settingsBody.max_output_tokens);
      const temperature = settingsBody.temperature !== undefined ? parseFloat(settingsBody.temperature) : 0.3;
      const rag_mode = settingsBody.rag_mode || 'off';
      const rag_top_k = settingsBody.rag_top_k !== undefined ? parseInt(settingsBody.rag_top_k, 10) : 4;
      const rag_context_tokens = settingsBody.rag_context_tokens !== undefined ? parseInt(settingsBody.rag_context_tokens, 10) : 1000;
      const rag_input_budget_tokens = settingsBody.rag_input_budget_tokens !== undefined ? parseInt(settingsBody.rag_input_budget_tokens, 10) : 2200;
      const embedding_profile_id = settingsBody.embedding_profile_id !== undefined && settingsBody.embedding_profile_id !== null ? parseInt(settingsBody.embedding_profile_id, 10) : null;
      const cache_enabled = settingsBody.cache_enabled !== undefined ? (settingsBody.cache_enabled ? 1 : 0) : 0;
      const cache_ttl_seconds = settingsBody.cache_ttl_seconds !== undefined ? parseInt(settingsBody.cache_ttl_seconds, 10) : 86400;
      const direct_answer_enabled = settingsBody.direct_answer_enabled !== undefined ? (settingsBody.direct_answer_enabled ? 1 : 0) : 0;
      const debounce_ms = settingsBody.debounce_ms !== undefined ? parseInt(settingsBody.debounce_ms, 10) : 0;

      await dbRun(
        `INSERT INTO chatbot_ai_settings 
         (session_id, user_id, is_active, base_url, api_key, model_name, system_instruction, knowledge_base, knowledge_source, delay_seconds, show_typing, credential_id, chatbot_mode, max_output_tokens, temperature, rag_mode, rag_top_k, rag_context_tokens, rag_input_budget_tokens, embedding_profile_id, cache_enabled, cache_ttl_seconds, direct_answer_enabled, debounce_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session_id,
          targetUserId,
          is_active,
          base_url,
          api_key,
          model_name,
          system_instruction,
          knowledge_base,
          knowledge_source,
          delay_seconds,
          show_typing,
          cred_id,
          chatbot_mode,
          max_output_tokens,
          temperature,
          rag_mode,
          rag_top_k,
          rag_context_tokens,
          rag_input_budget_tokens,
          embedding_profile_id,
          cache_enabled,
          cache_ttl_seconds,
          direct_answer_enabled,
          debounce_ms
        ]
      );

      await syncManualKnowledgeSourceSafely({
        userId: targetUserId,
        sessionId: session_id,
        knowledgeBase: knowledge_base
      });

      await invalidateSessionCache(targetUserId, session_id).catch(() => {});
    }
    const savedSettings = await dbGet(
      `SELECT rag_mode, rag_top_k, rag_context_tokens, rag_input_budget_tokens,
              cache_enabled, cache_ttl_seconds, direct_answer_enabled, debounce_ms,
              max_output_tokens, temperature
       FROM chatbot_ai_settings WHERE session_id = ? AND user_id = ?`,
      [session_id, targetUserId]
    ) || {};
    const ragStatus = await getSessionRagStatus({ sessionId: session_id, userId: targetUserId });
    const ragPreflight = buildRagPreflightDiagnostic({ status: ragStatus, settings: savedSettings });
    return sendSuccess(res, {
      rag_auto_configuration: ragAutoConfiguration,
      rag_preflight: ragPreflight
    }, 200, { message: 'Pengaturan Chatbot AI berhasil disimpan.' });
  } catch (error) {
    if (error.code === 'UNSAFE_OUTBOUND_URL') {
      return sendError(res, 400, error.code, error.message);
    }
    if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('constraint')) || (error.message && error.message.includes('FOREIGN KEY'))) {
      return sendError(res, 400, 'INVALID_SESSION_ID', 'ID Sesi tidak valid atau tidak terdaftar.');
    }
    logError('saveAISettings', error, { body: req.body });
    return sendError(res, 500, 'SAVE_AI_SETTINGS_ERROR', 'Gagal menyimpan pengaturan AI.');
  }
};

export const testAISettings = async (req, res) => {
  const {
    base_url,
    api_key,
    model_name,
    session_id,
    credential_id,
    test_kind,
    system_prompt,
    user_message,
    prompt_override,
    max_output_tokens,
    use_rag,
    rag_mode,
    rag_top_k,
    rag_context_tokens,
    rag_threshold,
    temperature: requestedTemperature
  } = req.body;

  if (Object.prototype.hasOwnProperty.call(req.body, 'max_output_tokens')) {
    const outputLimitError = validateMaxOutputTokens(max_output_tokens);
    if (outputLimitError) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Payload permintaan tidak valid.',
        { max_output_tokens: outputLimitError }
      );
    }
  }

  const isSandbox = test_kind === 'sandbox'
    || (!test_kind && Boolean(system_prompt || user_message || prompt_override));
  let messages;
  try {
    messages = isSandbox
      ? buildSandboxMessages({
          systemPrompt: system_prompt,
          userMessage: user_message,
          legacyPromptOverride: prompt_override
        })
      : buildConnectionTestMessages();
  } catch (error) {
    return sendError(res, 400, error.code || 'INVALID_AI_TEST_PAYLOAD', error.message);
  }

  let ragInfo = { used_rag: false };
  if (isSandbox && use_rag && session_id && user_message) {
    try {
      const client = req.dbClient || { get: dbGet, all: dbAll, run: dbRun };
      const settings = await client.get('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]) || {};
      const effectiveMode = ['fts', 'hybrid'].includes(String(rag_mode || settings.rag_mode).toLowerCase())
        ? String(rag_mode || settings.rag_mode).toLowerCase()
        : 'fts';
      const initialConversationPolicy = resolveRagQueryPolicy({
        query: user_message,
        mode: effectiveMode,
        hasQueryVector: false
      });

      let queryVector = null;
      if (effectiveMode === 'hybrid' && initialConversationPolicy.should_retrieve) {
        try {
          const tenantProfile = await getTenantEmbeddingProfile(req.auth.userId, client);
          const credId = credential_id || settings.credential_id;
          if (tenantProfile && credId) {
            const credRow = await client.get('SELECT * FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?', [credId, req.auth.userId]);
            if (credRow?.api_key) {
              const plainKey = revealSecret(credRow.api_key);
              const queryEmbedding = await generateQueryEmbedding({
                query: user_message,
                userId: req.auth.userId,
                credentialId: tenantProfile.credential_id || credId,
                model: tenantProfile.model,
                dimensions: tenantProfile.dimensions,
                apiKey: plainKey,
                baseUrl: credRow.base_url || 'https://ai.sumopod.com',
                databaseClient: client
              });
              queryVector = queryEmbedding?.vector || null;
            }
          }
        } catch {
          queryVector = null;
        }
      }

      const startRetrieval = performance.now();
      const retrievalResult = initialConversationPolicy.should_retrieve
        ? await retrieveRagContext({
            userId: req.auth.userId,
            sessionId: session_id,
            query: user_message,
            queryVector,
            mode: queryVector ? 'hybrid' : 'fts',
            topK: rag_top_k !== undefined ? Number(rag_top_k) : (settings.rag_top_k || 4),
            contextTokenBudget: rag_context_tokens !== undefined ? Number(rag_context_tokens) : (settings.rag_context_tokens || 1000),
            relevanceThreshold: resolveRagQueryPolicy({
              query: user_message,
              mode: queryVector ? 'hybrid' : 'fts',
              hasQueryVector: Boolean(queryVector),
              explicitThreshold: rag_threshold
            }).relevance_threshold
          }, client)
        : { results: [], selected_count: 0 };
      const retrievalLatency = initialConversationPolicy.should_retrieve
        ? Math.round(performance.now() - startRetrieval)
        : 0;

      const safeChunks = (retrievalResult.results || []).map((chunk, idx) => ({
        id: chunk.chunk_id || chunk.id || idx + 1,
        source_id: chunk.source_id,
        source_type: chunk.source_type,
        source_title: chunk.flow_name || (chunk.source_type === 'manual' ? 'Basis Pengetahuan Manual' : `Sumber #${chunk.source_id}`),
        content: chunk.chunk_text || chunk.text || '',
        score: Number(chunk.score?.toFixed?.(4) ?? chunk.score ?? 0),
        is_canonical: Boolean(chunk.is_canonical),
        token_count: Number(chunk.token_count || 0)
      }));

      ragInfo = {
        used_rag: true,
        mode: queryVector ? 'hybrid' : 'fts',
        chunks_found: retrievalResult.selected_count || 0,
        chunks: safeChunks,
        latency_ms: retrievalLatency
      };

      const systemSections = [];
      if (system_prompt && String(system_prompt).trim()) {
        systemSections.push(String(system_prompt).trim());
      }

      const conversationPolicy = resolveRagQueryPolicy({
        query: user_message,
        mode: effectiveMode,
        hasQueryVector: Boolean(queryVector)
      });
      if (safeChunks.length === 0 && !conversationPolicy.should_retrieve) {
        messages = buildRagConversationalFallbackMessages({
          systemInstruction: system_prompt,
          userMessage: user_message
        });
        ragInfo = {
          ...ragInfo,
          mode: 'conversation',
          conversational_fallback: true
        };
      } else if (safeChunks.length > 0) {
        const formattedKnowledge = safeChunks.map((c, i) => `[Dokumen ${i + 1}: ${c.source_title}]\n${c.content}`).join('\n\n');
        systemSections.push(
          `Gunakan informasi resmi berikut sebagai referensi utama untuk menjawab pertanyaan pengguna:\n\n${formattedKnowledge}\n\nAturan:\n1. Jawab pertanyaan pengguna dengan ramah, jelas, dan akurat berdasarkan dokumen di atas.\n2. Jika informasi tidak ada di dokumen, sampaikan dengan sopan bahwa Anda belum memiliki informasi tersebut.\n3. Jangan sebutkan kata teknis seperti "chunk", "dokumen 1", atau "database".`
        );
      } else {
        systemSections.push(
          `Informasi: Tidak ditemukan dokumen yang relevan untuk pertanyaan ini di basis data.\nAturan: Jawablah dengan sopan bahwa Anda belum memiliki informasi detail mengenai hal tersebut, dan tawarkan mereka untuk menghubungi customer service atau menanyakan hal lain.`
        );
      }

      if (!(safeChunks.length === 0 && !conversationPolicy.should_retrieve)) {
        messages = buildChatMessages({
          systemPrompt: systemSections.join('\n\n'),
          userMessage: user_message
        });
      }
    } catch (ragErr) {
      logError('testAISettingsRAG', ragErr, { session_id, user_message });
      ragInfo = { used_rag: false, error: ragErr.message };
    }
  }

  try {
    if (session_id) {
      const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [session_id]);
      if (!sess || sess.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
      }
    }
    if (credential_id) {
      const cred = await dbGet('SELECT user_id FROM chatbot_ai_credentials WHERE id = ?', [credential_id]);
      if (!cred || cred.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke kredensial ini.');
      }
    }
  } catch (err) {
    logError('testAISettingsAuth', err, { body: req.body });
    return sendError(res, 500, 'TEST_AI_SETTINGS_ERROR', 'Gagal memvalidasi hak akses.');
  }

  let resolvedKey = api_key;
  let resolvedBaseUrl = base_url;
  let resolvedModelName = model_name;

  if (!resolvedKey) {
    try {
      let cred = null;
      if (credential_id) {
        cred = await dbGet(
          'SELECT * FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?',
          [credential_id, req.auth.userId]
        );
      } else if (session_id) {
        const settings = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]);
        if (settings) {
          if (settings.credential_id) {
            cred = await dbGet(
              'SELECT * FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?',
              [settings.credential_id, req.auth.userId]
            );
          } else if (settings.api_key) {
            resolvedKey = revealSecret(settings.api_key);
            resolvedBaseUrl = settings.base_url;
            resolvedModelName = settings.model_name;
          }
        }
      }

      if (cred) {
        resolvedKey = revealSecret(cred.api_key);
        resolvedBaseUrl = cred.base_url;
        resolvedModelName = cred.model_name;
      }
    } catch (err) {
      logError('resolveCredentialsForTesting', err, { body: req.body });
    }
  }

  if (!resolvedKey) {
    return sendError(res, 400, 'API_KEY_REQUIRED', 'API Key wajib disertakan atau dipilih untuk melakukan uji coba.');
  }

  let usageContext = null;
  let providerResponse = null;
  let usageRecorded = false;
  let resolvedProvider = 'unknown';
  const resolvedRequestKind = isSandbox ? 'sandbox' : 'test';

  try {
    const safeBaseUrl = await assertSafeOutboundUrl(resolvedBaseUrl || 'https://ai.sumopod.com/v1');
    resolvedProvider = resolveAIProvider(safeBaseUrl);
    const openai = new OpenAI({
      apiKey: resolvedKey,
      baseURL: safeBaseUrl,
      timeout: 15000,
      maxRetries: 0,
      fetch: createSafeOutboundFetch()
    });

    const temperature = requestedTemperature !== undefined && !Number.isNaN(Number(requestedTemperature))
      ? Math.max(0, Math.min(2, Number(requestedTemperature)))
      : resolveChatTemperature(isSandbox ? 'grounded' : 'existing');

    const completion = await executeInstrumentedChatCompletion({
      openai,
      payload: buildChatCompletionPayload({
        model: resolvedModelName || 'gpt-4o-mini',
        messages,
        maxOutputTokens: max_output_tokens,
        temperature,
        requestKind: resolvedRequestKind
      }),
      requestKind: resolvedRequestKind,
      userId: req.auth.userId,
      sessionId: session_id || null,
      provider: resolvedProvider,
      model: resolvedModelName || 'gpt-4o-mini',
      maxAttempts: 2
    });
    usageContext = completion.context;
    providerResponse = completion.response;

    const reply = providerResponse.choices[0]?.message?.content;
    usageRecorded = await recordChatbotAIUsageSafely({
      context: usageContext,
      userId: req.auth.userId,
      sessionId: session_id || null,
      provider: resolvedProvider,
      model: resolvedModelName || 'gpt-4o-mini',
      response: providerResponse,
      deliveryStatus: 'NOT_APPLICABLE'
    });
    if (reply === undefined || reply === null || reply.trim() === '') {
      return sendError(res, 400, 'EMPTY_MODEL_RESPONSE', `Koneksi API berhasil, tetapi model '${resolvedModelName || 'gpt-4o-mini'}' mengembalikan respon kosong. Silakan ganti model ke 'gpt-4o-mini' atau 'MiniMax-M2.7-highspeed' di pengaturan.`);
    }
    return sendSuccess(res, { reply, test_kind: resolvedRequestKind, rag_info: ragInfo }, 200, { message: 'Koneksi API SumoPod berhasil terjalin!' });
  } catch (error) {
    if (usageContext && !usageRecorded) {
      await recordChatbotAIUsageSafely({
        context: usageContext,
        userId: req.auth.userId,
        sessionId: session_id || null,
        provider: resolvedProvider,
        model: resolvedModelName || 'gpt-4o-mini',
        response: providerResponse,
        error: providerResponse ? null : error,
        deliveryStatus: 'NOT_APPLICABLE'
      });
    }
    if (error.code === 'UNSAFE_OUTBOUND_URL') {
      return sendError(res, 400, error.code, error.message);
    }
    if (error.code === 'AI_BUDGET_EXCEEDED' || error.code === 'AI_CIRCUIT_OPEN') {
      return sendError(res, 429, error.code, error.message);
    }
    logError('testAISettings', error, { body: req.body });
    return sendError(res, 500, 'TEST_AI_SETTINGS_ERROR', 'Uji coba koneksi gagal: ' + error.message);
  }
};

export const reindexAISession = async (req, res) => {
  const { sessionId } = req.params;
  const { source_id, force } = req.body || {};
  const userId = req.auth.userId;
  const isAdmin = req.auth?.role === 'admin';

  try {
    const client = req.dbClient || { get: dbGet, all: dbAll, run: dbRun };
    const sess = await client.get('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (!isAdmin && Number(sess.user_id) !== userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }
    const targetUserId = isAdmin ? Number(sess.user_id) : userId;

    const result = await reindexSessionKnowledgeSources({
      sessionId,
      userId: targetUserId,
      sourceId: source_id,
      force: Boolean(force)
    }, client);

    return sendSuccess(res, result, 202, {
      message: 'Permintaan reindex berhasil diterima.'
    });
  } catch (error) {
    if (error?.code === 'SESSION_NOT_FOUND') {
      return sendError(res, 404, 'SESSION_NOT_FOUND', error.message || 'Sesi tidak ditemukan.');
    }
    if (error?.code === 'RAG_SOURCE_NOT_FOUND') {
      return sendError(res, 404, 'RAG_SOURCE_NOT_FOUND', error.message || 'Sumber RAG tidak ditemukan.');
    }
    if (error?.code === 'FORBIDDEN_ACCESS') {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', error.message || 'Anda tidak memiliki akses ke sumber ini.');
    }
    if (error?.code === 'RAG_SOURCE_NOT_MAPPED' || error?.code === 'RAG_SOURCE_INACTIVE' || error?.code === 'RAG_INDEX_INVALID_INPUT') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('reindexAISession', error, { sessionId, body: req.body });
    return sendError(res, 500, 'REINDEX_AI_ERROR', 'Gagal memproses permintaan reindex.');
  }
};

export const generateAISessionEmbeddings = async (req, res) => {
  const { sessionId } = req.params;
  const { force } = req.body || {};
  const userId = req.auth.userId;
  const isAdmin = req.auth?.role === 'admin';

  try {
    const client = req.dbClient || { get: dbGet, all: dbAll, run: dbRun };
    const sess = await client.get('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (!isAdmin && Number(sess.user_id) !== userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }
    const targetUserId = isAdmin ? Number(sess.user_id) : userId;

    const result = await generateSessionEmbeddings({
      sessionId,
      userId: targetUserId,
      force: Boolean(force)
    }, client);

    return sendSuccess(res, result, 200, {
      message: result.processed_chunks > 0
        ? `Berhasil memproses ${result.processed_chunks} vektor chunk embedding.`
        : 'Seluruh vektor chunk sudah up-to-date.'
    });
  } catch (error) {
    if (error?.code === 'SESSION_NOT_FOUND') {
      return sendError(res, 404, 'SESSION_NOT_FOUND', error.message);
    }
    if (error?.code === 'FORBIDDEN_ACCESS') {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', error.message);
    }
    if (error?.code === 'EMBEDDING_CREDENTIAL_REQUIRED' || error?.code === 'EMBEDDING_CREDENTIAL_NOT_FOUND') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('generateAISessionEmbeddings', error, { sessionId, body: req.body });
    return sendError(res, 500, 'GENERATE_EMBEDDINGS_ERROR', error.message || 'Gagal menghasilkan vektor embedding.');
  }
};

export const getAISessionRagStatus = async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.auth.userId;
  const isAdmin = req.auth?.role === 'admin';

  try {
    const client = req.dbClient || { get: dbGet, all: dbAll, run: dbRun };
    const sess = await client.get('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (!isAdmin && Number(sess.user_id) !== userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }
    const targetUserId = isAdmin ? Number(sess.user_id) : userId;

    const status = await getSessionRagStatus({ sessionId, userId: targetUserId }, client);
    const preflight = buildRagPreflightDiagnostic({
      status,
      settings: {
        rag_mode: status.rag_mode,
        cache_enabled: status.cache_enabled,
        cache_ttl_seconds: status.cache_ttl_seconds
      }
    });
    return sendSuccess(res, { ...status, preflight });
  } catch (error) {
    if (error?.code === 'SESSION_NOT_FOUND') {
      return sendError(res, 404, 'SESSION_NOT_FOUND', error.message || 'Sesi tidak ditemukan.');
    }
    if (error?.code === 'FORBIDDEN_ACCESS') {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', error.message || 'Anda tidak memiliki akses ke sesi ini.');
    }
    if (error?.code === 'RAG_INDEX_INVALID_INPUT') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('getAISessionRagStatus', error, { sessionId });
    return sendError(res, 500, 'GET_RAG_STATUS_ERROR', 'Gagal memuat status RAG.');
  }
};

export const testAISessionRetrieval = async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.auth.userId;
  const isAdmin = req.auth?.role === 'admin';
  const { query, mode, top_k, relevance_threshold } = req.body || {};

  try {
    const client = req.dbClient || { get: dbGet, all: dbAll, run: dbRun };
    const sess = await client.get('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (!isAdmin && Number(sess.user_id) !== userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }
    const targetUserId = isAdmin ? Number(sess.user_id) : userId;

    const settings = await client.get('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [sessionId]) || {};
    const requestedMode = String(mode || settings.rag_mode || 'fts').toLowerCase();
    const effectiveMode = ['fts', 'hybrid'].includes(requestedMode) ? requestedMode : 'fts';
    const initialQueryPolicy = resolveRagQueryPolicy({
      query,
      mode: effectiveMode,
      hasQueryVector: false,
      explicitThreshold: relevance_threshold
    });
    if (!initialQueryPolicy.should_retrieve) {
      return sendSuccess(res, {
        session_id: sessionId,
        query: String(query).trim(),
        mode: 'conversation',
        query_kind: initialQueryPolicy.query_kind,
        relevance_threshold: null,
        threshold_source: initialQueryPolicy.threshold_source,
        selected_count: 0,
        chunks: [],
        retrieval_latency_ms: 0
      });
    }
    let queryVector = null;

    if (effectiveMode === 'hybrid') {
      try {
        const tenantProfile = await getTenantEmbeddingProfile(targetUserId, client);
        const credId = settings.credential_id;
        if (tenantProfile && credId) {
          const credRow = await client.get('SELECT * FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?', [credId, targetUserId]);
          if (credRow?.api_key) {
            const plainKey = revealSecret(credRow.api_key);
            const queryEmbedding = await generateQueryEmbedding({
              query,
              userId: targetUserId,
              credentialId: tenantProfile.credential_id || credId,
              model: tenantProfile.model,
              dimensions: tenantProfile.dimensions,
              apiKey: plainKey,
              baseUrl: credRow.base_url || 'https://ai.sumopod.com',
              databaseClient: client
            });
            queryVector = queryEmbedding?.vector || null;
          }
        }
      } catch {
        queryVector = null;
      }
    }

    const retrievalPolicy = resolveRagQueryPolicy({
      query,
      mode: queryVector ? 'hybrid' : 'fts',
      hasQueryVector: Boolean(queryVector),
      explicitThreshold: relevance_threshold
    });
    if (!retrievalPolicy.should_retrieve) {
      return sendSuccess(res, {
        session_id: sessionId,
        query: String(query).trim(),
        mode: 'conversation',
        query_kind: retrievalPolicy.query_kind,
        relevance_threshold: null,
        threshold_source: retrievalPolicy.threshold_source,
        selected_count: 0,
        chunks: [],
        retrieval_latency_ms: 0
      });
    }
    const startTime = performance.now();
    const retrievalResult = await retrieveRagContext({
      userId: targetUserId,
      sessionId,
      query,
      queryVector,
      mode: queryVector ? 'hybrid' : 'fts',
      topK: top_k !== undefined ? Number(top_k) : (settings.rag_top_k || 4),
      relevanceThreshold: retrievalPolicy.relevance_threshold
    }, client);
    const latencyMs = Math.round(performance.now() - startTime);

    const safeChunks = (retrievalResult.results || []).map((chunk, idx) => ({
      id: chunk.chunk_id || chunk.id || idx + 1,
      score: Number((chunk.score ?? chunk.rrf_score ?? chunk.relevance ?? 0).toFixed(4)),
      source_id: chunk.source_id,
      source_type: chunk.source_type || 'manual',
      source_title: chunk.source_title || chunk.provenance?.flow_name || (chunk.source_type === 'flow' ? 'Chatbot Flow' : 'Knowledge Base Manual'),
      content: chunk.chunk_text || chunk.content || '',
      is_canonical: Boolean(chunk.is_canonical || chunk.canonical || chunk.metadata?.canonical || chunk.metadata?.is_canonical),
      token_count: chunk.token_count || 0
    }));

    return sendSuccess(res, {
      session_id: sessionId,
      query: String(query).trim(),
      mode: queryVector ? 'hybrid' : 'fts',
      query_kind: retrievalPolicy.query_kind,
      relevance_threshold: retrievalPolicy.relevance_threshold,
      threshold_source: retrievalPolicy.threshold_source,
      selected_count: safeChunks.length,
      chunks: safeChunks,
      retrieval_latency_ms: latencyMs
    });
  } catch (error) {
    if (error?.code === 'RAG_RETRIEVAL_EMPTY_QUERY' || error?.code === 'RAG_RETRIEVAL_INVALID_INPUT' || error?.code === 'RAG_RETRIEVAL_INVALID_MODE' || error?.code === 'RAG_RETRIEVAL_INVALID_THRESHOLD') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('testAISessionRetrieval', error, { sessionId, body: req.body });
    return sendError(res, 500, 'TEST_RETRIEVAL_ERROR', error.message || 'Gagal menjalankan test retrieval.');
  }
};

// ==========================================
// RAG Embedding Profile & Capability Handlers
// ==========================================

export const getEmbeddingProfile = async (req, res) => {
  try {
    const profile = await getTenantEmbeddingProfile(req.auth.userId, req.dbClient || null);
    if (!profile) {
      return sendSuccess(res, {
        id: null,
        user_id: req.auth.userId,
        credential_id: null,
        model: 'text-embedding-3-small',
        dimensions: 1536,
        config_revision: 1,
        config_hash: '',
        capability_status: 'UNKNOWN',
        credential_name: null,
        base_url: null,
        credential_is_active: null
      });
    }
    return sendSuccess(res, profile);
  } catch (error) {
    logError('getEmbeddingProfile', error, { userId: req.auth.userId });
    return sendError(res, 500, 'GET_EMBEDDING_PROFILE_ERROR', 'Gagal memuat profil embedding.');
  }
};

export const saveEmbeddingProfile = async (req, res) => {
  const { credential_id, model, dimensions, test_capability } = req.body || {};
  const userId = req.auth.userId;
  const getFn = req.dbClient?.get ? req.dbClient.get.bind(req.dbClient) : dbGet;

  try {
    let capabilityStatus = EMBEDDING_CAPABILITY_STATUSES.UNKNOWN;

    if (test_capability && credential_id) {
      const cred = await getFn(
        'SELECT base_url, api_key FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?',
        [credential_id, userId]
      );
      if (cred && cred.api_key) {
        const apiKey = revealSecret(cred.api_key);
        const capTest = await testEmbeddingCapability({
          baseUrl: cred.base_url,
          apiKey,
          model: model || 'text-embedding-3-small',
          dimensions: dimensions || 1536
        });
        capabilityStatus = capTest.capabilityStatus;
      }
    }

    const saved = await upsertTenantEmbeddingProfile({
      userId,
      credentialId: credential_id || null,
      model: model || 'text-embedding-3-small',
      dimensions: dimensions || 1536,
      capabilityStatus
    }, req.dbClient || null);

    return sendSuccess(res, saved, 200, {
      message: 'Profil embedding berhasil disimpan.'
    });
  } catch (error) {
    if (error?.code === 'EMBEDDING_CREDENTIAL_NOT_FOUND' || error?.code === 'EMBEDDING_INVALID_INPUT') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('saveEmbeddingProfile', error, { userId, body: req.body });
    return sendError(res, 500, 'SAVE_EMBEDDING_PROFILE_ERROR', 'Gagal menyimpan profil embedding.');
  }
};

export const testEmbeddingProfileCapability = async (req, res) => {
  const { credential_id, base_url, api_key, model, dimensions } = req.body || {};
  const userId = req.auth.userId;
  const getFn = req.dbClient?.get ? req.dbClient.get.bind(req.dbClient) : dbGet;

  let resolvedKey = api_key;
  let resolvedBaseUrl = base_url;

  try {
    if (!resolvedKey && credential_id) {
      const cred = await getFn(
        'SELECT base_url, api_key FROM chatbot_ai_credentials WHERE id = ? AND user_id = ?',
        [credential_id, userId]
      );
      if (!cred) {
        return sendError(res, 404, 'CREDENTIAL_NOT_FOUND', 'Kredensial tidak ditemukan atau bukan milik tenant.');
      }
      if (cred.api_key) {
        resolvedKey = revealSecret(cred.api_key);
      }
      if (!resolvedBaseUrl) {
        resolvedBaseUrl = cred.base_url;
      }
    }

    if (!resolvedKey) {
      return sendError(res, 400, 'API_KEY_REQUIRED', 'API Key wajib disediakan atau dipilih via kredensial.');
    }

    const result = await testEmbeddingCapability({
      baseUrl: resolvedBaseUrl,
      apiKey: resolvedKey,
      model: model || 'text-embedding-3-small',
      dimensions: dimensions || 1536
    });

    return sendSuccess(res, result);
  } catch (error) {
    if (error?.code === 'UNSAFE_OUTBOUND_URL') {
      return sendError(res, 400, error.code, error.message);
    }
    logError('testEmbeddingProfileCapability', error, { userId, body: req.body });
    return sendError(res, 500, 'TEST_EMBEDDING_ERROR', 'Uji capability embedding gagal: ' + error.message);
  }
};

export const getEmbeddingUsage = async (req, res) => {
  const userId = req.auth?.userId || req.user?.id || 1;
  const { session_id, start_date, end_date } = req.query || {};

  try {
    const summary = await getTenantEmbeddingUsageSummary({
      userId,
      sessionId: session_id || null,
      startDate: start_date || null,
      endDate: end_date || null
    }, req.dbClient || null);

    return sendSuccess(res, summary);
  } catch (error) {
    logError('getEmbeddingUsage', error, { userId, query: req.query });
    return sendError(res, 500, 'GET_EMBEDDING_USAGE_ERROR', 'Gagal mengambil ringkasan pemakaian embedding: ' + error.message);
  }
};

