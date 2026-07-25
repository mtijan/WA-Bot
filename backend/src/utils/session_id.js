import path from 'path';

export const SESSION_ID_MAX_LENGTH = 64;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function resolveSessionDirectory(rootDirectory, sessionId) {
  if (!isValidSessionId(sessionId)) {
    const error = new Error('ID sesi hanya boleh berisi huruf, angka, underscore, dan hyphen (maksimal 64 karakter).');
    error.code = 'INVALID_SESSION_ID';
    error.statusCode = 400;
    throw error;
  }

  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, sessionId);
  const relative = path.relative(root, target);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Path direktori sesi tidak valid.');
    error.code = 'INVALID_SESSION_PATH';
    error.statusCode = 400;
    throw error;
  }

  return target;
}
