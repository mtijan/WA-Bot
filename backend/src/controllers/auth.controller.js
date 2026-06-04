import {
  buildAdminCookie,
  buildClearAdminCookie,
  createAdminSessionToken,
  getAdminSession,
  getAdminUsername,
  isAdminAuthEnabled,
  validateAdminCredentials
} from '../middleware/admin_auth.middleware.js';

export const getAuthStatus = (req, res) => {
  const session = getAdminSession(req);

  res.json({
    status: 'success',
    data: {
      enabled: isAdminAuthEnabled(),
      authenticated: !isAdminAuthEnabled() || Boolean(session),
      username: session?.sub || null
    }
  });
};

export const login = (req, res) => {
  if (!isAdminAuthEnabled()) {
    return res.json({
      status: 'success',
      data: {
        enabled: false,
        authenticated: true,
        username: null
      }
    });
  }

  const { username = '', password = '' } = req.body || {};
  if (!validateAdminCredentials(String(username), String(password))) {
    return res.status(401).json({
      status: 'error',
      error_code: 'INVALID_ADMIN_CREDENTIALS',
      message: 'Username atau password admin tidak valid.'
    });
  }

  const token = createAdminSessionToken(getAdminUsername());
  res.setHeader('Set-Cookie', buildAdminCookie(token));
  return res.json({
    status: 'success',
    data: {
      enabled: true,
      authenticated: true,
      username: getAdminUsername()
    }
  });
};

export const logout = (req, res) => {
  res.setHeader('Set-Cookie', buildClearAdminCookie());
  res.json({
    status: 'success',
    data: {
      enabled: isAdminAuthEnabled(),
      authenticated: false,
      username: null
    }
  });
};
