import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';

after(() => cleanupTestDb());

describe('GET /health', () => {
  it('mengembalikan status healthy', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/health');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.ok(res.body.timestamp);
  });
});

describe('GET /health/ready', () => {
  it('mengembalikan status readiness dengan envelope yang benar', async () => {
    const agent = await getTestAgent();
    const res = await agent.get('/health/ready');

    // Bisa 200 (ready) atau 503 (not ready) tergantung kondisi database
    assert.ok([200, 503].includes(res.status), `Expected 200 or 503, got ${res.status}`);
    assert.ok(res.body.status);
    assert.ok(res.body.role);
    assert.ok(res.body.checks);
    assert.ok(res.body.metrics !== undefined);
  });
});
