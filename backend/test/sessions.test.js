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

describe('Session Deletion Cascade', () => {
  it('berhasil menghapus sesi dan membersihkan/meng-null-kan referensi di tabel lain tanpa melanggar foreign key', async () => {
    const { dbRun, dbGet } = await import('../src/database.js');

    // 1. Setup Data Uji
    // Sesi utama
    await dbRun("INSERT INTO sessions (session_id, status, user_id) VALUES ('test-delete-session', 'DISCONNECTED', 1)");
    
    // Kampanye (yang mereferensikan sesi)
    const campaignResult = await dbRun(
      "INSERT INTO campaigns (session_id, message, status, user_id) VALUES ('test-delete-session', 'Pesan Uji', 'PENDING', 1)"
    );
    const campaignId = campaignResult.id;

    // Auto replies
    await dbRun("INSERT INTO auto_replies (session_id, keyword, type, content) VALUES ('test-delete-session', 'halo', 'text', 'hai')");

    // Chatbot flow (butuh record di chatbot_flows dulu karena foreign key di chatbot_flow_sessions)
    const flowResult = await dbRun(
      "INSERT INTO chatbot_flows (id, flow_name, keywords, session_ids, nodes, user_id) VALUES (9999, 'Flow Uji', 'keyword', '[\"test-delete-session\"]', '[]', 1)"
    );
    await dbRun("INSERT INTO chatbot_flow_sessions (flow_id, session_id, user_id) VALUES (9999, 'test-delete-session', 1)");

    // Chatbot AI settings
    await dbRun("INSERT INTO chatbot_ai_settings (session_id, is_active) VALUES ('test-delete-session', 0)");

    // Session repair logs
    await dbRun("INSERT INTO session_repair_logs (session_id, status) VALUES ('test-delete-session', 'FAILED')");

    // Chatbot failed replies
    await dbRun("INSERT INTO chatbot_failed_replies (session_id, phone_number, error_message) VALUES ('test-delete-session', '628123456789', 'Error')");

    // 2. Eksekusi Penghapusan Sesi
    await assert.doesNotReject(async () => {
      await whatsappService.deleteSession('test-delete-session');
    }, 'Penghapusan sesi harus berhasil tanpa throw error constraint');

    // 3. Verifikasi Hasil
    // Sesi harus terhapus
    const session = await dbGet("SELECT * FROM sessions WHERE session_id = 'test-delete-session'");
    assert.equal(session, undefined);

    // Kampanye harus tetap ada namun session_id diubah menjadi NULL (ON DELETE SET NULL manual)
    const campaign = await dbGet("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
    assert.ok(campaign);
    assert.equal(campaign.session_id, null);

    // Auto replies harus terhapus
    const autoReply = await dbGet("SELECT * FROM auto_replies WHERE session_id = 'test-delete-session'");
    assert.equal(autoReply, undefined);

    // Chatbot flow sessions harus terhapus
    const flowSession = await dbGet("SELECT * FROM chatbot_flow_sessions WHERE session_id = 'test-delete-session'");
    assert.equal(flowSession, undefined);

    // Chatbot AI settings harus terhapus
    const chatbotAiSettings = await dbGet("SELECT * FROM chatbot_ai_settings WHERE session_id = 'test-delete-session'");
    assert.equal(chatbotAiSettings, undefined);

    // Repair logs harus terhapus
    const repairLog = await dbGet("SELECT * FROM session_repair_logs WHERE session_id = 'test-delete-session'");
    assert.equal(repairLog, undefined);

    // Failed replies harus terhapus
    const failedReply = await dbGet("SELECT * FROM chatbot_failed_replies WHERE session_id = 'test-delete-session'");
    assert.equal(failedReply, undefined);

    // Cleanup chatbot flow dummy
    await dbRun("DELETE FROM chatbot_flows WHERE id = 9999");
  });
});

