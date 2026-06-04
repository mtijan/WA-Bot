import { dbRun, dbAll, dbGet } from '../database.js';

export const getTemplates = async (req, res) => {
  try {
    const sql = 'SELECT * FROM message_templates ORDER BY created_at DESC';
    const templates = await dbAll(sql);
    res.json({ status: 'success', data: templates });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
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

  if (!name || !content) {
    return res.status(400).json({ status: 'error', message: 'Name and content are required' });
  }

  try {
    const result = await dbRun(
      `INSERT INTO message_templates 
      (name, content, type, category, attachment_url, attachment_name, contact_name, contact_number, poll_question, poll_options) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        poll_options
      ]
    );
    res.status(201).json({ 
      status: 'success', 
      message: 'Template saved', 
      data: { 
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
      } 
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM message_templates WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Template not found' });
    }

    await dbRun('DELETE FROM message_templates WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Template deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
