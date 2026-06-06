import { OpenAI } from 'openai';
import { dbGet, dbRun, dbAll } from '../database.js';
import { protectSecret, revealSecret } from '../services/secret.service.js';
import { resolveKnowledgeBase, getFlowsKnowledgeBase } from '../services/chatbot_ai.service.js';

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
    const rows = await dbAll('SELECT * FROM chatbot_ai_credentials ORDER BY created_at DESC');
    const masked = rows.map(row => maskAICredential(row));
    res.json({ status: 'success', data: masked });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createCredential = async (req, res) => {
  const { name, base_url, api_key, model_name, is_active } = req.body;

  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Nama kredensial wajib diisi.' });
  }

  try {
    const encryptedKey = api_key ? protectSecret(api_key) : null;
    const isActive = is_active !== undefined ? (is_active ? 1 : 0) : 1;
    const baseUrl = base_url || 'https://ai.sumopod.com/v1';
    const modelName = model_name || 'gpt-4o-mini';

    const result = await dbRun(
      `INSERT INTO chatbot_ai_credentials (name, base_url, api_key, model_name, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [name, baseUrl, encryptedKey, modelName, isActive]
    );

    res.json({ 
      status: 'success', 
      message: 'Kredensial berhasil ditambahkan.', 
      data: { id: result.id, name, base_url: baseUrl, model_name: modelName, is_active: isActive }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateCredential = async (req, res) => {
  const { id } = req.params;
  const { name, base_url, api_key, model_name, is_active, clear_api_key } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Kredensial tidak ditemukan.' });
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

    res.json({ status: 'success', message: 'Kredensial berhasil diperbarui.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteCredential = async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM chatbot_ai_credentials WHERE id = ?', [id]);
    await dbRun('UPDATE chatbot_ai_settings SET credential_id = NULL WHERE credential_id = ?', [id]);
    res.json({ status: 'success', message: 'Kredensial berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const toggleCredentialActive = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT is_active FROM chatbot_ai_credentials WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Kredensial tidak ditemukan.' });
    }
    const newStatus = existing.is_active === 1 ? 0 : 1;
    await dbRun('UPDATE chatbot_ai_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
    res.json({ status: 'success', message: 'Status keaktifan kredensial berhasil diubah.', is_active: newStatus });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// AI Settings Handlers
// ==========================================

export const getAISettings = async (req, res) => {
  const { sessionId } = req.params;
  try {
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
        chatbot_mode: 'both'
      };
    } else {
      if (settings.knowledge_source === undefined || settings.knowledge_source === null) {
        settings.knowledge_source = 'manual';
      }
      if (settings.chatbot_mode === undefined || settings.chatbot_mode === null) {
        settings.chatbot_mode = 'both';
      }
    }

    const flowsKB = await getFlowsKnowledgeBase(sessionId);
    const masked = maskAISettings(settings);
    masked.flows_knowledge_base = flowsKB;

    res.json({ status: 'success', data: masked });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const saveAISettings = async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'ID Sesi wajib disertakan.' });
  }

  try {
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
        { key: 'chatbot_mode', dbKey: 'chatbot_mode', type: 'string', default: 'both' }
      ];

      for (const item of keysToUpdate) {
        if (req.body[item.key] !== undefined || (item.key === 'api_key' && req.body.clear_api_key !== undefined)) {
          updates.push(`${item.dbKey} = ?`);
          
          if (item.type === 'secret') {
            values.push(protectSecret(resolveStoredApiKey(existing.api_key, req.body.api_key, req.body.clear_api_key)));
          } else if (item.type === 'boolean') {
            values.push(req.body[item.key] ? 1 : 0);
          } else if (item.type === 'number') {
            values.push(req.body[item.key] !== null && req.body[item.key] !== undefined ? parseInt(req.body[item.key]) : null);
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
      const delay_seconds = req.body.delay_seconds !== undefined ? parseInt(req.body.delay_seconds) : 2;
      const show_typing = req.body.show_typing !== undefined ? (req.body.show_typing ? 1 : 0) : 1;
      const credential_id = req.body.credential_id !== undefined && req.body.credential_id !== null ? parseInt(req.body.credential_id) : null;
      const chatbot_mode = req.body.chatbot_mode || 'both';

      await dbRun(
        `INSERT INTO chatbot_ai_settings 
         (session_id, is_active, base_url, api_key, model_name, system_instruction, knowledge_base, knowledge_source, delay_seconds, show_typing, credential_id, chatbot_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          credential_id,
          chatbot_mode
        ]
      );
    }
    res.json({ status: 'success', message: 'Pengaturan Chatbot AI berhasil disimpan.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('constraint')) || (error.message && error.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ status: 'error', message: 'ID Sesi tidak valid atau tidak terdaftar.' });
    }
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const testAISettings = async (req, res) => {
  const { base_url, api_key, model_name, session_id, credential_id, prompt_override } = req.body;

  let resolvedKey = api_key;
  let resolvedBaseUrl = base_url;
  let resolvedModelName = model_name;

  if (!resolvedKey) {
    try {
      let cred = null;
      if (credential_id) {
        cred = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ?', [credential_id]);
      } else if (session_id) {
        const settings = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]);
        if (settings) {
          if (settings.credential_id) {
            cred = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ?', [settings.credential_id]);
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
      console.error('Gagal melakukan resolusi kredensial untuk pengetesan:', err);
    }
  }

  if (!resolvedKey) {
    return res.status(400).json({ status: 'error', message: 'API Key wajib disertakan atau dipilih untuk melakukan uji coba.' });
  }

  try {
    const openai = new OpenAI({
      apiKey: resolvedKey,
      baseURL: resolvedBaseUrl || 'https://ai.sumopod.com/v1',
      timeout: 15000
    });

    const messages = [];
    if (prompt_override) {
      messages.push({ role: 'user', content: prompt_override });
    } else {
      messages.push({ role: 'user', content: 'Say hello in a creative and professional way' });
    }

    const response = await openai.chat.completions.create({
      model: resolvedModelName || 'gpt-4o-mini',
      messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    const reply = response.choices[0]?.message?.content;
    if (reply === undefined || reply === null || reply.trim() === '') {
      return res.status(400).json({
        status: 'error',
        message: `Koneksi API berhasil, tetapi model '${resolvedModelName || 'gpt-4o-mini'}' mengembalikan respon kosong. Silakan ganti model ke 'gpt-4o-mini' atau 'MiniMax-M2.7-highspeed' di pengaturan.`
      });
    }
    res.json({ status: 'success', message: 'Koneksi API SumoPod berhasil terjalin!', reply });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Uji coba koneksi gagal: ' + error.message });
  }
};
