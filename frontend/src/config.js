const localApiUrl = `${window.location.protocol}//${window.location.hostname}:3001/api`;

export const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? localApiUrl : '/api')).replace(/\/$/, '');

export function shouldAttachApiCredentials(input) {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (url.startsWith('/api')) return true;
  if (url.startsWith(API_URL)) return true;
  if (url.startsWith(localApiUrl)) return true;
  if (url.startsWith('http://localhost:3001/api')) return true;

  return false;
}
