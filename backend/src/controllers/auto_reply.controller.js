import { dbRun, dbAll, dbGet } from '../database.js';

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
    res.json({ status: 'success', data: replies });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createAutoReply = async (req, res) => {
  const { session_id, keyword, type, content, options } = req.body;

  if (!session_id || !keyword || !type || !content) {
    return res.status(400).json({ status: 'error', message: 'Incomplete parameters' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO auto_replies (session_id, keyword, type, content, options) VALUES (?, ?, ?, ?, ?)',
      [session_id, keyword, type, content, options ? JSON.stringify(options) : null]
    );
    res.status(201).json({ status: 'success', message: 'Auto-reply created', data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateAutoReply = async (req, res) => {
  const { id } = req.params;
  const { keyword, type, content, options } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM auto_replies WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Auto-reply not found' });
    }

    await dbRun(
      'UPDATE auto_replies SET keyword = ?, type = ?, content = ?, options = ? WHERE id = ?',
      [keyword, type, content, options ? JSON.stringify(options) : null, id]
    );
    res.json({ status: 'success', message: 'Auto-reply updated' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteAutoReply = async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM auto_replies WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Auto-reply deleted' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
