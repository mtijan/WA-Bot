let localApiUrl = '/api';
const devPort = '3001';

if (import.meta.env.DEV) {
  localApiUrl = `${window.location.protocol}//${window.location.hostname}:${devPort}/api`;
}

export const API_URL = (import.meta.env.VITE_API_URL || localApiUrl).replace(/\/$/, '');

export function shouldAttachApiCredentials(input) {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (url.startsWith('/api')) return true;
  if (url.startsWith(API_URL)) return true;

  if (import.meta.env.DEV) {
    if (url.startsWith(localApiUrl)) return true;
    if (url.startsWith(`http://localhost:${devPort}/api`)) return true;
  }

  return false;
}
