import { dbRun, dbAll, dbGet } from '../database.js';
import whatsappService from '../services/whatsapp.service.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

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
    return sendSuccess(res, groups);
  } catch (error) {
    logError('getGroupsContacts', error);
    return sendError(res, 500, 'GET_CONTACT_GROUPS_ERROR', 'Gagal memuat grup kontak.');
  }
};

export const createGroup = async (req, res) => {
  const { name, description, color } = req.body;

  try {
    const result = await dbRun(
      'INSERT INTO contact_groups (name, description, color) VALUES (?, ?, ?)',
      [name, description || null, color || '#3b82f6']
    );
    return sendSuccess(res, { id: result.id }, 201, { message: 'Grup kontak berhasil dibuat.' });
  } catch (error) {
    logError('createGroupContacts', error, { body: req.body });
    return sendError(res, 500, 'CREATE_CONTACT_GROUP_ERROR', 'Gagal membuat grup kontak.');
  }
};

export const updateGroup = async (req, res) => {
  const { id } = req.params;
  const { name, description, color } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM contact_groups WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CONTACT_GROUP_NOT_FOUND', 'Grup kontak tidak ditemukan.');
    }

    await dbRun(
      'UPDATE contact_groups SET name = ?, description = ?, color = ? WHERE id = ?',
      [name, description || null, color || '#3b82f6', id]
    );
    return sendSuccess(res, null, 200, { message: 'Grup kontak berhasil diperbarui.' });
  } catch (error) {
    logError('updateGroupContacts', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_CONTACT_GROUP_ERROR', 'Gagal memperbarui grup kontak.');
  }
};

export const deleteGroup = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM contact_groups WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CONTACT_GROUP_NOT_FOUND', 'Grup kontak tidak ditemukan.');
    }

    // Manual cascade delete contacts for safety
    await dbRun('DELETE FROM contacts WHERE group_id = ?', [id]);
    await dbRun('DELETE FROM contact_groups WHERE id = ?', [id]);
    return sendSuccess(res, null, 200, { message: 'Grup kontak berhasil dihapus.' });
  } catch (error) {
    logError('deleteGroupContacts', error, { params: req.params });
    return sendError(res, 500, 'DELETE_CONTACT_GROUP_ERROR', 'Gagal menghapus grup kontak.');
  }
};

export const getContacts = async (req, res) => {
  const { groupId, search, status } = req.query;
  if (!groupId) {
    return sendError(res, 400, 'GROUP_ID_REQUIRED', 'Parameter groupId wajib disertakan.');
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
    return sendSuccess(res, contacts);
  } catch (error) {
    logError('getContacts', error, { query: req.query });
    return sendError(res, 500, 'GET_CONTACTS_ERROR', 'Gagal memuat daftar kontak.');
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

    return sendSuccess(res, { id: result.id }, 201, { message: 'Kontak berhasil ditambahkan.' });
  } catch (error) {
    logError('createContact', error, { body: req.body });
    return sendError(res, 500, 'CREATE_CONTACT_ERROR', 'Gagal menambahkan kontak.');
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

  try {
    const existing = await dbGet('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CONTACT_NOT_FOUND', 'Kontak tidak ditemukan.');
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

    return sendSuccess(res, null, 200, { message: 'Kontak berhasil diperbarui.' });
  } catch (error) {
    logError('updateContact', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_CONTACT_ERROR', 'Gagal memperbarui kontak.');
  }
};

export const deleteContact = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'CONTACT_NOT_FOUND', 'Kontak tidak ditemukan.');
    }

    await dbRun('DELETE FROM contacts WHERE id = ?', [id]);
    return sendSuccess(res, null, 200, { message: 'Kontak berhasil dihapus.' });
  } catch (error) {
    logError('deleteContact', error, { params: req.params });
    return sendError(res, 500, 'DELETE_CONTACT_ERROR', 'Gagal menghapus kontak.');
  }
};

export const bulkCreateContacts = async (req, res) => {
  const { group_id, contacts } = req.body;

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

    return sendSuccess(res, null, 201, { message: `Imported ${contacts.length} contacts successfully` });
  } catch (error) {
    logError('bulkCreateContacts', error, { body: req.body });
    return sendError(res, 500, 'BULK_CREATE_CONTACTS_ERROR', 'Gagal mengimpor kontak.');
  }
};

export const deleteInvalidContacts = async (req, res) => {
  const { groupId } = req.params;
  try {
    await dbRun('DELETE FROM contacts WHERE group_id = ? AND status = "INVALID"', [groupId]);
    return sendSuccess(res, null, 200, { message: 'Semua nomor tidak valid berhasil dihapus.' });
  } catch (error) {
    logError('deleteInvalidContacts', error, { params: req.params });
    return sendError(res, 500, 'DELETE_INVALID_CONTACTS_ERROR', 'Gagal menghapus kontak tidak valid.');
  }
};

export const cleanupOrphanedContacts = async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM contacts WHERE group_id NOT IN (SELECT id FROM contact_groups)');
    return sendSuccess(res, null, 200, { message: `Berhasil membersihkan ${result.changes} kontak yatim.` });
  } catch (error) {
    logError('cleanupOrphanedContacts', error);
    return sendError(res, 500, 'CLEANUP_ORPHANED_CONTACTS_ERROR', 'Gagal membersihkan kontak yatim.');
  }
};

export const verifyGroupContacts = async (req, res) => {
  const { groupId } = req.params;
  const { session_id } = req.body;

  if (isSessionManagerClientEnabled()) {
    try {
      const result = await sessionManagerClient.verifyGroupContacts(groupId, session_id);
      return res.json(result);
    } catch (error) {
      logError('delegateVerifyGroupContacts', error, { groupId, sessionId: session_id });
      return sendError(res, 500, 'DELEGATE_VERIFY_CONTACTS_ERROR', error.message || 'Gagal mendelegasikan verifikasi kontak.');
    }
  }

  const sock = whatsappService.sockets[session_id];
  if (!sock) {
    return sendError(res, 404, 'SESSION_NOT_ACTIVE', `Sesi WhatsApp "${session_id}" tidak aktif atau tidak terhubung.`);
  }

  try {
    const contacts = await dbAll('SELECT * FROM contacts WHERE group_id = ? AND status = "UNVERIFIED"', [groupId]);
    if (contacts.length === 0) {
      return sendSuccess(res, null, 200, { message: 'Tidak ada kontak belum terverifikasi dalam grup ini.' });
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
        logError('verifySingleContact', err, { phoneNumber: contact.phone_number });
      }
    }

    return sendSuccess(res, null, 200, { message: `Verifikasi selesai. Terverifikasi: ${verifiedCount}, Tidak Valid: ${invalidCount}` });
  } catch (error) {
    logError('verifyGroupContacts', error, { groupId, sessionId: session_id });
    return sendError(res, 500, 'VERIFY_GROUP_CONTACTS_ERROR', error.message || 'Gagal memproses verifikasi kontak.');
  }
};
