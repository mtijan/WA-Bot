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

export function createCorsOptions() {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const error = new Error(`Origin tidak diizinkan oleh kebijakan CORS: ${origin}`);
      error.statusCode = 403;
      return callback(error);
    }
  };
}

export function createSecurityHeaders() {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `frame-ancestors ${config.security.frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '));

    if (config.admin.cookieSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    return next();
  };
}

export function createApiKeyAuth() {
  return (req, res, next) => {
    const configuredKey = process.env.WA_BOT_API_KEY || config.apiKey;
    if (!configuredKey) return next();

    const suppliedKey = req.get('X-API-Key');
    if (!secretsMatch(suppliedKey, configuredKey)) {
      return sendError(res, 401, 'UNAUTHORIZED', 'API key tidak valid atau tidak disertakan.');
    }

    return next();
  };
}

export function createRateLimiter() {
  const requestBuckets = new Map();

  // Pembersihan berkala setiap 5 menit untuk mencegah memory leak dari IP yang tidak aktif
  const gcInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of requestBuckets.entries()) {
      if (bucket.resetAt <= now) {
        requestBuckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Hindari menahan proses Node.js keluar jika server dihentikan
  if (gcInterval && typeof gcInterval.unref === 'function') {
    gcInterval.unref();
  }

  return (req, res, next) => {
    const windowMs = Number.parseInt(process.env.WA_BOT_RATE_LIMIT_WINDOW_MS) || config.security.rateLimitWindowMs;
    const maxRequests = Number.parseInt(process.env.WA_BOT_RATE_LIMIT_MAX) || config.security.rateLimitMax;
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = requestBuckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    bucket.count += 1;
    requestBuckets.set(key, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    res.set('RateLimit-Limit', String(maxRequests));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Terlalu banyak permintaan. Silakan coba kembali setelah jeda singkat.');
    }

    return next();
  };
}
