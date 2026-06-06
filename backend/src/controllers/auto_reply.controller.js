import { dbRun, dbAll, dbGet } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

export const getAutoReplies = async (req, res) => {
  const { sessionId } = req.query;
  try {
    let query = 'SELECT * FROM auto_replies';
    let params = [];
    if (sessionId) {
      query += ' WHERE session_id = ?';
      params.push(sessionId);
    }
    const replies = await dbAll(query, params);
    return sendSuccess(res, replies);
  } catch (error) {
    logError('getAutoReplies', error, { query: req.query });
    return sendError(res, 500, 'GET_AUTO_REPLIES_ERROR', 'Gagal memuat auto-reply.');
  }
};

export const createAutoReply = async (req, res) => {
  const { session_id, keyword, type, content, options } = req.body;

  try {
    const result = await dbRun(
      'INSERT INTO auto_replies (session_id, keyword, type, content, options) VALUES (?, ?, ?, ?, ?)',
      [session_id, keyword, type, content, options ? JSON.stringify(options) : null]
    );
    return sendSuccess(res, { id: result.id }, 201, { message: 'Auto-reply berhasil disimpan.' });
  } catch (error) {
    logError('createAutoReply', error, { body: req.body });
    return sendError(res, 500, 'CREATE_AUTO_REPLY_ERROR', 'Gagal menyimpan auto-reply.');
  }
};

export const updateAutoReply = async (req, res) => {
  const { id } = req.params;
  const { keyword, type, content, options } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM auto_replies WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'AUTO_REPLY_NOT_FOUND', 'Auto-reply tidak ditemukan.');
    }

    await dbRun(
      'UPDATE auto_replies SET keyword = ?, type = ?, content = ?, options = ? WHERE id = ?',
      [keyword, type, content, options ? JSON.stringify(options) : null, id]
    );
    return sendSuccess(res, null, 200, { message: 'Auto-reply berhasil diperbarui.' });
  } catch (error) {
    logError('updateAutoReply', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_AUTO_REPLY_ERROR', 'Gagal memperbarui auto-reply.');
  }
};

export const deleteAutoReply = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM auto_replies WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'AUTO_REPLY_NOT_FOUND', 'Auto-reply tidak ditemukan.');
    }

    await dbRun('DELETE FROM auto_replies WHERE id = ?', [id]);
    return sendSuccess(res, null, 200, { message: 'Auto-reply berhasil dihapus.' });
  } catch (error) {
    logError('deleteAutoReply', error, { params: req.params });
    return sendError(res, 500, 'DELETE_AUTO_REPLY_ERROR', 'Gagal menghapus auto-reply.');
  }
};
