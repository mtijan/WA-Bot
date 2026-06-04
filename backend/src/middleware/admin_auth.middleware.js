import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { sendError } from '../utils/http_response.js';

const COOKIE_NAME = 'wa_bot_admin';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
  return config.admin.sessionSecret;
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

export function isAdminAuthEnabled() {
  return Boolean(config.admin.password);
}

export function getAdminUsername() {
  return config.admin.username;
}

export function createAdminSessionToken(username = getAdminUsername()) {
  const now = Date.now();
  const ttlMs = config.admin.sessionTtlMs;
  const payload = base64UrlEncode(JSON.stringify({
    sub: username,
    iat: now,
    exp: now + ttlMs,
    nonce: randomBytes(16).toString('hex')
  }));

  return `${payload}.${signPayload(payload)}`;
}

export function verifyAdminSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expectedSignature = signPayload(payload);

  if (!secretsMatch(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function buildAdminCookie(token) {
  const ttlMs = config.admin.sessionTtlMs;
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
}

export function buildClearAdminCookie() {
  const secure = config.admin.cookieSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function getAdminSession(req) {
  return verifyAdminSessionToken(getCookie(req, COOKIE_NAME));
}

export function validateAdminCredentials(username, password) {
  return secretsMatch(username, getAdminUsername()) && secretsMatch(password, config.admin.password);
}

export function createAdminAuthMiddleware() {
  return (req, res, next) => {
    const apiKey = config.apiKey;
    if (apiKey && secretsMatch(req.get('X-API-Key'), apiKey)) {
      req.auth = { type: 'api-key' };
      return next();
    }

    if (!isAdminAuthEnabled()) {
      if (!apiKey) return next();

      return sendError(res, 401, 'API_KEY_REQUIRED', 'API key diperlukan untuk mengakses API.');
    }

    const session = getAdminSession(req);
    if (!session) {
      return sendError(res, 401, 'ADMIN_AUTH_REQUIRED', 'Login admin diperlukan untuk mengakses API.');
    }

    req.auth = { type: 'admin-session', username: session.sub };
    return next();
  };
}
