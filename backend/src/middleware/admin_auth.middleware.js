import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { dbGet } from '../database.js';
import { sendError } from '../utils/http_response.js';

const ACCESS_COOKIE_NAME = 'wa_bot_access';
const REFRESH_COOKIE_NAME = 'wa_bot_refresh';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
  return process.env.WA_BOT_ADMIN_SESSION_SECRET
    || process.env.WA_BOT_SECRET_ENCRYPTION_KEY
    || process.env.WA_BOT_ADMIN_PASSWORD
    || process.env.WA_BOT_API_KEY
    || config.admin.sessionSecret;
}

function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return '';

  return header
    .split(';')
    .map(item => item.trim())
    .reduce((found, item) => {
      if (found) return found;
      const separatorIndex = item.indexOf('=');
      if (separatorIndex === -1) return '';
      const key = decodeURIComponent(item.slice(0, separatorIndex));
      const value = decodeURIComponent(item.slice(separatorIndex + 1));
      return key === name ? value : '';
    }, '');
}

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function signPayload(payload) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function isAdminAuthEnabled(forceEnabled = false) {
  if (forceEnabled) {
    return true;
  }
  if (process.env.NODE_ENV === 'test' && !process.env.WA_BOT_ADMIN_PASSWORD) {
    return false;
  }
  return true;
}

export function signAccessToken(user) {
  const now = Date.now();
  const ttlMs = 15 * 60 * 1000; // 15 minutes
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    ver: user.token_version || 0,
    type: 'access',
    iat: now,
    exp: now + ttlMs,
    nonce: randomBytes(16).toString('hex')
  }));
  return `${payload}.${signPayload(payload)}`;
}

export function signRefreshToken(user) {
  const now = Date.now();
  const ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const jti = randomBytes(24).toString('hex');
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    ver: user.token_version || 0,
    jti,
    type: 'refresh',
    iat: now,
    exp: now + ttlMs,
    nonce: randomBytes(16).toString('hex')
  }));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyToken(token, expectedType) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expectedSignature = signPayload(payload);

  if (!secretsMatch(signature, expectedSignature)) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    if (expectedType && data.type !== expectedType) return null;
    return data;
  } catch {
    return null;
  }
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function buildAccessCookie(token) {
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${ACCESS_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`;
}

export function buildRefreshCookie(token) {
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=604800${secure}`;
}

export function buildClearAccessCookie() {
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${ACCESS_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function buildClearRefreshCookie() {
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0${secure}`;
}

export function getSessionFromRequest(req) {
  return verifyToken(getCookie(req, ACCESS_COOKIE_NAME), 'access');
}

export function getRefreshSessionFromRequest(req) {
  return verifyToken(getCookie(req, REFRESH_COOKIE_NAME), 'refresh');
}

export function createAdminAuthMiddleware(options = {}) {
  return async (req, res, next) => {
    const apiKey = process.env.WA_BOT_API_KEY || config.apiKey;
    if (apiKey && secretsMatch(req.get('X-API-Key'), apiKey)) {
      req.auth = { type: 'api-key', userId: 1, username: 'api-key', role: 'admin' };
      return next();
    }

    if (!isAdminAuthEnabled(options.enabled === true)) {
      req.auth = { type: 'session', userId: 1, username: 'admin', role: 'admin' };
      return next();
    }

    const session = getSessionFromRequest(req);
    if (!session) {
      return sendError(res, 401, 'AUTH_REQUIRED', 'Login diperlukan untuk mengakses API.');
    }

    try {
      const user = await dbGet(
        'SELECT id, username, role, is_active, token_version FROM users WHERE id = ?',
        [session.sub]
      );
      if (!user || Number(user.is_active) !== 1) {
        return sendError(res, 401, 'AUTH_REQUIRED', 'Login diperlukan untuk mengakses API.');
      }
      if (Number(user.token_version || 0) !== Number(session.ver || 0)) {
        return sendError(res, 401, 'AUTH_REQUIRED', 'Sesi sudah tidak berlaku. Silakan login ulang.');
      }

      req.auth = {
        type: 'session',
        userId: user.id,
        username: user.username,
        role: user.role
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.auth && req.auth.type === 'api-key') {
      return next();
    }

    if (!req.auth || !roles.includes(req.auth.role)) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki hak akses untuk operasi ini.');
    }

    return next();
  };
}
