import { config } from '../config.js';
import { sendError } from '../utils/http_response.js';

export const requireInternalToken = (req, res, next) => {
  const expected = config.internal.token;

  if (!expected) {
    return sendError(res, 503, 'INTERNAL_TOKEN_NOT_CONFIGURED', 'WA_BOT_INTERNAL_TOKEN belum dikonfigurasi untuk internal control API.');
  }

  const headerValue = req.get('X-Internal-Token') || '';
  if (headerValue !== expected) {
    return sendError(res, 401, 'INVALID_INTERNAL_TOKEN', 'Token internal tidak valid.');
  }

  return next();
};
