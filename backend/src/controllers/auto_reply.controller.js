import { dbRun, dbAll, dbGet } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

/**
 * Verify that the auto_reply belongs to a session owned by the requesting user.
 * Returns the auto_reply row if valid, null otherwise.
 */
const getAutoReplyIfOwned = async (autoReplyId, userId) => {
  return dbGet(
    `SELECT ar.* FROM auto_replies ar
     INNER JOIN sessions s ON ar.session_id = s.session_id
     WHERE ar.id = ? AND s.user_id = ?`,
    [autoReplyId, userId]
  );
};

export const getAutoReplies = async (req, res) => {
  const { sessionId } = req.query;
  try {
    // Always filter by user ownership via sessions join
    if (sessionId) {
      // Verify the caller owns this session
      const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sessionId]);
      if (!sess || sess.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
      }
      const replies = await dbAll(
        'SELECT * FROM auto_replies WHERE session_id = ? ORDER BY created_at DESC',
        [sessionId]
      );
      return sendSuccess(res, replies);
    }

    // No sessionId filter: return all auto_replies owned by this user
    const replies = await dbAll(
      `SELECT ar.* FROM auto_replies ar
       INNER JOIN sessions s ON ar.session_id = s.session_id
       WHERE s.user_id = ?
       ORDER BY ar.created_at DESC`,
      [req.auth.userId]
    );
    return sendSuccess(res, replies);
  } catch (error) {
    logError('getAutoReplies', error, { query: req.query });
    return sendError(res, 500, 'GET_AUTO_REPLIES_ERROR', 'Gagal memuat auto-reply.');
  }
};

export const createAutoReply = async (req, res) => {
  const { session_id, keyword, type, content, options } = req.body;

  try {
    // Verify the caller owns this session
    const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [session_id]);
    if (!sess || sess.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke sesi ini.');
    }

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
    const existing = await getAutoReplyIfOwned(id, req.auth.userId);
    if (!existing) {
      return sendError(res, 404, 'AUTO_REPLY_NOT_FOUND', 'Auto-reply tidak ditemukan atau Anda tidak memiliki akses.');
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
    const existing = await getAutoReplyIfOwned(id, req.auth.userId);
    if (!existing) {
      return sendError(res, 404, 'AUTO_REPLY_NOT_FOUND', 'Auto-reply tidak ditemukan atau Anda tidak memiliki akses.');
    }

    await dbRun('DELETE FROM auto_replies WHERE id = ?', [id]);
    return sendSuccess(res, null, 200, { message: 'Auto-reply berhasil dihapus.' });
  } catch (error) {
    logError('deleteAutoReply', error, { params: req.params });
    return sendError(res, 500, 'DELETE_AUTO_REPLY_ERROR', 'Gagal menghapus auto-reply.');
  }
};
