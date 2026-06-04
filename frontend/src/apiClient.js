import { API_URL } from './config';

export class ApiError extends Error {
  constructor(message, response, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = response?.status;
    this.payload = payload;
  }
}

export async function apiRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok || payload?.status === 'error') {
    throw new ApiError(payload?.message || 'Request API gagal.', response, payload);
  }

  return payload;
}
