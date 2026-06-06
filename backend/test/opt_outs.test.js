import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('GET /api/opt-outs', () => {
  it('mengembalikan array kosong dengan envelope success', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/opt-outs');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
  });
});

describe('POST /api/opt-outs - Validasi', () => {
  it('mengembalikan HTTP 400 VALIDATION_ERROR tanpa phone_number', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/opt-outs')
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details);
    assert.ok(res.body.details.phone_number);
  });

  it('mengembalikan HTTP 400 jika phone_number terlalu pendek', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/opt-outs')
      .send({ phone_number: '123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details.phone_number);
  });

  it('mengembalikan HTTP 400 jika phone_number terlalu panjang', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/opt-outs')
      .send({ phone_number: '1'.repeat(21) });

    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.ok(res.body.details.phone_number);
  });
});

describe('POST /api/opt-outs - Sukses', () => {
  it('mengembalikan HTTP 201 dengan data opt-out baru', async () => {
    const agent = await getTestAgent();
    const res = await agent
      .post('/api/opt-outs')
      .send({ phone_number: '628123456789' });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
  });

  it('opt-out baru muncul di GET /api/opt-outs', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/api/opt-outs');

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1, 'Harus ada minimal 1 opt-out');
  });
});

describe('DELETE /api/opt-outs/:phoneNumber', () => {
  it('menghapus opt-out yang ada dan mengembalikan HTTP 200', async () => {
    const agent = await getTestAgent();

    // Buat opt-out dulu
    await agent
      .post('/api/opt-outs')
      .send({ phone_number: '628987654321' });

    // Hapus
    const deleteRes = await agent.delete('/api/opt-outs/628987654321');
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.status, 'success');
  });
});
