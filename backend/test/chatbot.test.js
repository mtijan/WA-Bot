import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbRun, dbAll, dbGet } from '../src/database.js';
import { getFlowsKnowledgeBase } from '../src/services/chatbot_ai.service.js';
import {
  parseFlowKeywords,
  extractIncomingMessageText,
  doesFlowMatchIncomingText
} from '../src/services/whatsapp.service.js';

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
    await dbRun("INSERT INTO sessions (session_id, status, user_id) VALUES ('session-utama', 'CONNECTED', 1)");
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

    const mapping = await dbGet(
      'SELECT flow_id, session_id FROM chatbot_flow_sessions WHERE flow_id = ? AND session_id = ?',
      [res.body.data.id, 'session-utama']
    );
    assert.ok(mapping, 'Mapping chatbot_flow_sessions harus dibuat saat flow baru disimpan');
  });
});

describe('Chatbot Session Leak Protection', () => {
  it('memastikan getFlowsKnowledgeBase memfilter session_ids secara presisi dan tidak bocor', async () => {
    // Bersihkan data lama jika ada
    await dbRun("DELETE FROM chatbot_flow_sessions");
    await dbRun("DELETE FROM chatbot_flows");

    // Insert satu flow yang aktif untuk session 'session-12' (mengandung substring 'session-1')
    const result = await dbRun(
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
    await dbRun(
      `INSERT INTO chatbot_flow_sessions (flow_id, session_id, user_id)
       VALUES (?, ?, ?)`,
      [result.id, 'session-12', 1]
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

describe('Chatbot Flow Matching Helpers', () => {
  it('memecah trigger keyword multi-line dan separator campuran dengan konsisten', () => {
    const keywords = parseFlowKeywords('halo,\n hai ; info pelanggan\r\npromo');

    assert.deepEqual(keywords, ['halo', 'hai', 'info pelanggan', 'promo']);
  });

  it('mencocokkan flow untuk pesan dengan whitespace berlebih dan keyword multi-line', () => {
    const flow = {
      keywords: 'halo admin\ncek pesanan',
      match_type: 'CONTAINS',
      case_sensitive: 0,
      target_type: 'ALL'
    };

    assert.equal(
      doesFlowMatchIncomingText(flow, '  Saya mau   cek   pesanan sekarang  ', { isGroup: false }),
      true
    );
  });

  it('mengambil selectedDisplayText dari tombol interaktif agar trigger tetap terbaca', () => {
    const text = extractIncomingMessageText('buttonsResponseMessage', {
      buttonsResponseMessage: {
        selectedButtonId: 'btn-order-status',
        selectedDisplayText: 'Cek Status Pesanan'
      }
    });

    assert.equal(text, 'Cek Status Pesanan');
  });

  it('mengambil display text dari interactiveResponseMessage jika tersedia', () => {
    const text = extractIncomingMessageText('interactiveResponseMessage', {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({
            id: 'btn-order-status',
            display_text: 'Cek Status Pesanan'
          })
        }
      }
    });

    assert.equal(text, 'Cek Status Pesanan');
  });
});
