import { config } from '../config.js';

const normalizeBaseUrl = (value) => {
  return value ? value.replace(/\/+$/, '') : '';
};

const getBaseUrl = () => normalizeBaseUrl(config.internal.sessionManagerUrl);
const getToken = () => config.internal.token;

export const isSessionManagerClientEnabled = () => {
  return Boolean(getBaseUrl());
};

const request = async (path, options = {}) => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new Error('WA_BOT_SESSION_MANAGER_URL belum dikonfigurasi.');
  }

  const headers = {
    ...(options.headers || {})
  };

  if (getToken()) {
    headers['X-Internal-Token'] = getToken();
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || `Session manager merespons ${response.status}`);
  }

  return payload;
};

export const sessionManagerClient = {
  async listSessions() {
    return request('/sessions');
  },

  async getSession(sessionId) {
    return request(`/sessions/${encodeURIComponent(sessionId)}`);
  },

  async initSession(sessionId) {
    return request(`/sessions/${encodeURIComponent(sessionId)}/init`, { method: 'POST' });
  },

  async deleteSession(sessionId) {
    return request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  },

  async updateSessionProxy(sessionId, proxyId) {
    return request(`/sessions/${encodeURIComponent(sessionId)}/proxy`, {
      method: 'PATCH',
      body: { proxy_id: proxyId || null }
    });
  }
};
