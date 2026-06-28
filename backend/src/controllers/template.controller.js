import { dbRun, dbAll, dbGet } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { auditLog } from '../services/audit.service.js';

export const getTemplates = async (req, res) => {
  try {
    const sql = req.auth.role === 'admin'
      ? 'SELECT * FROM message_templates ORDER BY created_at DESC'
      : 'SELECT * FROM message_templates WHERE user_id = ? ORDER BY created_at DESC';
    const templates = await dbAll(sql, req.auth.role === 'admin' ? [] : [req.auth.userId]);
    return sendSuccess(res, templates);
  } catch (error) {
    logError('getTemplates', error);
    return sendError(res, 500, 'GET_TEMPLATES_ERROR', 'Gagal memuat template.');
  }
};

export const createTemplate = async (req, res) => {
  const { 
    name, 
    content, 
    type = 'text', 
    category = 'General', 
    attachment_url = null, 
    attachment_name = null, 
    contact_name = null, 
    contact_number = null, 
    poll_question = null, 
    poll_options = null 
  } = req.body;

  try {
    const result = await dbRun(
      `INSERT INTO message_templates 
      (name, content, type, category, attachment_url, attachment_name, contact_name, contact_number, poll_question, poll_options, user_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        content,
        type,
        category,
        attachment_url,
        attachment_name,
        contact_name,
        contact_number,
        poll_question,
        poll_options,
        req.auth.userId
      ]
    );
    auditLog(req, 'TEMPLATE_CREATE', 'template', String(result.id), 'success', { name, type, category });
    return sendSuccess(res, { 
      id: result.id, 
      name, 
      content, 
      type, 
      category, 
      attachment_url, 
      attachment_name, 
      contact_name, 
      contact_number, 
      poll_question, 
      poll_options 
    }, 201, { message: 'Template berhasil disimpan.' });
  } catch (error) {
    logError('createTemplate', error, { body: req.body });
    return sendError(res, 500, 'CREATE_TEMPLATE_ERROR', 'Gagal menyimpan template.');
  }
};

export const deleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM message_templates WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'TEMPLATE_NOT_FOUND', 'Template tidak ditemukan.');
    }

    if (req.auth.role !== 'admin' && existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke template ini.');
    }

    await dbRun('DELETE FROM message_templates WHERE id = ?', [id]);
    auditLog(req, 'TEMPLATE_DELETE', 'template', String(id), 'success', { name: existing.name });
    return sendSuccess(res, null, 200, { message: 'Template berhasil dihapus.' });
  } catch (error) {
    logError('deleteTemplate', error, { params: req.params });
    return sendError(res, 500, 'DELETE_TEMPLATE_ERROR', 'Gagal menghapus template.');
  }
};
