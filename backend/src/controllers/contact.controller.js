import { dbRun, dbAll, dbGet } from '../database.js';
import whatsappService from '../services/whatsapp.service.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

export const getGroups = async (req, res) => {
  try {
    const sql = `
      SELECT 
        cg.id, cg.name, cg.description, cg.color, cg.created_at,
        COUNT(c.id) AS total_contacts,
        SUM(CASE WHEN c.status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_contacts,
        SUM(CASE WHEN c.status = 'UNVERIFIED' THEN 1 ELSE 0 END) AS unverified_contacts
      FROM contact_groups cg
      LEFT JOIN contacts c ON cg.id = c.group_id
      GROUP BY cg.id
      ORDER BY cg.created_at DESC
    `;
    const groups = await dbAll(sql);
    res.json({ status: 'success', data: groups });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createGroup = async (req, res) => {
  const { name, description, color } = req.body;
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Group name is required' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO contact_groups (name, description, color) VALUES (?, ?, ?)',
      [name, description, color || '#3b82f6']
    );
    res.status(201).json({ status: 'success', message: 'Contact group created', data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateGroup = async (req, res) => {
  const { id } = req.params;
  const { name, description, color } = req.body;
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Group name is required' });
  }

  try {
    const existing = await dbGet('SELECT * FROM contact_groups WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Contact group not found' });
    }

    await dbRun(
      'UPDATE contact_groups SET name = ?, description = ?, color = ? WHERE id = ?',
      [name, description, color, id]
    );
    res.json({ status: 'success', message: 'Contact group updated' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteGroup = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM contact_groups WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Contact group not found' });
    }

    // Manual cascade delete contacts for safety
    await dbRun('DELETE FROM contacts WHERE group_id = ?', [id]);
    await dbRun('DELETE FROM contact_groups WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Contact group deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getContacts = async (req, res) => {
  const { groupId, search, status } = req.query;
  if (!groupId) {
    return res.status(400).json({ status: 'error', message: 'groupId parameter is required' });
  }

  try {
    let sql = 'SELECT * FROM contacts WHERE group_id = ?';
    let params = [groupId];

    if (search) {
      sql += ' AND (name LIKE ? OR phone_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status && status !== 'All Status' && status !== 'ALL') {
      sql += ' AND status = ?';
      params.push(status.toUpperCase());
    }

    sql += ' ORDER BY created_at DESC';

    const contacts = await dbAll(sql, params);
    res.json({ status: 'success', data: contacts });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createContact = async (req, res) => {
  const {
    group_id,
    name,
    phone_number,
    email,
    company,
    position,
    notes,
    tags,
    var1,
    var2,
    var3,
    var4,
    var5,
    var6,
    var7,
    var8,
    var9,
    var10
  } = req.body;

  if (!group_id || !phone_number) {
    return res.status(400).json({ status: 'error', message: 'Group ID and Phone Number are required' });
  }

  try {
    let cleanPhone = phone_number.toString().trim();
    if (cleanPhone.toLowerCase().includes('e+')) {
      const parsed = Number(cleanPhone);
      if (!isNaN(parsed)) {
        cleanPhone = parsed.toString();
      }
    }

    const finalName = (name && name.trim()) ? name.trim() : `Contact-${cleanPhone}`;

    const result = await dbRun(
      `INSERT INTO contacts (
        group_id, name, phone_number, email, company, position, notes, tags, status,
        var1, var2, var3, var4, var5, var6, var7, var8, var9, var10
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        group_id,
        finalName,
        cleanPhone,
        email || '',
        company || '',
        position || '',
        notes || '',
        tags || '',
        'UNVERIFIED',
        var1 || '',
        var2 || '',
        var3 || '',
        var4 || '',
        var5 || '',
        var6 || '',
        var7 || '',
        var8 || '',
        var9 || '',
        var10 || ''
      ]
    );

    res.status(201).json({ status: 'success', message: 'Contact created', data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateContact = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    phone_number,
    email,
    company,
    position,
    notes,
    tags,
    status,
    var1,
    var2,
    var3,
    var4,
    var5,
    var6,
    var7,
    var8,
    var9,
    var10
  } = req.body;

  if (!name || !phone_number) {
    return res.status(400).json({ status: 'error', message: 'Name and Phone Number are required' });
  }

  try {
    const existing = await dbGet('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Contact not found' });
    }

    let cleanPhone = phone_number.toString().trim();
    if (cleanPhone.toLowerCase().includes('e+')) {
      const parsed = Number(cleanPhone);
      if (!isNaN(parsed)) {
        cleanPhone = parsed.toString();
      }
    }

    await dbRun(
      `UPDATE contacts SET 
        name = ?, phone_number = ?, email = ?, company = ?, position = ?, notes = ?, tags = ?, status = ?,
        var1 = ?, var2 = ?, var3 = ?, var4 = ?, var5 = ?, var6 = ?, var7 = ?, var8 = ?, var9 = ?, var10 = ?
      WHERE id = ?`,
      [
        name,
        cleanPhone,
        email || '',
        company || '',
        position || '',
        notes || '',
        tags || '',
        status || 'UNVERIFIED',
        var1 || '',
        var2 || '',
        var3 || '',
        var4 || '',
        var5 || '',
        var6 || '',
        var7 || '',
        var8 || '',
        var9 || '',
        var10 || '',
        id
      ]
    );

    res.json({ status: 'success', message: 'Contact updated' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteContact = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Contact not found' });
    }

    await dbRun('DELETE FROM contacts WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const bulkCreateContacts = async (req, res) => {
  const { group_id, contacts } = req.body;
  if (!group_id || !Array.isArray(contacts)) {
    return res.status(400).json({ status: 'error', message: 'Group ID and contacts array are required' });
  }

  try {
    // Jalankan dalam sequence
    for (const c of contacts) {
      let phone = (c.Phone || c.phone_number || c.phone || c.Number || c.number || c.telepon || c.hp || '').toString().trim();
      if (phone.toLowerCase().includes('e+')) {
        const parsed = Number(phone);
        if (!isNaN(parsed)) {
          phone = parsed.toString();
        }
      }

      if (!phone) continue; // Skip jika tidak ada nomor telepon

      const name = c.Name || c.name || c.nama || `Contact-${phone}`;
      const email = c.Email || c.email || c.mail || '';
      const company = c.Company || c.company || c.perusahaan || '';
      const position = c.Position || c.position || c.jabatan || '';
      const notes = c.Notes || c.notes || c.catatan || '';
      const tags = c.Tags || c.tags || c.tag || '';
      const var1 = c.Var1 || c.var1 || '';
      const var2 = c.Var2 || c.var2 || '';
      const var3 = c.Var3 || c.var3 || '';
      const var4 = c.Var4 || c.var4 || '';
      const var5 = c.Var5 || c.var5 || '';
      const var6 = c.Var6 || c.var6 || '';
      const var7 = c.Var7 || c.var7 || '';
      const var8 = c.Var8 || c.var8 || '';
      const var9 = c.Var9 || c.var9 || '';
      const var10 = c.Var10 || c.var10 || '';

      await dbRun(
        `INSERT INTO contacts (
          group_id, name, phone_number, email, company, position, notes, tags, status,
          var1, var2, var3, var4, var5, var6, var7, var8, var9, var10
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          group_id,
          name,
          phone,
          email,
          company,
          position,
          notes,
          tags,
          'UNVERIFIED',
          var1,
          var2,
          var3,
          var4,
          var5,
          var6,
          var7,
          var8,
          var9,
          var10
        ]
      );
    }

    res.status(201).json({ status: 'success', message: `Imported ${contacts.length} contacts successfully` });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteInvalidContacts = async (req, res) => {
  const { groupId } = req.params;
  try {
    await dbRun('DELETE FROM contacts WHERE group_id = ? AND status = "INVALID"', [groupId]);
    res.json({ status: 'success', message: 'All invalid contacts deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const cleanupOrphanedContacts = async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM contacts WHERE group_id NOT IN (SELECT id FROM contact_groups)');
    res.json({ status: 'success', message: `Cleaned up ${result.changes} orphaned contact(s) successfully` });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const verifyGroupContacts = async (req, res) => {
  const { groupId } = req.params;
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'session_id is required for verification' });
  }

  if (isSessionManagerClientEnabled()) {
    try {
      const result = await sessionManagerClient.verifyGroupContacts(groupId, session_id);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
  }

  const sock = whatsappService.sockets[session_id];
  if (!sock) {
    return res.status(404).json({ status: 'error', message: `WhatsApp session "${session_id}" is disconnected or not found.` });
  }

  try {
    const contacts = await dbAll('SELECT * FROM contacts WHERE group_id = ? AND status = "UNVERIFIED"', [groupId]);
    if (contacts.length === 0) {
      return res.json({ status: 'success', message: 'No unverified contacts found in this group' });
    }

    let verifiedCount = 0;
    let invalidCount = 0;

    // Verifikasi asinkron berantai (dengan throttling halus agar meta tidak curiga)
    for (const contact of contacts) {
      let phone = contact.phone_number.toString().trim();
      if (phone.startsWith('0')) {
        phone = '62' + phone.slice(1);
      }
      if (!phone.endsWith('@s.whatsapp.net')) {
        phone = `${phone}@s.whatsapp.net`;
      }

      try {
        const [result] = await sock.onWhatsApp(phone);
        let newStatus = 'INVALID';
        if (result && result.exists) {
          newStatus = 'VERIFIED';
          verifiedCount++;
        } else {
          invalidCount++;
        }

        await dbRun('UPDATE contacts SET status = ? WHERE id = ?', [newStatus, contact.id]);
        
        // Jeda halus 150ms agar stabil
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        console.error(`Verification failed for number ${contact.phone_number}:`, err.message);
      }
    }

    res.json({ 
      status: 'success', 
      message: `Verification complete. Verified: ${verifiedCount}, Invalid: ${invalidCount}` 
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
