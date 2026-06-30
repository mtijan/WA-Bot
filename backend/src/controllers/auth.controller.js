import bcrypt from 'bcryptjs';
import { dbGet, dbRun } from '../database.js';
import {
  buildAccessCookie,
  buildClearAccessCookie,
  buildClearRefreshCookie,
  buildRefreshCookie,
  getSessionFromRequest,
  getRefreshSessionFromRequest,
  hashToken,
  signAccessToken,
  signRefreshToken
} from '../middleware/admin_auth.middleware.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { auditLog } from '../services/audit.service.js';

function getCookieValue(req, name) {
  const header = req.headers?.cookie || '';
  const prefix = `${name}=`;
  const item = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

export const getAuthStatus = async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return sendSuccess(res, {
        enabled: true,
        authenticated: false,
        username: null,
        role: null
      });
    }

    const user = await dbGet(
      'SELECT id, username, role, is_active, token_version, subscription_expires_at FROM users WHERE id = ?',
      [session.sub]
    );
    const authenticated = Boolean(
      user
        && Number(user.is_active) === 1
        && Number(user.token_version || 0) === Number(session.ver || 0)
    );

    return sendSuccess(res, {
        enabled: true,
        authenticated,
        userId: authenticated ? user.id : null,
        username: authenticated ? user.username : null,
        role: authenticated ? user.role : null,
        subscriptionExpiresAt: authenticated ? user.subscription_expires_at : null
    });
  } catch (error) {
    logError('getAuthStatus', error);
    return sendError(res, 500, 'GET_AUTH_STATUS_ERROR', 'Gagal memuat status autentikasi.');
  }
};

export const login = async (req, res) => {
  try {
    const { username = '', password = '' } = req.body || {};
    
    if (!username || !password) {
      return sendError(res, 400, 'MISSING_CREDENTIALS', 'Username dan password wajib diisi.');
    }

    const user = await dbGet('SELECT * FROM users WHERE username = ?', [String(username)]);
    if (!user || user.is_active === 0) {
      await bcrypt.compare(String(password), '$2a$12$L8yKk13Zt9QoV.rUjI6.Oe/8qG00U3gN.4Wk1.mH123456789012');
      // Audit failed login without revealing which field was wrong
      auditLog({ headers: req.headers, ip: req.ip, socket: req.socket }, 'AUTH_LOGIN_FAILED', 'user', null, 'failure', { username: String(username) });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Username atau password tidak valid.');
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      auditLog({ headers: req.headers, ip: req.ip, socket: req.socket }, 'AUTH_LOGIN_FAILED', 'user', String(user.id), 'failure', { username: user.username });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Username atau password tidak valid.');
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    const refreshSession = getRefreshSessionFromRequest({
      headers: { cookie: `wa_bot_refresh=${encodeURIComponent(refreshToken)}` }
    });

    await dbRun(
      `INSERT INTO user_refresh_tokens (jti, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime(?, 'unixepoch'))`,
      [refreshSession.jti, user.id, hashToken(refreshToken), Math.floor(refreshSession.exp / 1000)]
    );

    res.setHeader('Set-Cookie', [
      buildAccessCookie(accessToken),
      buildRefreshCookie(refreshToken)
    ]);

    // Augment req.auth manually since middleware hasn't run yet for /auth/login
    req.auth = { userId: user.id, username: user.username, role: user.role };
    auditLog(req, 'AUTH_LOGIN', 'user', String(user.id), 'success', { role: user.role });

    return sendSuccess(res, {
      enabled: true,
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: user.role,
      subscriptionExpiresAt: user.subscription_expires_at
    });
  } catch (error) {
    logError('login', error);
    return sendError(res, 500, 'LOGIN_ERROR', 'Terjadi kesalahan saat memproses login.');
  }
};

export const logout = async (req, res) => {
  try {
    const refreshSession = getRefreshSessionFromRequest(req);
    if (refreshSession?.jti) {
      await dbRun(
        'UPDATE user_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE jti = ? AND user_id = ?',
        [refreshSession.jti, refreshSession.sub]
      );
    }

    auditLog(req, 'AUTH_LOGOUT', 'user', req.auth?.userId ? String(req.auth.userId) : null, 'success');

    res.setHeader('Set-Cookie', [
      buildClearAccessCookie(),
      buildClearRefreshCookie()
    ]);
    return sendSuccess(res, {
        enabled: true,
        authenticated: false,
        username: null,
        role: null
    });
  } catch (error) {
    logError('logout', error);
    return sendError(res, 500, 'LOGOUT_ERROR', 'Terjadi kesalahan saat logout.');
  }
};

export const refreshToken = async (req, res) => {
  try {
    const session = getRefreshSessionFromRequest(req);
    if (!session) {
      return sendError(res, 401, 'REFRESH_TOKEN_EXPIRED', 'Sesi refresh token tidak valid atau kadaluarsa.');
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ? AND is_active = 1', [session.sub]);
    if (!user) {
      res.setHeader('Set-Cookie', [
        buildClearAccessCookie(),
        buildClearRefreshCookie()
      ]);
      return sendError(res, 401, 'USER_INACTIVE', 'Pengguna sudah tidak aktif.');
    }

    if (Number(user.token_version || 0) !== Number(session.ver || 0)) {
      res.setHeader('Set-Cookie', [
        buildClearAccessCookie(),
        buildClearRefreshCookie()
      ]);
      return sendError(res, 401, 'REFRESH_TOKEN_REVOKED', 'Sesi refresh token sudah tidak berlaku.');
    }

    const tokenHash = hashToken(getCookieValue(req, 'wa_bot_refresh'));
    const storedToken = await dbGet(
      `SELECT jti FROM user_refresh_tokens
       WHERE jti = ? AND user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [session.jti, session.sub, tokenHash]
    );
    if (!storedToken) {
      res.setHeader('Set-Cookie', [
        buildClearAccessCookie(),
        buildClearRefreshCookie()
      ]);
      return sendError(res, 401, 'REFRESH_TOKEN_REVOKED', 'Sesi refresh token tidak valid atau sudah dicabut.');
    }

    const accessToken = signAccessToken(user);
    const nextRefreshToken = signRefreshToken(user);
    const nextRefreshSession = getRefreshSessionFromRequest({
      headers: { cookie: `wa_bot_refresh=${encodeURIComponent(nextRefreshToken)}` }
    });

    await dbRun(
      'UPDATE user_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE jti = ? AND user_id = ?',
      [session.jti, session.sub]
    );
    await dbRun(
      `INSERT INTO user_refresh_tokens (jti, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime(?, 'unixepoch'))`,
      [nextRefreshSession.jti, user.id, hashToken(nextRefreshToken), Math.floor(nextRefreshSession.exp / 1000)]
    );

    res.setHeader('Set-Cookie', [
      buildAccessCookie(accessToken),
      buildRefreshCookie(nextRefreshToken)
    ]);

    auditLog(req, 'AUTH_REFRESH', 'user', String(user.id), 'success');
    
    return sendSuccess(res, {
      refreshed: true,
      userId: user.id,
      username: user.username,
      role: user.role,
      subscriptionExpiresAt: user.subscription_expires_at
    });
  } catch (error) {
    logError('refreshToken', error);
    return sendError(res, 500, 'REFRESH_TOKEN_ERROR', 'Gagal memproses refresh token.');
  }
};
