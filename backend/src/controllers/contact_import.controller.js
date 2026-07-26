import { dbAll, dbGet, dbRun } from '../database.js';
import { auditLog } from '../services/audit.service.js';
import {
  ContactImportError,
  parseContactImportFile
} from '../services/contact_import.service.js';
import {
  mergeVariableMaps,
  parseVariableJson,
  sanitizeVariableMap
} from '../services/contact_variables.service.js';
import { canonicalPhoneNumber } from '../services/opt_out.service.js';
import { logError } from '../logger.js';
import { sendError, sendSuccess } from '../utils/http_response.js';

async function requireOwnedGroup(groupId, userId) {
  if (!groupId) return null;
  return dbGet(
    'SELECT id, name FROM contact_groups WHERE id = ? AND user_id = ?',
    [groupId, userId]
  );
}

function sendImportError(res, error) {
  if (error instanceof ContactImportError) {
    return sendError(
      res,
      error.statusCode,
      error.errorCode,
      error.message,
      error.details
    );
  }
  return null;
}

export const previewContactImport = async (req, res) => {
  try {
    const group = await requireOwnedGroup(req.body?.group_id, req.auth.userId);
    if (!group) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke grup kontak ini.');
    }

    const parsed = parseContactImportFile(req.file);
    const { contacts, ...preview } = parsed;
    return sendSuccess(res, preview, 200, {
      message: 'File berhasil dibaca. Periksa preview sebelum mengimpor.'
    });
  } catch (error) {
    const handled = sendImportError(res, error);
    if (handled) return handled;
    logError('previewContactImport', error, { userId: req.auth?.userId });
    return sendError(res, 500, 'CONTACT_IMPORT_PREVIEW_ERROR', 'Gagal membaca file kontak.');
  }
};

export const importContactsFromFile = async (req, res) => {
  let transactionStarted = false;
  try {
    const group = await requireOwnedGroup(req.body?.group_id, req.auth.userId);
    if (!group) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke grup kontak ini.');
    }

    const duplicateMode = req.body?.duplicate_mode === 'skip' ? 'skip' : 'update';
    const parsed = parseContactImportFile(req.file);
    if (parsed.contacts.length === 0) {
      return sendError(
        res,
        400,
        'CONTACT_IMPORT_NO_VALID_ROWS',
        'Tidak ada baris kontak valid yang dapat diimpor.',
        parsed.counts
      );
    }

    const existingContacts = await dbAll(
      `SELECT id, name, phone_number, email, company, position, tags, notes, custom_fields
       FROM contacts
       WHERE group_id = ?
       ORDER BY id ASC`,
      [group.id]
    );
    const existingByPhone = new Map();
    for (const existing of existingContacts) {
      const phoneNumber = canonicalPhoneNumber(existing.phone_number);
      if (phoneNumber && !existingByPhone.has(phoneNumber)) {
        existingByPhone.set(phoneNumber, existing);
      }
    }

    const presentFields = new Set(parsed.standard_fields);
    let inserted = 0;
    let updated = 0;
    let skippedExisting = 0;

    await dbRun('BEGIN IMMEDIATE TRANSACTION');
    transactionStarted = true;

    for (const contact of parsed.contacts) {
      const existing = existingByPhone.get(contact.phone_number);
      if (existing) {
        if (duplicateMode === 'skip') {
          skippedExisting += 1;
          continue;
        }

        const mergedCustomFields = mergeVariableMaps(
          parseVariableJson(existing.custom_fields),
          contact.custom_fields
        );
        await dbRun(
          `UPDATE contacts
           SET name = ?, phone_number = ?, email = ?, company = ?, position = ?,
               tags = ?, notes = ?, custom_fields = ?
           WHERE id = ?`,
          [
            presentFields.has('name') ? contact.name : existing.name,
            contact.phone_number,
            presentFields.has('email') ? contact.email : existing.email,
            presentFields.has('company') ? contact.company : existing.company,
            presentFields.has('position') ? contact.position : existing.position,
            presentFields.has('tags') ? contact.tags : existing.tags,
            presentFields.has('notes') ? contact.notes : existing.notes,
            JSON.stringify(mergedCustomFields),
            existing.id
          ]
        );
        updated += 1;
        continue;
      }

      const result = await dbRun(
        `INSERT INTO contacts (
          group_id, name, phone_number, email, company, position, notes, tags, status,
          custom_fields
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?)`,
        [
          group.id,
          contact.name,
          contact.phone_number,
          contact.email,
          contact.company,
          contact.position,
          contact.notes,
          contact.tags,
          JSON.stringify(sanitizeVariableMap(contact.custom_fields))
        ]
      );
      existingByPhone.set(contact.phone_number, {
        id: result.id,
        ...contact,
        custom_fields: JSON.stringify(contact.custom_fields)
      });
      inserted += 1;
    }

    await dbRun('COMMIT');
    transactionStarted = false;

    const result = {
      group_id: group.id,
      source_sheet: parsed.source_sheet,
      inserted,
      updated,
      skipped_existing: skippedExisting,
      invalid_rows: parsed.counts.invalid_rows,
      duplicate_rows: parsed.counts.duplicate_rows,
      custom_fields: parsed.custom_fields
    };
    auditLog(req, 'CONTACT_IMPORT', 'contact_group', String(group.id), 'success', result);

    return sendSuccess(res, result, 201, {
      message: `Import selesai: ${inserted} kontak baru, ${updated} diperbarui, ${skippedExisting} dilewati.`
    });
  } catch (error) {
    if (transactionStarted) {
      await dbRun('ROLLBACK').catch(() => {});
    }
    const handled = sendImportError(res, error);
    if (handled) return handled;
    logError('importContactsFromFile', error, { userId: req.auth?.userId });
    return sendError(res, 500, 'CONTACT_IMPORT_ERROR', 'Gagal mengimpor kontak.');
  }
};
