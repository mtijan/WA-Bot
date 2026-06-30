import bcrypt from 'bcryptjs';
import { dbAll, dbGet, dbRun } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { auditLog } from '../services/audit.service.js';
import whatsappService from '../services/whatsapp.service.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';
import { resolveMediaFilePath, deleteFileIfExists } from '../services/upload.service.js';


function sanitizeUserBody(body = {}) {
  const sanitized = { ...body };
  if ('password' in sanitized) sanitized.password = '[REDACTED]';
  if ('old_password' in sanitized) sanitized.old_password = '[REDACTED]';
  if ('new_password' in sanitized) sanitized.new_password = '[REDACTED]';
  return sanitized;
}

async function assertPlanExists(planId) {
  if (planId === undefined || planId === null || planId === '') return null;
  const numericPlanId = Number(planId);
  const plan = await dbGet('SELECT id FROM subscription_plans WHERE id = ?', [numericPlanId]);
  return plan ? numericPlanId : null;
}

export const listUsers = async (req, res) => {
  try {
    const users = await dbAll(
      `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.device_limit, u.created_at, u.updated_at,
              u.plan_id, u.subscription_status, u.subscription_expires_at, u.billing_reference,
              p.name as plan_name,
              COALESCE(p.max_sessions, u.device_limit, 0) as max_sessions,
              (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND status = 'CONNECTED') as active_sessions,
              u.subscription_status as status
       FROM users u
       LEFT JOIN subscription_plans p ON u.plan_id = p.id
       ORDER BY u.created_at DESC`
    );
    return sendSuccess(res, users);
  } catch (error) {
    logError('listUsers', error);
    return sendError(res, 500, 'LIST_USERS_ERROR', 'Gagal memuat daftar pengguna.');
  }
};

export const createUser = async (req, res) => {
  try {
    const { username, password, display_name = '', role = 'user', device_limit = 1, plan_id, subscription_status = 'active', subscription_expires_at, billing_reference = '' } = req.body || {};

    const existingUser = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return sendError(res, 400, 'USER_EXISTS', 'Username sudah terdaftar.');
    }

    const resolvedPlanId = await assertPlanExists(plan_id);
    if (plan_id && !resolvedPlanId) {
      return sendError(res, 400, 'INVALID_PLAN', 'Paket langganan tidak ditemukan.');
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);

    const result = await dbRun(
      `INSERT INTO users (username, password_hash, display_name, role, is_active, device_limit, plan_id, subscription_status, subscription_expires_at, billing_reference) 
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [username, hash, display_name, role, Number(device_limit), resolvedPlanId, subscription_status, subscription_expires_at || null, billing_reference]
    );

    const newUser = await dbGet(
      `SELECT id, username, display_name, role, is_active, device_limit, plan_id, subscription_status, subscription_expires_at, billing_reference, created_at, updated_at 
       FROM users WHERE id = ?`,
      [result.id]
    );

    auditLog(req, 'USER_CREATE', 'user', String(result.id), 'success', { username, role, device_limit: Number(device_limit), plan_id: resolvedPlanId, subscription_status });
    return sendSuccess(res, newUser, 201, { message: 'Pengguna berhasil dibuat.' });
  } catch (error) {
    logError('createUser', error, { body: sanitizeUserBody(req.body) });
    return sendError(res, 500, 'CREATE_USER_ERROR', 'Gagal membuat pengguna baru.');
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { display_name, role, is_active, device_limit, plan_id, subscription_status, subscription_expires_at, billing_reference } = req.body || {};

    const targetUser = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!targetUser) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
    }

    const activeUserId = Number(req.auth?.userId);

    // Proteksi Admin Utama (ID 1)
    if (Number(id) === 1) {
      if (activeUserId !== 1) {
        return sendError(res, 403, 'MAIN_ADMIN_MODIFICATION_FORBIDDEN', 'Hanya Admin Utama yang dapat memodifikasi akun Admin Utama.');
      }
      if (role !== undefined && role !== 'admin') {
        return sendError(res, 400, 'MAIN_ADMIN_ROLE_LOCKED', 'Role Admin Utama harus tetap admin.');
      }
      if (is_active !== undefined && Number(is_active) !== 1) {
        return sendError(res, 400, 'MAIN_ADMIN_STATUS_LOCKED', 'Status Admin Utama harus tetap aktif.');
      }
    }

    if (Number(id) === activeUserId) {
      if (is_active !== undefined && Number(is_active) === 0) {
        return sendError(res, 400, 'SELF_DEACTIVATION_FORBIDDEN', 'Anda tidak dapat menonaktifkan akun sendiri.');
      }
      if (role !== undefined && role !== targetUser.role) {
        return sendError(res, 400, 'SELF_DEMOTION_FORBIDDEN', 'Anda tidak dapat mengubah role akun sendiri.');
      }
    }

    const resolvedPlanId = plan_id !== undefined ? await assertPlanExists(plan_id) : targetUser.plan_id;
    if (plan_id !== undefined && plan_id !== null && plan_id !== '' && !resolvedPlanId) {
      return sendError(res, 400, 'INVALID_PLAN', 'Paket langganan tidak ditemukan.');
    }

    const finalDisplayName = display_name !== undefined ? display_name : targetUser.display_name;
    const finalRole = role !== undefined ? role : targetUser.role;
    const finalIsActive = is_active !== undefined ? Number(is_active) : targetUser.is_active;
    const finalDeviceLimit = device_limit !== undefined ? Number(device_limit) : targetUser.device_limit;
    
    const finalPlanId = plan_id !== undefined ? resolvedPlanId : targetUser.plan_id;
    const finalSubscriptionStatus = subscription_status !== undefined ? subscription_status : targetUser.subscription_status;
    const finalSubscriptionExpiresAt = subscription_expires_at !== undefined ? subscription_expires_at : targetUser.subscription_expires_at;
    const finalBillingReference = billing_reference !== undefined ? billing_reference : targetUser.billing_reference;

    const shouldInvalidateSessions = finalRole !== targetUser.role || Number(finalIsActive) !== Number(targetUser.is_active);

    await dbRun(
      `UPDATE users 
       SET display_name = ?,
           role = ?,
           is_active = ?,
           device_limit = ?,
           plan_id = ?,
           subscription_status = ?,
           subscription_expires_at = ?,
           billing_reference = ?,
           token_version = CASE WHEN ? THEN COALESCE(token_version, 0) + 1 ELSE COALESCE(token_version, 0) END,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [finalDisplayName, finalRole, finalIsActive, finalDeviceLimit, finalPlanId, finalSubscriptionStatus, finalSubscriptionExpiresAt, finalBillingReference, shouldInvalidateSessions ? 1 : 0, id]
    );
    if (shouldInvalidateSessions) {
      await dbRun(
        'UPDATE user_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
        [id]
      );
    }

    const updatedUser = await dbGet(
      `SELECT id, username, display_name, role, is_active, device_limit, plan_id, subscription_status, subscription_expires_at, billing_reference, created_at, updated_at 
       FROM users WHERE id = ?`,
      [id]
    );

    auditLog(req, 'USER_UPDATE', 'user', String(id), 'success', {
      role: finalRole,
      is_active: finalIsActive,
      device_limit: finalDeviceLimit,
      plan_id: finalPlanId,
      subscription_status: finalSubscriptionStatus,
      sessions_invalidated: shouldInvalidateSessions,
    });
    return sendSuccess(res, updatedUser, 200, { message: 'Pengguna berhasil diperbarui.' });
  } catch (error) {
    logError('updateUser', error, { params: req.params, body: sanitizeUserBody(req.body) });
    return sendError(res, 500, 'UPDATE_USER_ERROR', 'Gagal memperbarui pengguna.');
  }
};

export const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { old_password, new_password } = req.body || {};
    const activeUserId = Number(req.auth?.userId);
    const activeUserRole = req.auth?.role;

    const targetUser = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!targetUser) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
    }

    const isSelf = Number(id) === activeUserId;
    if (Number(id) === 1 && activeUserId !== 1) {
      return sendError(res, 403, 'MAIN_ADMIN_PASSWORD_PROTECTED', 'Hanya Admin Utama yang dapat mengubah password miliknya.');
    }

    if (!isSelf && activeUserRole !== 'admin') {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki hak akses untuk mengubah password pengguna lain.');
    }

    if (isSelf) {
      if (!old_password) {
        return sendError(res, 400, 'MISSING_OLD_PASSWORD', 'Password lama wajib diisi.');
      }
      const match = await bcrypt.compare(String(old_password), targetUser.password_hash);
      if (!match) {
        return sendError(res, 400, 'INVALID_OLD_PASSWORD', 'Password lama tidak cocok.');
      }
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(new_password, salt);

    await dbRun(
      `UPDATE users 
       SET password_hash = ?,
           token_version = COALESCE(token_version, 0) + 1,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [hash, id]
    );
    await dbRun(
      'UPDATE user_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
      [id]
    );

    auditLog(req, 'USER_PASSWORD_CHANGE', 'user', String(id), 'success', { changed_by: req.auth?.userId, target_user_id: Number(id) });
    return sendSuccess(res, null, 200, { message: 'Password berhasil diperbarui.' });
  } catch (error) {
    logError('changePassword', error, { params: req.params, body: sanitizeUserBody(req.body) });
    return sendError(res, 500, 'CHANGE_PASSWORD_ERROR', 'Gagal mengubah password.');
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const activeUserId = Number(req.auth?.userId);

    if (Number(id) === 1) {
      return sendError(res, 400, 'MAIN_ADMIN_DELETION_FORBIDDEN', 'Akun Admin Utama tidak dapat dinonaktifkan atau dihapus.');
    }

    if (Number(id) === activeUserId) {
      return sendError(res, 400, 'SELF_DELETION_FORBIDDEN', 'Anda tidak dapat menghapus akun sendiri.');
    }

    const targetUser = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!targetUser) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
    }

    // 1. Clean up user WhatsApp sessions
    const userSessions = await dbAll('SELECT session_id FROM sessions WHERE user_id = ?', [id]);
    for (const session of userSessions) {
      try {
        if (isSessionManagerClientEnabled()) {
          await sessionManagerClient.deleteSession(session.session_id);
        } else {
          await whatsappService.deleteSession(session.session_id);
        }
      } catch (err) {
        logError('deleteUserSession', err, { sessionId: session.session_id });
      }
    }

    // 2. Clean up uploaded media files on disk
    const userMedia = await dbAll('SELECT filename FROM uploaded_media WHERE user_id = ?', [id]);
    for (const media of userMedia) {
      try {
        const filePath = resolveMediaFilePath(media.filename);
        deleteFileIfExists(filePath);
      } catch (err) {
        logError('deleteUserMediaFile', err, { filename: media.filename });
      }
    }

    // 3. Delete dependent rows in SQL
    await dbRun('DELETE FROM user_refresh_tokens WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM opt_out_contacts WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM chatbot_flow_sessions WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM uploaded_media WHERE user_id = ?', [id]);

    // Auto-replies linked to user sessions
    await dbRun('DELETE FROM auto_replies WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id = ?)', [id]);

    // Warmer campaigns & logs
    await dbRun('DELETE FROM warmer_logs WHERE campaign_id IN (SELECT id FROM warmer_campaigns WHERE user_id = ?)', [id]);
    await dbRun('DELETE FROM warmer_campaigns WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM warmer_templates WHERE user_id = ?', [id]);

    // Message templates
    await dbRun('DELETE FROM message_templates WHERE user_id = ?', [id]);

    // Contacts & groups
    await dbRun('DELETE FROM contacts WHERE group_id IN (SELECT id FROM contact_groups WHERE user_id = ?)', [id]);
    await dbRun('DELETE FROM contact_groups WHERE user_id = ?', [id]);

    // Campaigns & delivery logs
    await dbRun('DELETE FROM delivery_logs WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)', [id]);
    await dbRun('DELETE FROM campaigns WHERE user_id = ?', [id]);

    // Chatbot flows
    await dbRun('DELETE FROM chatbot_flows WHERE user_id = ?', [id]);

    // Chatbot AI credentials
    await dbRun('DELETE FROM chatbot_ai_credentials WHERE user_id = ?', [id]);

    // Audit logs associated with this user
    await dbRun('DELETE FROM audit_logs WHERE actor_user_id = ?', [id]);

    // 4. Finally delete the user row itself
    await dbRun('DELETE FROM users WHERE id = ?', [id]);

    auditLog(req, 'USER_DELETE', 'user', String(id), 'success', { username: targetUser.username });
    return sendSuccess(res, null, 200, { message: 'Pengguna beserta seluruh datanya berhasil dihapus secara permanen.' });
  } catch (error) {
    logError('deleteUser', error, { params: req.params });
    return sendError(res, 500, 'DELETE_USER_ERROR', 'Gagal menghapus pengguna.');
  }
};
