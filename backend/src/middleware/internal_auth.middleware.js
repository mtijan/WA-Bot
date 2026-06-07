import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { sendError } from '../utils/http_response.js';

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export const requireInternalToken = (req, res, next) => {
  const expected = config.internal.token;

  if (!expected) {
    return sendError(res, 503, 'INTERNAL_TOKEN_NOT_CONFIGURED', 'WA_BOT_INTERNAL_TOKEN belum dikonfigurasi untuk internal control API.');
  }

  const headerValue = req.get('X-Internal-Token') || '';
  if (!secretsMatch(headerValue, expected)) {
    return sendError(res, 401, 'INVALID_INTERNAL_TOKEN', 'Token internal tidak valid.');
  }

  return next();
};
