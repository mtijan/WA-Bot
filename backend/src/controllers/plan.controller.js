import { dbAll, dbRun } from '../database.js';
import { sendSuccess, sendError } from '../utils/http_response.js';
import { logger } from '../logger.js';
import { auditLog } from '../services/audit.service.js';
import { validate } from '../utils/validator.js';

export const getPlans = async (req, res) => {
  try {
    const plans = await dbAll('SELECT * FROM subscription_plans ORDER BY id ASC');
    return sendSuccess(res, plans);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch subscription plans');
    return sendError(res, 500, 'SERVER_ERROR', 'Gagal mengambil data paket langganan.');
  }
};

export const createPlan = async (req, res) => {
  const { name, max_sessions, max_campaigns_per_month, max_flows, is_default } = req.body;

  const error = validate(req.body, {
    name: { required: true, type: 'string' },
    max_sessions: { required: true, type: 'number' },
    max_campaigns_per_month: { required: true, type: 'number' },
    max_flows: { required: true, type: 'number' }
  });

  if (error) {
    return sendError(res, 400, 'VALIDATION_ERROR', error);
  }

  try {
    const isDef = is_default ? 1 : 0;
    
    if (isDef === 1) {
      await dbRun('UPDATE subscription_plans SET is_default = 0');
    }

    const result = await dbRun(
      `INSERT INTO subscription_plans (name, max_sessions, max_campaigns_per_month, max_flows, is_default) 
       VALUES (?, ?, ?, ?, ?)`,
      [name, max_sessions, max_campaigns_per_month, max_flows, isDef]
    );

    await auditLog(req, 'PLAN_CREATE', 'plan', String(result.id), 'success', { name, max_sessions });

    return sendSuccess(res, { id: result.id, name, max_sessions, max_campaigns_per_month, max_flows, is_default: isDef }, 201);
  } catch (error) {
    logger.error({ err: error }, 'Failed to create subscription plan');
    return sendError(res, 500, 'SERVER_ERROR', 'Gagal membuat paket langganan.');
  }
};

export const updatePlan = async (req, res) => {
  const { id } = req.params;
  const { name, max_sessions, max_campaigns_per_month, max_flows, is_default } = req.body;

  const error = validate(req.body, {
    name: { required: true, type: 'string' },
    max_sessions: { required: true, type: 'number' },
    max_campaigns_per_month: { required: true, type: 'number' },
    max_flows: { required: true, type: 'number' }
  });

  if (error) {
    return sendError(res, 400, 'VALIDATION_ERROR', error);
  }

  try {
    const isDef = is_default ? 1 : 0;

    if (isDef === 1) {
      await dbRun('UPDATE subscription_plans SET is_default = 0');
    }

    const result = await dbRun(
      `UPDATE subscription_plans 
       SET name = ?, max_sessions = ?, max_campaigns_per_month = ?, max_flows = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, max_sessions, max_campaigns_per_month, max_flows, isDef, id]
    );

    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Paket langganan tidak ditemukan.');
    }

    await auditLog(req, 'PLAN_UPDATE', 'plan', id, 'success', { name, max_sessions });

    return sendSuccess(res, { message: 'Paket langganan berhasil diperbarui.' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to update subscription plan');
    return sendError(res, 500, 'SERVER_ERROR', 'Gagal memperbarui paket langganan.');
  }
};

export const deletePlan = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if plan is being used
    const usersWithPlan = await dbAll('SELECT id FROM users WHERE plan_id = ? LIMIT 1', [id]);
    if (usersWithPlan.length > 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Paket langganan tidak dapat dihapus karena masih digunakan oleh user.');
    }

    const result = await dbRun('DELETE FROM subscription_plans WHERE id = ?', [id]);
    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Paket langganan tidak ditemukan.');
    }

    await auditLog(req, 'PLAN_DELETE', 'plan', id, 'success');

    return sendSuccess(res, { message: 'Paket langganan berhasil dihapus.' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete subscription plan');
    return sendError(res, 500, 'SERVER_ERROR', 'Gagal menghapus paket langganan.');
  }
};
