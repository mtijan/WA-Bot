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
  buildConnectionTestMessages,
  buildSandboxMessages
} from '../services/chatbot_ai_prompt.service.js';
import {
  recordChatbotAIUsageSafely,
  resolveAIProvider
} from '../services/chatbot_ai_usage.service.js';
import { executeInstrumentedChatCompletion } from '../services/chatbot_ai_provider.service.js';

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
        max_output_tokens: 2048
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
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [session_id]);
    if (!sess) {
      return sendError(res, 404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan.');
    }
    if (sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

    if (credential_id) {
      const cred = await dbGet('SELECT user_id FROM chatbot_ai_credentials WHERE id = ?', [credential_id]);
      if (!cred || cred.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Kredensial terpilih tidak valid.');
      }
    }

    const existing = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]);
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
        { key: 'max_output_tokens', dbKey: 'max_output_tokens', type: 'number' }
      ];

      for (const item of keysToUpdate) {
        if (req.body[item.key] !== undefined || (item.key === 'api_key' && req.body.clear_api_key !== undefined)) {
          updates.push(`${item.dbKey} = ?`);
          
          if (item.type === 'secret') {
            values.push(protectSecret(resolveStoredApiKey(existing.api_key, req.body.api_key, req.body.clear_api_key)));
          } else if (item.type === 'boolean') {
            values.push(req.body[item.key] ? 1 : 0);
          } else if (item.key === 'max_output_tokens') {
            values.push(normalizeMaxOutputTokens(req.body[item.key]));
          } else if (item.type === 'number') {
            values.push(req.body[item.key] !== null && req.body[item.key] !== undefined ? parseInt(req.body[item.key], 10) : null);
          } else {
            values.push(req.body[item.key] !== undefined ? req.body[item.key] : item.default);
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
    } else {
      const is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : 0;
      const base_url = req.body.base_url || 'https://ai.sumopod.com/v1';
      const api_key = req.body.api_key ? protectSecret(req.body.api_key) : null;
      const model_name = req.body.model_name || 'gpt-4o-mini';
      const system_instruction = req.body.system_instruction || '';
      const knowledge_base = req.body.knowledge_base || '';
      const knowledge_source = req.body.knowledge_source || 'manual';
      const delay_seconds = req.body.delay_seconds !== undefined ? parseInt(req.body.delay_seconds, 10) : 2;
      const show_typing = req.body.show_typing !== undefined ? (req.body.show_typing ? 1 : 0) : 1;
      const cred_id = credential_id !== undefined && credential_id !== null ? parseInt(credential_id, 10) : null;
      const chatbot_mode = req.body.chatbot_mode || 'both';
      const max_output_tokens = normalizeMaxOutputTokens(req.body.max_output_tokens);

      await dbRun(
        `INSERT INTO chatbot_ai_settings 
         (session_id, is_active, base_url, api_key, model_name, system_instruction, knowledge_base, knowledge_source, delay_seconds, show_typing, credential_id, chatbot_mode, max_output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session_id,
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
          max_output_tokens
        ]
      );
    }
    return sendSuccess(res, null, 200, { message: 'Pengaturan Chatbot AI berhasil disimpan.' });
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
    max_output_tokens
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

    const temperature = resolveChatTemperature(isSandbox ? 'grounded' : 'existing');

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
    return sendSuccess(res, { reply, test_kind: resolvedRequestKind }, 200, { message: 'Koneksi API SumoPod berhasil terjalin!' });
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
