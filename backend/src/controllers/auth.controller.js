import {
  buildAdminCookie,
  buildClearAdminCookie,
  createAdminSessionToken,
  getAdminSession,
  getAdminUsername,
  isAdminAuthEnabled,
  validateAdminCredentials
} from '../middleware/admin_auth.middleware.js';
import { sendError, sendSuccess } from '../utils/http_response.js';

export const getAuthStatus = (req, res) => {
  const session = getAdminSession(req);

  return sendSuccess(res, {
      enabled: isAdminAuthEnabled(),
      authenticated: !isAdminAuthEnabled() || Boolean(session),
      username: session?.sub || null
  });
};

export const login = (req, res) => {
  if (!isAdminAuthEnabled()) {
    return sendSuccess(res, {
        enabled: false,
        authenticated: true,
        username: null
    });
  }

  const { username = '', password = '' } = req.body || {};
  if (!validateAdminCredentials(String(username), String(password))) {
    return sendError(res, 401, 'INVALID_ADMIN_CREDENTIALS', 'Username atau password admin tidak valid.');
  }

  const token = createAdminSessionToken(getAdminUsername());
  res.setHeader('Set-Cookie', buildAdminCookie(token));
  return sendSuccess(res, {
      enabled: true,
      authenticated: true,
      username: getAdminUsername()
  });
};

export const logout = (req, res) => {
  res.setHeader('Set-Cookie', buildClearAdminCookie());
  return sendSuccess(res, {
      enabled: isAdminAuthEnabled(),
      authenticated: false,
      username: null
  });
};
