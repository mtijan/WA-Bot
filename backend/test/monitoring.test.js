import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbRun, dbGet } from '../src/database.js';

after(() => cleanupTestDb());

describe('Monitoring & Logs Endpoints', () => {
  beforeEach(async () => {
    // Bersihkan tabel-tabel terkait
    await dbRun('DELETE FROM session_repair_logs');
    await dbRun('DELETE FROM chatbot_failed_replies');
    await dbRun('DELETE FROM sessions');
  });

  describe('GET /api/monitoring/status', () => {
    it('mengembalikan status real-time sistem dengan benar', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();
      
      // Masukkan satu sesi dummy untuk dihitung
      await dbRun("INSERT INTO sessions (session_id, status) VALUES ('test-session', 'CONNECTED')");

      const res = await agent
        .get('/api/monitoring/status')
        .set('Cookie', cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data);
      assert.ok(res.body.data.timestamp);
      assert.equal(res.body.data.sessions.total, 1);
      assert.equal(res.body.data.sessions.connected, 1);
      assert.ok(res.body.data.memory);
      assert.ok(res.body.data.database);
    });
  });

  describe('GET /api/monitoring/repair-logs', () => {
    it('mengembalikan log perbaikan sesi', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();

      // Masukkan sesi dan repair log
      await dbRun("INSERT INTO sessions (session_id, status) VALUES ('test-session', 'DISCONNECTED')");
      await dbRun(`
        INSERT INTO session_repair_logs (session_id, status, error_message, downtime_seconds, trigger_type)
        VALUES ('test-session', 'SUCCESS', null, 120, 'AUTO')
      `);

      const res = await agent
        .get('/api/monitoring/repair-logs')
        .set('Cookie', cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(Array.isArray(res.body.data));
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].session_id, 'test-session');
      assert.equal(res.body.data[0].status, 'SUCCESS');
      assert.equal(res.body.data[0].downtime_seconds, 120);
      assert.equal(res.body.data[0].trigger_type, 'AUTO');
    });
  });

  describe('GET /api/monitoring/failed-replies', () => {
    it('mengembalikan daftar pesan chatbot/AI yang gagal terbalas', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();

      await dbRun("INSERT INTO sessions (session_id, status) VALUES ('test-session', 'CONNECTED')");
      await dbRun(`
        INSERT INTO chatbot_failed_replies (session_id, phone_number, message_content, triggered_keyword, error_message, status)
        VALUES ('test-session', '628123456789', 'halo bot', 'halo', 'OpenAI quota exceeded', 'UNRESOLVED')
      `);

      const res = await agent
        .get('/api/monitoring/failed-replies')
        .set('Cookie', cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(Array.isArray(res.body.data));
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].phone_number, '628123456789');
      assert.equal(res.body.data[0].triggered_keyword, 'halo');
      assert.equal(res.body.data[0].error_message, 'OpenAI quota exceeded');
      assert.equal(res.body.data[0].status, 'UNRESOLVED');
    });
  });

  describe('PATCH /api/monitoring/failed-replies/:id/status', () => {
    it('memperbarui status kegagalan pesan chatbot', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();

      await dbRun("INSERT INTO sessions (session_id, status) VALUES ('test-session', 'CONNECTED')");
      await dbRun(`
        INSERT INTO chatbot_failed_replies (id, session_id, phone_number, message_content, triggered_keyword, error_message, status)
        VALUES (101, 'test-session', '628123456789', 'halo bot', 'halo', 'Timeout', 'UNRESOLVED')
      `);

      const res = await agent
        .patch('/api/monitoring/failed-replies/101/status')
        .set('Cookie', cookie)
        .send({ status: 'RESOLVED' });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.status, 'RESOLVED');

      // Verifikasi di database
      const dbRow = await dbGet('SELECT status FROM chatbot_failed_replies WHERE id = 101');
      assert.equal(dbRow.status, 'RESOLVED');
    });

    it('mengembalikan error 400 untuk status tidak valid', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();

      const res = await agent
        .patch('/api/monitoring/failed-replies/101/status')
        .set('Cookie', cookie)
        .send({ status: 'INVALID_STATUS' });

      assert.equal(res.status, 400);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.error_code, 'INVALID_STATUS');
    });

    it('mengembalikan error 404 untuk ID tidak ditemukan', async () => {
      const { agent, cookie } = await getAuthenticatedAgent();

      const res = await agent
        .patch('/api/monitoring/failed-replies/99999/status')
        .set('Cookie', cookie)
        .send({ status: 'RESOLVED' });

      assert.equal(res.status, 404);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.error_code, 'NOT_FOUND');
    });
  });

  describe('Chatbot Flow Error Logging', () => {
    it('mencatat kegagalan chatbot flow ke tabel chatbot_failed_replies dengan incomingText', async () => {
      const { default: whatsappService } = await import('../src/services/whatsapp.service.js');

      // Masukkan sesi agar relasi database valid
      await dbRun("INSERT INTO sessions (session_id, status) VALUES ('test-session', 'CONNECTED')");

      const dummyFlow = {
        flow_name: 'Flow Test Error',
        nodes: JSON.stringify([
          {
            id: 1,
            message_content: 'Halo pelanggan',
            typing_indicator: true
          }
        ])
      };

      // Panggil executeFlowNodes dengan sock = null untuk memicu error
      await whatsappService.executeFlowNodes(null, '628999999@s.whatsapp.net', dummyFlow, 'test-session', 'pesan pemicu');

      // Ambil data dari tabel chatbot_failed_replies
      const dbRow = await dbGet("SELECT * FROM chatbot_failed_replies WHERE session_id = 'test-session'");
      assert.ok(dbRow);
      assert.equal(dbRow.phone_number, '628999999');
      assert.equal(dbRow.message_content, 'pesan pemicu');
      assert.equal(dbRow.triggered_keyword, 'Flow: Flow Test Error');
      assert.ok(dbRow.error_message.includes('Cannot read properties of null'));
    });
  });
});

