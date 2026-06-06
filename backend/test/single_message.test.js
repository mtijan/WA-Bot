import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';
import whatsappService from '../src/services/whatsapp.service.js';

after(() => cleanupTestDb());

describe('POST /api/single-message/send - Validasi', () => {
  it('mengembalikan HTTP 400 jika parameter tidak lengkap', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/single-message/send')
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  });
});

describe('Internal Router - /internal/single-message/send', () => {
  it('berhasil memproses data flat payload ke whatsappService', async () => {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;
    const internalRoutes = (await import('../src/routes/internal.routes.js')).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/internal', internalRoutes);
    const agent = supertest(testApp);
    
    // Mock sockets dan method sendSingleMessage pada whatsappService
    const originalSockets = whatsappService.sockets;
    const originalSendSingleMessage = whatsappService.sendSingleMessage;
    
    let capturedPayload = null;
    let capturedSessionId = null;
    let capturedTarget = null;

    whatsappService.sockets = {
      'test-session-id': {}
    };
    
    whatsappService.sendSingleMessage = async (sessionId, target, payload) => {
      capturedSessionId = sessionId;
      capturedTarget = target;
      capturedPayload = payload;
    };

    try {
      const res = await agent
        .post('/internal/single-message/send')
        .set('X-Internal-Token', process.env.WA_BOT_INTERNAL_TOKEN || 'testing-internal-token-secret-placeholder')
        .send({
          sessionId: 'test-session-id',
          target: '628123456789',
          messageType: 'text',
          text: 'Halo dari test suite',
          attachmentUrl: 'http://example.com/image.jpg',
          attachmentType: 'Image'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      
      // Pastikan data flat dari req.body terdestruktur secara tepat ke parameter payload di whatsappService.sendSingleMessage
      assert.equal(capturedSessionId, 'test-session-id');
      assert.equal(capturedTarget, '628123456789');
      assert.ok(capturedPayload, 'Payload tidak boleh kosong');
      assert.equal(capturedPayload.messageType, 'text');
      assert.equal(capturedPayload.text, 'Halo dari test suite');
      assert.equal(capturedPayload.attachmentUrl, 'http://example.com/image.jpg');
      assert.equal(capturedPayload.attachmentType, 'Image');
    } finally {
      // Kembalikan ke original state
      whatsappService.sockets = originalSockets;
      whatsappService.sendSingleMessage = originalSendSingleMessage;
    }
  });
});
