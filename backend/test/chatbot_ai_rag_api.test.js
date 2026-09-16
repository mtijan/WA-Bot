import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { getTestAgent, getAuthenticatedAgent } from './helpers/test_app.js';
import { dbGet, dbRun, dbAll } from '../src/database.js';
import { storeCachedResponse, lookupCachedResponse } from '../src/services/chatbot_ai_rag_cache.service.js';
import { signAccessToken, buildAccessCookie } from '../src/middleware/admin_auth.middleware.js';

async function seedTestUser(username, role = 'user') {
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return existing.id;
  }
  const result = await dbRun(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, device_limit)
     VALUES (?, ?, ?, ?, 1, 10)`,
    [username, 'dummy_hash', username, role]
  );
  return result.id;
}

async function seedTestSession(sessionId, userId, status = 'CONNECTED') {
  const existing = await dbGet('SELECT session_id FROM sessions WHERE session_id = ?', [sessionId]);
  if (existing) {
    await dbRun('UPDATE sessions SET user_id = ?, status = ? WHERE session_id = ?', [userId, status, sessionId]);
    return;
  }
  await dbRun(
    'INSERT INTO sessions (session_id, status, user_id) VALUES (?, ?, ?)',
    [sessionId, status, userId]
  );
}

describe('Chatbot AI RAG API Endpoints (RAG-0801 - RAG-0805)', () => {
  let agent;
  let user1Id;
  let user2Id;
  let user1Cookie;
  let user2Cookie;

  before(async () => {
    agent = await getTestAgent();
    user1Id = await seedTestUser('rag_api_user_1', 'user');
    user2Id = await seedTestUser('rag_api_user_2', 'user');

    const token1 = signAccessToken({ id: user1Id, username: 'rag_api_user_1', role: 'user', token_version: 0 });
    user1Cookie = buildAccessCookie(token1);

    const token2 = signAccessToken({ id: user2Id, username: 'rag_api_user_2', role: 'user', token_version: 0 });
    user2Cookie = buildAccessCookie(token2);
  });

  describe('RAG-0801: Settings RAG & Invalidation', () => {
    const sessionId = 'session-rag-settings-0801';

    it('returns default RAG settings for a new session', async () => {
      await seedTestSession(sessionId, 1);

      const res = await agent.get(`/api/chatbot-ai/settings/${sessionId}`);
      assert.equal(res.status, 200);
      const data = res.body.data;

      assert.equal(data.rag_mode, 'off');
      assert.equal(data.rag_top_k, 4);
      assert.equal(data.rag_context_tokens, 1000);
      assert.equal(data.rag_input_budget_tokens, 2200);
      assert.equal(data.cache_enabled, 0);
      assert.equal(data.cache_ttl_seconds, 86400);
      assert.equal(data.direct_answer_enabled, 0);
      assert.equal(data.debounce_ms, 0);
      assert.equal(data.temperature, 0.3);
      assert.equal(data.max_output_tokens, 2048);
      assert.equal(data.config_revision, 1);
      assert.equal(data.prompt_version, 1);
    });

    it('auto-configures safe defaults and returns pre-flight when RAG is selected', async () => {
      const saveRes = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_mode: 'hybrid'
      });
      assert.equal(saveRes.status, 200);
      assert.equal(saveRes.body.data.rag_auto_configuration.activating, true);
      assert.equal(saveRes.body.data.rag_preflight.state, 'BLOCKED');
      assert.ok(saveRes.body.data.rag_preflight.blocking_codes.includes('SOURCE_AVAILABLE'));

      const getRes = await agent.get(`/api/chatbot-ai/settings/${sessionId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.rag_top_k, 4);
      assert.equal(getRes.body.data.rag_context_tokens, 1000);
      assert.equal(getRes.body.data.rag_input_budget_tokens, 2200);
      assert.equal(getRes.body.data.cache_enabled, 0);
      assert.equal(getRes.body.data.direct_answer_enabled, 1);
      assert.equal(getRes.body.data.debounce_ms, 3000);

      const statusRes = await agent.get(`/api/chatbot-ai/rag/${sessionId}/status`);
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.body.data.preflight.state, 'BLOCKED');
    });

    it('persists and updates full RAG settings within valid bounds', async () => {
      const payload = {
        session_id: sessionId,
        rag_mode: 'hybrid',
        rag_top_k: 5,
        rag_context_tokens: 1500,
        rag_input_budget_tokens: 3000,
        cache_enabled: true,
        cache_ttl_seconds: 7200,
        direct_answer_enabled: true,
        debounce_ms: 2500,
        temperature: 0.5,
        max_output_tokens: 1024
      };

      const saveRes = await agent.post('/api/chatbot-ai/settings').send(payload);
      assert.equal(saveRes.status, 200);

      const getRes = await agent.get(`/api/chatbot-ai/settings/${sessionId}`);
      assert.equal(getRes.status, 200);
      const data = getRes.body.data;

      assert.equal(data.rag_mode, 'hybrid');
      assert.equal(data.rag_top_k, 5);
      assert.equal(data.rag_context_tokens, 1500);
      assert.equal(data.rag_input_budget_tokens, 3000);
      assert.equal(data.cache_enabled, 1);
      assert.equal(data.cache_ttl_seconds, 7200);
      assert.equal(data.direct_answer_enabled, 1);
      assert.equal(data.debounce_ms, 2500);
      assert.equal(data.temperature, 0.5);
      assert.equal(data.max_output_tokens, 1024);
    });

    it('rejects out-of-bound RAG settings parameters', async () => {
      // rag_mode invalid
      let res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_mode: 'super_ai'
      });
      assert.equal(res.status, 400);

      // rag_top_k out of range (> 5)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_top_k: 10
      });
      assert.equal(res.status, 400);

      // rag_context_tokens too low (< 100)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_context_tokens: 50
      });
      assert.equal(res.status, 400);

      // rag_context_tokens too high (> 10000)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_context_tokens: 10001
      });
      assert.equal(res.status, 400);

      // temperature out of range (> 2.0)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        temperature: 2.5
      });
      assert.equal(res.status, 400);

      // debounce_ms excessive (> 60000)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        debounce_ms: 70000
      });
      assert.equal(res.status, 400);

      // rag_input_budget_tokens excessive (> 32768)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_input_budget_tokens: 35000
      });
      assert.equal(res.status, 400);

      // rag_input_budget_tokens too low (< 256)
      res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        rag_input_budget_tokens: 100
      });
      assert.equal(res.status, 400);
    });

    it('invalidates session response cache upon saving settings', async () => {
      // Seed a cached response
      await storeCachedResponse({
        userId: 1,
        sessionId,
        query: 'halo apa kabar',
        reply: 'Jawaban tersimpan di cache',
        ttlSeconds: 3600
      });

      const cachedBefore = await lookupCachedResponse({
        userId: 1,
        sessionId,
        query: 'halo apa kabar'
      });
      assert.ok(cachedBefore);

      // Update settings
      await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionId,
        knowledge_base: 'Informasi bisnis terbaru untuk invalidasi cache'
      });

      // Cache should now be invalidated
      const cachedAfter = await lookupCachedResponse({
        userId: 1,
        sessionId,
        query: 'halo apa kabar'
      });
      assert.equal(cachedAfter, null);
    });
  });

  describe('RAG-0802: Session RAG Status Endpoint', () => {
    const statusSessionId = 'session-rag-status-0802';

    it('returns RAG status with zero counts when no sources indexed', async () => {
      await seedTestSession(statusSessionId, 1);

      const res = await agent.get(`/api/chatbot-ai/rag/${statusSessionId}/status`);
      assert.equal(res.status, 200);
      const data = res.body.data;

      assert.equal(data.session_id, statusSessionId);
      assert.equal(typeof data.rag_mode, 'string');
      assert.equal(data.sources_count, 0);
      assert.equal(data.chunks_count, 0);
      assert.equal(data.lexical_ready, false);
      assert.equal(data.embedding_ready, false);
      assert.equal(typeof data.config_revision, 'number');
    });

    it('returns accurate source and chunk counts when knowledge is seeded', async () => {
      // Seed source and chunk
      const sourceResult = await dbRun(
        `INSERT INTO rag_sources 
         (user_id, source_type, manual_session_id, content_hash, current_revision, indexed_revision, lexical_status, embedding_status, is_active)
         VALUES (?, 'manual', ?, 'hash_test_0802', 1, 1, 'READY', 'DISABLED', 1)`,
        [1, statusSessionId]
      );

      await dbRun(
        `INSERT INTO rag_session_sources (session_id, source_id, user_id)
         VALUES (?, ?, ?)`,
        [statusSessionId, sourceResult.id, 1]
      );

      await dbRun(
        `INSERT INTO rag_chunks
         (source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash)
         VALUES (?, ?, 1, 0, 'Konten chunk pengetahuan tes status', 10, 'chunk_hash_0802')`,
        [sourceResult.id, 1]
      );

      const res = await agent.get(`/api/chatbot-ai/rag/${statusSessionId}/status`);
      assert.equal(res.status, 200);
      const data = res.body.data;

      assert.equal(data.sources_count, 1);
      assert.equal(data.chunks_count, 1);
      assert.equal(data.lexical_ready, true);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await agent.get('/api/chatbot-ai/rag/non-existent-session-xyz/status');
      assert.equal(res.status, 404);
      assert.equal(res.body.error_code, 'SESSION_NOT_FOUND');
    });
  });

  describe('RAG-0803: Reindex API Integration', () => {
    const reindexSessionId = 'session-rag-reindex-0803';

    it('triggers reindex and responds with 202 Accepted and job info', async () => {
      await seedTestSession(reindexSessionId, 1);

      const res = await agent.post(`/api/chatbot-ai/rag/${reindexSessionId}/reindex`).send({ force: true });
      assert.equal(res.status, 202);
      assert.equal(res.body.data.session_id, reindexSessionId);
      assert.ok(Array.isArray(res.body.data.jobs));
    });

    it('returns 404 for non-existent session during reindex', async () => {
      const res = await agent.post('/api/chatbot-ai/rag/non-existent-reindex/reindex').send({});
      assert.equal(res.status, 404);
      assert.equal(res.body.error_code, 'SESSION_NOT_FOUND');
    });
  });

  describe('RAG-0804: Test Retrieval Endpoint & Isolation', () => {
    const sessionA = 'session-retrieval-tenant-a';
    const sessionB = 'session-retrieval-tenant-b';

    before(async () => {
      await seedTestSession(sessionA, user1Id);
      await seedTestSession(sessionB, user2Id);

      // Seed source & chunk for Session A
      const srcA = await dbRun(
        `INSERT INTO rag_sources (user_id, source_type, manual_session_id, content_hash, current_revision, indexed_revision, lexical_status, embedding_status, is_active)
         VALUES (?, 'manual', ?, 'hash_a', 1, 1, 'READY', 'DISABLED', 1)`,
        [user1Id, sessionA]
      );
      await dbRun(
        `INSERT INTO rag_session_sources (session_id, source_id, user_id)
         VALUES (?, ?, ?)`,
        [sessionA, srcA.id, user1Id]
      );
      await dbRun(
        `INSERT INTO rag_chunks (source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash)
         VALUES (?, ?, 1, 0, 'Layanan A menyediakan pendaftaran paket internet hemat Rp 50.000 per bulan.', 15, 'hash_chunk_a')`,
        [srcA.id, user1Id]
      );

      // Seed source & chunk for Session B (Sensitive data of Tenant B)
      const srcB = await dbRun(
        `INSERT INTO rag_sources (user_id, source_type, manual_session_id, content_hash, current_revision, indexed_revision, lexical_status, embedding_status, is_active)
         VALUES (?, 'manual', ?, 'hash_b', 1, 1, 'READY', 'DISABLED', 1)`,
        [user2Id, sessionB]
      );
      await dbRun(
        `INSERT INTO rag_session_sources (session_id, source_id, user_id)
         VALUES (?, ?, ?)`,
        [sessionB, srcB.id, user2Id]
      );
      await dbRun(
        `INSERT INTO rag_chunks (source_id, user_id, source_revision, chunk_index, chunk_text, token_count, content_hash)
         VALUES (?, ?, 1, 0, 'Kunci rahasia perusahaan B adalah TOKEN_SANGAT_RAHASIA_XYZ.', 12, 'hash_chunk_b')`,
        [srcB.id, user2Id]
      );

      // Set FTS mode in settings for Session A
      await agent.post('/api/chatbot-ai/settings').send({
        session_id: sessionA,
        rag_mode: 'fts',
        rag_top_k: 4
      });
    });

    it('rejects empty query with 400 VALIDATION_ERROR', async () => {
      const res = await agent
        .post(`/api/chatbot-ai/rag/${sessionA}/test-retrieval`)
        .send({ query: '' });

      assert.equal(res.status, 400);
    });

    it('returns sanitized candidate chunks for matching query', async () => {
      const res = await agent
        .post(`/api/chatbot-ai/rag/${sessionA}/test-retrieval`)
        .send({ query: 'paket internet hemat', mode: 'fts' });

      assert.equal(res.status, 200);
      const data = res.body.data;

      assert.equal(data.session_id, sessionA);
      assert.equal(data.query, 'paket internet hemat');
      assert.ok(Array.isArray(data.chunks));
      assert.equal(typeof data.retrieval_latency_ms, 'number');

      // Chunks must adhere to sanitized response schema
      for (const chunk of data.chunks) {
        assert.ok(chunk.id !== undefined);
        assert.ok(typeof chunk.score === 'number');
        assert.ok(typeof chunk.source_title === 'string');
        assert.ok(typeof chunk.content === 'string');
        assert.ok(typeof chunk.is_canonical === 'boolean');
        assert.ok(typeof chunk.token_count === 'number');
        // Must NOT leak tenant internal JIDs or sensitive paths
        assert.equal(chunk.jid, undefined);
        assert.equal(chunk.file_path, undefined);
      }
    });

    it('classifies pure greeting as conversation without retrieval candidates', async () => {
      const res = await agent
        .post(`/api/chatbot-ai/rag/${sessionA}/test-retrieval`)
        .send({ query: 'Halo kak', mode: 'hybrid' });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.mode, 'conversation');
      assert.equal(res.body.data.query_kind, 'social');
      assert.equal(res.body.data.threshold_source, 'conversational_bypass');
      assert.equal(res.body.data.relevance_threshold, null);
      assert.equal(res.body.data.selected_count, 0);
      assert.deepEqual(res.body.data.chunks, []);
    });

    it('NEVER leaks chunks from Session B into Session A retrieval results', async () => {
      const res = await agent
        .post(`/api/chatbot-ai/rag/${sessionA}/test-retrieval`)
        .send({ query: 'rahasia perusahaan token', mode: 'fts' });

      assert.equal(res.status, 200);
      const data = res.body.data;

      // Result chunks must NEVER contain Tenant B data
      for (const chunk of data.chunks) {
        assert.ok(!chunk.content.includes('TOKEN_SANGAT_RAHASIA_XYZ'), 'Leaked tenant B sensitive token into session A!');
      }
    });
  });

  describe('RAG-0805: Max Output Tokens Control', () => {
    const tokensSessionId = 'session-tokens-control-0805';

    it('accepts and persists valid max_output_tokens in range 64 to 10000', async () => {
      await seedTestSession(tokensSessionId, 1);

      const res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: tokensSessionId,
        max_output_tokens: 512
      });
      assert.equal(res.status, 200);

      const getRes = await agent.get(`/api/chatbot-ai/settings/${tokensSessionId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.max_output_tokens, 512);
    });

    it('rejects max_output_tokens below 64 with 400', async () => {
      const res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: tokensSessionId,
        max_output_tokens: 63
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    });

    it('rejects max_output_tokens above 10000 with 400', async () => {
      const res = await agent.post('/api/chatbot-ai/settings').send({
        session_id: tokensSessionId,
        max_output_tokens: 10001
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    });
  });

  describe('Cross-Tenant Security: Access Rejection for Foreign Sessions', () => {
    let authAgent;
    const foreignSession = 'session-tenant-1-private';

    before(async () => {
      const auth = await getAuthenticatedAgent();
      authAgent = auth.agent;
      await seedTestSession(foreignSession, user1Id);
    });

    it('rejects GET /settings when called by a different tenant', async () => {
      const res = await authAgent
        .get(`/api/chatbot-ai/settings/${foreignSession}`)
        .set('Cookie', user2Cookie);

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects POST /settings when called by a different tenant', async () => {
      const res = await authAgent
        .post('/api/chatbot-ai/settings')
        .set('Cookie', user2Cookie)
        .send({ session_id: foreignSession, rag_mode: 'fts' });

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects GET /rag/:sessionId/status when called by a different tenant', async () => {
      const res = await authAgent
        .get(`/api/chatbot-ai/rag/${foreignSession}/status`)
        .set('Cookie', user2Cookie);

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects POST /rag/:sessionId/reindex when called by a different tenant', async () => {
      const res = await authAgent
        .post(`/api/chatbot-ai/rag/${foreignSession}/reindex`)
        .set('Cookie', user2Cookie)
        .send({ force: true });

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects POST /rag/:sessionId/test-retrieval when called by a different tenant', async () => {
      const res = await authAgent
        .post(`/api/chatbot-ai/rag/${foreignSession}/test-retrieval`)
        .set('Cookie', user2Cookie)
        .send({ query: 'uji akses lintas tenant', mode: 'fts' });

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects POST /rag/:sessionId/generate-embeddings when called by a different tenant', async () => {
      const res = await authAgent
        .post(`/api/chatbot-ai/rag/${foreignSession}/generate-embeddings`)
        .set('Cookie', user2Cookie)
        .send({ force: true });

      assert.ok([403, 404].includes(res.status));
    });

    it('rejects POST /rag/:sessionId/generate-embeddings on non-existent session with 404', async () => {
      const res = await authAgent
        .post('/api/chatbot-ai/rag/non-existent-session-xyz/generate-embeddings')
        .set('Cookie', user1Cookie)
        .send({ force: true });

      assert.equal(res.status, 404);
    });
  });
});
