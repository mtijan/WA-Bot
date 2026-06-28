import { dbGet } from '../database.js';
import { sendError } from '../utils/http_response.js';

export async function requireActiveSubscription(req, res, next) {
  if (req.auth && req.auth.role === 'admin') {
    return next();
  }

  try {
    const user = await dbGet(`
      SELECT u.subscription_status, u.subscription_expires_at
      FROM users u
      WHERE u.id = ?
    `, [req.auth.userId]);

    if (!user) {
      return sendError(res, 403, 'PAYMENT_REQUIRED', 'Pengguna tidak ditemukan.');
    }

    if (user.subscription_status !== 'active') {
      return sendError(res, 403, 'PAYMENT_REQUIRED', 'Status langganan Anda tidak aktif. Silakan hubungi Administrator.');
    }

    if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) {
      return sendError(res, 403, 'PAYMENT_REQUIRED', 'Masa berlangganan Anda telah kedaluwarsa. Silakan perpanjang langganan Anda.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function checkSessionQuota(req, res, next) {
  if (req.auth && req.auth.role === 'admin') {
    return next();
  }

  try {
    const data = await dbGet(`
      SELECT p.max_sessions, (SELECT COUNT(*) FROM sessions WHERE user_id = ?) as current_sessions
      FROM users u
      LEFT JOIN subscription_plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `, [req.auth.userId, req.auth.userId]);

    if (!data) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Data langganan tidak ditemukan.');
    }

    const maxSessions = data.max_sessions || 1;
    if (data.current_sessions >= maxSessions) {
      return sendError(res, 403, 'QUOTA_EXCEEDED', `Kuota perangkat (session) telah tercapai (${maxSessions}). Silakan upgrade paket Anda.`);
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function checkCampaignQuota(req, res, next) {
  if (req.auth && req.auth.role === 'admin') {
    return next();
  }

  try {
    // Check campaigns created in current calendar month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const data = await dbGet(`
      SELECT p.max_campaigns_per_month, (
        SELECT COUNT(*) FROM campaigns 
        WHERE user_id = ? AND created_at >= ?
      ) as current_campaigns
      FROM users u
      LEFT JOIN subscription_plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `, [req.auth.userId, startOfMonth.toISOString(), req.auth.userId]);

    if (!data) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Data langganan tidak ditemukan.');
    }

    const maxCampaigns = data.max_campaigns_per_month || 1;
    if (data.current_campaigns >= maxCampaigns) {
      return sendError(res, 403, 'QUOTA_EXCEEDED', `Kuota kampanye bulan ini telah tercapai (${maxCampaigns}). Silakan upgrade paket Anda.`);
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function checkFlowQuota(req, res, next) {
  if (req.auth && req.auth.role === 'admin') {
    return next();
  }

  try {
    const data = await dbGet(`
      SELECT p.max_flows, (SELECT COUNT(*) FROM chatbot_flows WHERE user_id = ?) as current_flows
      FROM users u
      LEFT JOIN subscription_plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `, [req.auth.userId, req.auth.userId]);

    if (!data) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Data langganan tidak ditemukan.');
    }

    const maxFlows = data.max_flows || 1;
    if (data.current_flows >= maxFlows) {
      return sendError(res, 403, 'QUOTA_EXCEEDED', `Kuota alur chatbot telah tercapai (${maxFlows}). Silakan upgrade paket Anda.`);
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function checkFlowImportQuota(req, res, next) {
  if (req.auth && req.auth.role === 'admin') {
    return next();
  }

  try {
    const requestedFlows = Array.isArray(req.body?.flows) ? req.body.flows.length : 0;
    if (requestedFlows === 0) {
      return next();
    }

    const data = await dbGet(`
      SELECT p.max_flows, (SELECT COUNT(*) FROM chatbot_flows WHERE user_id = ?) as current_flows
      FROM users u
      LEFT JOIN subscription_plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `, [req.auth.userId, req.auth.userId]);

    if (!data) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Data langganan tidak ditemukan.');
    }

    const maxFlows = data.max_flows || 1;
    if ((Number(data.current_flows || 0) + requestedFlows) > maxFlows) {
      return sendError(
        res,
        403,
        'QUOTA_EXCEEDED',
        `Import ini melebihi kuota alur chatbot (${maxFlows}). Silakan upgrade paket Anda.`
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
}
