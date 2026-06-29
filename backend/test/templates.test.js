import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('GET /api/templates', () => {
  it('mengembalikan array kosong dengan envelope success', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/templates');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
  });
});

describe('POST /api/templates - Validasi', () => {
  it('mengembalikan HTTP 400 VALIDATION_ERROR tanpa body', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details);
    assert.ok(res.body.details.name, 'Harus ada error untuk field name');
    assert.ok(res.body.details.content, 'Harus ada error untuk field content');
  });

  it('mengembalikan HTTP 400 jika name kosong', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ name: '', content: 'Isi template' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details.name);
  });

  it('mengembalikan HTTP 400 jika type bukan allowedValues', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ name: 'Test', content: 'Isi', type: 'invalid-type' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details.type);
  });
});

describe('POST /api/templates - Sukses', () => {
  it('mengembalikan HTTP 201 dengan data template baru', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ name: 'Template Pengujian', content: 'Halo {{nama}}, salam dari WA-Bot.' });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.data);
    assert.ok(res.body.data.id);
    assert.equal(res.body.data.name, 'Template Pengujian');
    assert.equal(res.body.data.content, 'Halo {{nama}}, salam dari WA-Bot.');
  });

  it('mengembalikan HTTP 201 saat membuat template tipe document', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ 
        name: 'Template Dokumen', 
        content: 'Berikut dokumen Anda.', 
        type: 'document',
        attachment_url: '/api/uploads/media/test.pdf',
        attachment_name: 'test.pdf'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.type, 'document');
    assert.equal(res.body.data.attachment_url, '/api/uploads/media/test.pdf');
  });

  it('mengembalikan HTTP 201 saat membuat template tipe audio', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ 
        name: 'Template Audio', 
        content: 'Dengarkan ini.', 
        type: 'audio',
        attachment_url: '/api/uploads/media/test.mp3'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.type, 'audio');
    assert.equal(res.body.data.attachment_url, '/api/uploads/media/test.mp3');
  });

  it('mengembalikan HTTP 201 saat membuat template tipe poll dengan opsi baru baris', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/templates')
      .send({ 
        name: 'Template Polling', 
        content: 'Silakan pilih:', 
        type: 'poll',
        poll_question: 'Bagaimana pelayanan kami?',
        poll_options: 'Sangat Baik\nCukup\nKurang'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.type, 'poll');
    assert.equal(res.body.data.poll_options, 'Sangat Baik\nCukup\nKurang');
  });

  it('template baru muncul di GET /api/templates', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/templates');

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1, 'Harus ada minimal 1 template');

    const found = res.body.data.find(t => t.name === 'Template Pengujian');
    assert.ok(found, 'Template yang dibuat harus ada di daftar');
  });
});

describe('DELETE /api/templates/:id', () => {
  it('mengembalikan HTTP 404 untuk ID tidak ada', async () => {
    const agent = await getTestAgent();
    const res = await agent.delete('/api/templates/99999');

    assert.equal(res.status, 404);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error_code, 'TEMPLATE_NOT_FOUND');
  });

  it('menghapus template yang ada dan mengembalikan HTTP 200', async () => {
    const agent = await getTestAgent();

    // Buat template dulu
    const createRes = await agent
      .post('/api/templates')
      .send({ name: 'Akan Dihapus', content: 'Konten sementara' });
    const templateId = createRes.body.data.id;

    // Hapus
    const deleteRes = await agent.delete(`/api/templates/${templateId}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.status, 'success');

    // Verifikasi sudah tidak ada
    const listRes = await agent.get('/api/templates');
    const found = listRes.body.data.find(t => t.id === templateId);
    assert.equal(found, undefined, 'Template harus sudah dihapus');
  });
});
