import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { evaluateDeploymentHealth } from '../scripts/deploy_smoke_test.js';
import { parseReleaseId } from '../src/config.js';

const RELEASE_SHA = '68621d4a42331ee7707102afd2ad96774c269d8d';
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('RAG-1011/RAG-1012 deployment release evidence', () => {
  it('menerima identifier immutable aman dan menolak nilai berbahaya', () => {
    assert.equal(parseReleaseId(RELEASE_SHA), RELEASE_SHA);
    assert.equal(parseReleaseId('release-2026.09.16'), 'release-2026.09.16');
    assert.equal(parseReleaseId('sha with spaces'), 'unknown');
    assert.equal(parseReleaseId('<script>'), 'unknown');
  });

  it('menerima readiness hanya ketika status dan release ID sama persis', () => {
    const result = evaluateDeploymentHealth({
      responseOk: true,
      statusCode: 200,
      payload: { status: 'ready', release_id: RELEASE_SHA },
      expectedStatus: 'ready',
      expectedReleaseId: RELEASE_SHA
    });

    assert.equal(result.ready, true);
    assert.deepEqual(result.blockers, []);
  });

  it('menolak HTTP sukses yang melaporkan runtime belum ready', () => {
    const result = evaluateDeploymentHealth({
      responseOk: true,
      statusCode: 200,
      payload: { status: 'not_ready', release_id: RELEASE_SHA },
      expectedStatus: 'ready',
      expectedReleaseId: RELEASE_SHA
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes('runtime_status'));
  });

  it('menolak smoke tanpa expected release ID', () => {
    const result = evaluateDeploymentHealth({
      responseOk: true,
      statusCode: 200,
      payload: { status: 'healthy', release_id: RELEASE_SHA },
      expectedStatus: 'healthy'
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes('expected_release_id_missing'));
  });

  it('menolak endpoint lama yang belum mengekspos release ID', () => {
    const result = evaluateDeploymentHealth({
      responseOk: true,
      statusCode: 200,
      payload: { status: 'healthy' },
      expectedStatus: 'healthy',
      expectedReleaseId: RELEASE_SHA
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes('actual_release_id_missing'));
  });

  it('menolak release ID yang berbeda dari SHA yang direview', () => {
    const result = evaluateDeploymentHealth({
      responseOk: true,
      statusCode: 200,
      payload: { status: 'ready', release_id: 'old-release' },
      expectedStatus: 'ready',
      expectedReleaseId: RELEASE_SHA
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes('release_id_mismatch'));
  });

  it('menjalankan smoke end-to-end ketika seluruh endpoint memakai release yang sama', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/') {
        response.setHeader('content-type', 'text/html');
        response.end('<!DOCTYPE html><html><body>staging fixture</body></html>');
        return;
      }
      if (request.url === '/health') {
        response.end(JSON.stringify({ status: 'healthy', release_id: RELEASE_SHA }));
        return;
      }
      if (request.url === '/health/ready' || request.url === '/internal/health/ready') {
        response.end(JSON.stringify({
          status: 'ready',
          release_id: RELEASE_SHA,
          role: request.url.startsWith('/internal') ? 'worker' : 'api',
          checks: { database: 'ok' },
          metrics: {}
        }));
        return;
      }
      if (request.url === '/internal/health/live') {
        response.end(JSON.stringify({ status: 'alive' }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ status: 'not_found' }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const child = spawn(process.execPath, ['scripts/deploy_smoke_test.js'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        WA_BOT_FRONTEND_URL: baseUrl,
        WA_BOT_API_URL: `${baseUrl}/api`,
        WA_BOT_INTERNAL_URL: `${baseUrl}/internal`,
        WA_BOT_EXPECTED_RELEASE_ID: RELEASE_SHA,
        WA_BOT_INTERNAL_TOKEN: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [exitCode] = await once(child, 'close');
    await closeServer(server);

    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
    assert.match(stdout, /SMOKE TEST DEPLOY BERHASIL/);
  });
});
