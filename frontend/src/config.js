const getLocalApiUrl = () => `${window.location.protocol}//${window.location.hostname}:3001/api`;

export const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? getLocalApiUrl() : '/api')).replace(/\/$/, '');

export function shouldAttachApiCredentials(input) {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (url.startsWith('/api')) return true;
  if (url.startsWith(API_URL)) return true;
  if (import.meta.env.DEV && url.startsWith(getLocalApiUrl())) return true;
  if (import.meta.env.DEV && url.startsWith('http://localhost:3001/api')) return true;

  return false;
}
