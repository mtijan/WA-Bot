import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbRun, dbAll } from '../src/database.js';
import { getFlowsKnowledgeBase } from '../src/services/chatbot_ai.service.js';

after(() => cleanupTestDb());

describe('GET /api/chatbot-flows', () => {
  it('mengembalikan array kosong dengan envelope success', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/chatbot-flows');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
  });
});

describe('POST /api/chatbot-flows - Validasi & Pembuatan', () => {
  it('mengembalikan HTTP 400 jika data tidak valid', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/chatbot-flows')
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  });

  it('berhasil membuat alur chatbot baru', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/chatbot-flows')
      .send({
        flow_name: 'Alur Test Utama',
        keywords: 'halo,hai',
        session_ids: ['session-utama'],
        target_type: 'ALL',
        match_type: 'CONTAINS',
        case_sensitive: false,
        nodes: []
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.data.id);
  });
});

describe('Chatbot Session Leak Protection', () => {
  it('memastikan getFlowsKnowledgeBase memfilter session_ids secara presisi dan tidak bocor', async () => {
    // Bersihkan data lama jika ada
    await dbRun("DELETE FROM chatbot_flows");

    // Insert satu flow yang aktif untuk session 'session-12' (mengandung substring 'session-1')
    await dbRun(
      `INSERT INTO chatbot_flows (flow_name, keywords, session_ids, status, nodes) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        'Flow Sesi 12',
        'test',
        JSON.stringify(['session-12']),
        'ACTIVE',
        JSON.stringify([{ message_content: 'Ini adalah respon dari sesi 12' }])
      ]
    );

    // Panggil getFlowsKnowledgeBase untuk session-1
    // Sebelumnya, query LIKE '%session-1%' akan mencocokkan 'session-12', 
    // sehingga menghasilkan response basis pengetahuan.
    // Sekarang, pencocokan harus menghasilkan string kosong karena session_ids ['session-12'] tidak mengandung 'session-1'.
    const kbForSess1 = await getFlowsKnowledgeBase('session-1');
    assert.equal(kbForSess1, '', 'Seharusnya tidak mengembalikan info flow dari sesi 12 untuk sesi 1');

    // Panggil getFlowsKnowledgeBase untuk session-12
    // Seharusnya berhasil mengambil basis pengetahuan dari flow sesi 12.
    const kbForSess12 = await getFlowsKnowledgeBase('session-12');
    assert.ok(kbForSess12.includes('Ini adalah respon dari sesi 12'), 'Seharusnya mengembalikan info flow untuk sesi 12');
  });
});
