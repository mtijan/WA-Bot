import { OpenAI } from 'openai';
import { dbGet, dbRun } from '../database.js';
import { protectSecret } from '../services/secret.service.js';

export const maskAISettings = (settings) => ({
  ...settings,
  api_key: '',
  has_api_key: Boolean(settings.api_key)
});

export const resolveStoredApiKey = (existingKey, submittedKey, clearApiKey) => {
  if (clearApiKey) return null;
  return submittedKey || existingKey || null;
};

export const getAISettings = async (req, res) => {
  const { sessionId } = req.params;
  try {
    let settings = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [sessionId]);
    if (!settings) {
      // Kembalikan konfigurasi default jika belum pernah disimpan
      settings = {
        session_id: sessionId,
        is_active: 0,
        base_url: 'https://ai.sumopod.com/v1',
        api_key: '',
        model_name: 'glm-5-turbo',
        system_instruction: '',
        knowledge_base: '',
        delay_seconds: 2,
        show_typing: 1
      };
    }
    res.json({ status: 'success', data: maskAISettings(settings) });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const saveAISettings = async (req, res) => {
  const {
    session_id,
    is_active,
    base_url,
    api_key,
    model_name,
    system_instruction,
    knowledge_base,
    delay_seconds,
    show_typing,
    clear_api_key
  } = req.body;

  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'ID Sesi wajib disertakan.' });
  }

  try {
    const existing = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [session_id]);
    if (existing) {
      await dbRun(
        `UPDATE chatbot_ai_settings 
         SET is_active = ?, base_url = ?, api_key = ?, model_name = ?, system_instruction = ?, knowledge_base = ?, delay_seconds = ?, show_typing = ?
         WHERE session_id = ?`,
        [
          is_active ? 1 : 0,
          base_url || 'https://ai.sumopod.com/v1',
          protectSecret(resolveStoredApiKey(existing.api_key, api_key, clear_api_key)),
          model_name || 'glm-5-turbo',
          system_instruction,
          knowledge_base,
          delay_seconds !== undefined ? parseInt(delay_seconds) : 2,
          show_typing ? 1 : 0,
          session_id
        ]
      );
    } else {
      await dbRun(
        `INSERT INTO chatbot_ai_settings 
         (session_id, is_active, base_url, api_key, model_name, system_instruction, knowledge_base, delay_seconds, show_typing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session_id,
          is_active ? 1 : 0,
          base_url || 'https://ai.sumopod.com/v1',
          protectSecret(api_key),
          model_name || 'glm-5-turbo',
          system_instruction,
          knowledge_base,
          delay_seconds !== undefined ? parseInt(delay_seconds) : 2,
          show_typing ? 1 : 0
        ]
      );
    }
    res.json({ status: 'success', message: 'Pengaturan Chatbot AI berhasil disimpan.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const testAISettings = async (req, res) => {
  const { base_url, api_key, model_name } = req.body;

  if (!api_key) {
    return res.status(400).json({ status: 'error', message: 'API Key wajib disertakan untuk melakukan uji coba.' });
  }

  try {
    const openai = new OpenAI({
      apiKey: api_key,
      baseURL: base_url || 'https://ai.sumopod.com/v1'
    });

    const response = await openai.chat.completions.create({
      model: model_name || 'glm-5-turbo',
      messages: [
        { role: 'user', content: 'Say hello in a creative and professional way' }
      ],
      max_tokens: 50,
      temperature: 0.7
    });

    const reply = response.choices[0].message.content;
    res.json({ status: 'success', message: 'Koneksi API SumoPod berhasil terjalin!', reply });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Uji coba koneksi gagal: ' + error.message });
  }
};
