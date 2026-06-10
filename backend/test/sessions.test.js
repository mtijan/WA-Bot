import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedAgent, cleanupTestDb } from './helpers/test_app.js';
import whatsappService from '../src/services/whatsapp.service.js';

after(() => cleanupTestDb());

describe('Session Reconnect Endpoints', () => {
  it('POST /api/sessions/:id/reconnect memanggil whatsappService.reconnectSession dan mengembalikan status sukses', async () => {
    const { agent, cookie } = await getAuthenticatedAgent();

    // Mock metode reconnectSession agar tidak mencoba menghubungkan Baileys secara nyata
    let calledSessionId = null;
    const originalReconnectSession = whatsappService.reconnectSession;
    whatsappService.reconnectSession = async (sessionId) => {
      calledSessionId = sessionId;
      return true;
    };

    try {
      const res = await agent
        .post('/api/sessions/test-session-id/reconnect')
        .set('Cookie', cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(calledSessionId, 'test-session-id');
    } finally {
      // Kembalikan ke fungsi asli
      whatsappService.reconnectSession = originalReconnectSession;
    }
  });

  it('POST /internal/sessions/:id/reconnect memanggil whatsappService.reconnectSession dan mengembalikan status sukses', async () => {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;
    const internalRoutes = (await import('../src/routes/internal.routes.js')).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/internal', internalRoutes);
    const agent = supertest(testApp);

    // Mock metode reconnectSession agar tidak mencoba menghubungkan Baileys secara nyata
    let calledSessionId = null;
    const originalReconnectSession = whatsappService.reconnectSession;
    whatsappService.reconnectSession = async (sessionId) => {
      calledSessionId = sessionId;
      return true;
    };

    try {
      const res = await agent
        .post('/internal/sessions/test-internal-session/reconnect')
        .set('X-Internal-Token', process.env.WA_BOT_INTERNAL_TOKEN || 'testing-internal-token-secret-placeholder');

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(calledSessionId, 'test-internal-session');
    } finally {
      // Kembalikan ke fungsi asli
      whatsappService.reconnectSession = originalReconnectSession;
    }
  });
});
