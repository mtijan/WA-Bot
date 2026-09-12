process.env.NODE_ENV = 'test';
process.env.WA_BOT_DB_PATH = ':memory:';
process.env.WA_BOT_SECRET_ENCRYPTION_KEY = 'test-secret-key-at-least-32-chars-long-12345';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  InboundDebouncer,
  SenderRequestSerializer
} = await import('../src/services/chatbot_ai_debounce.service.js');

const {
  computeCacheKey,
  computeSourceRevisionDigest,
  shouldCacheResult,
  lookupCachedResponse,
  storeCachedResponse,
  invalidateSessionCache,
  pruneExpiredCache,
  normalizeQueryForCache,
  validateCacheTtl,
  enforceSessionCacheEntryLimit,
  resolveDirectAnswerCandidate,
  containsPersonalData,
  pruneOldChatbotAIUsage,
  pruneOldRagIndexJobs,
  CACHE_BOUNDS,
  DIRECT_ANSWER_DEFAULTS
} = await import('../src/services/chatbot_ai_rag_cache.service.js');

const {
  processInboundAIMessage,
  RAG_RUNTIME_STATUSES
} = await import('../src/services/chatbot_ai_rag_runtime.service.js');

const {
  buildRagRuntimeEvent
} = await import('../src/services/chatbot_ai_rag_telemetry.service.js');

describe('Fase 7: Debounce, Serialization, Cache & Direct Answer (RAG-0701 - RAG-0710)', () => {
  describe('RAG-0701: Inbound Debouncer', () => {
    it('menggabungkan pesan berurutan dari pengirim yang sama dalam jendela debounce', async () => {
      const debouncer = new InboundDebouncer();
      const flushed = [];

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Halo kak',
        debounceMs: 50,
        onFlush: (text, meta) => flushed.push({ text, meta })
      });

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Mau tanya harga paket',
        debounceMs: 50,
        onFlush: (text, meta) => flushed.push({ text, meta })
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(flushed.length, 1, 'Hanya satu panggilan flush yang harus dieksekusi');
      assert.equal(flushed[0].text, 'Halo kak\nMau tanya harga paket', 'Teks pesan harus digabungkan dengan baris baru');
      assert.equal(flushed[0].meta.debounced, true);
      assert.equal(flushed[0].meta.debouncedCount, 1);
    });

    it('memisahkan debounce antar pengirim yang berbeda', async () => {
      const debouncer = new InboundDebouncer();
      const flushed = [];

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-A@s.whatsapp.net',
        text: 'Pesan A',
        debounceMs: 40,
        onFlush: (text) => flushed.push({ sender: 'A', text })
      });

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-B@s.whatsapp.net',
        text: 'Pesan B',
        debounceMs: 40,
        onFlush: (text) => flushed.push({ sender: 'B', text })
      });

      await new Promise((resolve) => setTimeout(resolve, 80));

      assert.equal(flushed.length, 2, 'Kedua pengirim harus menghasilkan flush terpisah');
      const senderA = flushed.find((f) => f.sender === 'A');
      const senderB = flushed.find((f) => f.sender === 'B');
      assert.ok(senderA && senderB);
      assert.equal(senderA.text, 'Pesan A');
      assert.equal(senderB.text, 'Pesan B');
    });

    it('mendukung cancel dan flushImmediately', () => {
      const debouncer = new InboundDebouncer();
      let flushedText = null;

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-cancel@s.whatsapp.net',
        text: 'Pesan akan dibatalkan',
        debounceMs: 1000,
        onFlush: (text) => { flushedText = text; }
      });

      assert.equal(debouncer.hasPending('sess-1', 'user-cancel@s.whatsapp.net'), true);
      assert.equal(debouncer.getPendingText('sess-1', 'user-cancel@s.whatsapp.net'), 'Pesan akan dibatalkan');

      const cancelled = debouncer.cancel('sess-1', 'user-cancel@s.whatsapp.net');
      assert.equal(cancelled, true);
      assert.equal(debouncer.hasPending('sess-1', 'user-cancel@s.whatsapp.net'), false);

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-flush@s.whatsapp.net',
        text: 'Pesan segera',
        debounceMs: 1000,
        onFlush: () => {}
      });

      const immediate = debouncer.flushImmediately('sess-1', 'user-flush@s.whatsapp.net');
      assert.equal(immediate, 'Pesan segera');
      assert.equal(debouncer.hasPending('sess-1', 'user-flush@s.whatsapp.net'), false);
    });
  });

  describe('RAG-0702: Sender Request Serializer', () => {
    it('menjalankan tugas secara serial FIFO per pengirim', async () => {
      const serializer = new SenderRequestSerializer();
      const executionOrder = [];

      const p1 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push('task-1');
        return 'res-1';
      });

      const p2 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        executionOrder.push('task-2');
        return 'res-2';
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      assert.equal(r1, 'res-1');
      assert.equal(r2, 'res-2');
      assert.deepEqual(executionOrder, ['task-1', 'task-2'], 'Task 1 harus selesai sebelum Task 2 mulai');
    });

    it('tetap melanjutkan antrean jika task sebelumnya melempar error', async () => {
      const serializer = new SenderRequestSerializer();
      const executionOrder = [];

      const p1 = serializer.enqueue('sess-1', 'user-err@s.whatsapp.net', async () => {
        executionOrder.push('task-fail');
        throw new Error('LLM Provider timeout');
      });

      const p2 = serializer.enqueue('sess-1', 'user-err@s.whatsapp.net', async () => {
        executionOrder.push('task-success');
        return 'recovered';
      });

      await assert.rejects(p1, /LLM Provider timeout/);
      const r2 = await p2;

      assert.equal(r2, 'recovered');
      assert.deepEqual(executionOrder, ['task-fail', 'task-success']);
    });
  });

  describe('RAG-0703: Response Cache Deterministic Key & Storage', () => {
    it('menghasilkan cache key yang identik untuk query yang dinormalisasi', () => {
      const key1 = computeCacheKey({
        userId: 1,
        sessionId: 'sess-a',
        query: 'Berapa biaya pendaftaran?',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      const key2 = computeCacheKey({
        userId: 1,
        sessionId: 'sess-a',
        query: '   berapa   BIAYA   pendaftaran?   ',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      assert.equal(key1, key2, 'Cache key harus deterministik terhadap whitespace dan case');
    });

    it('menghasilkan cache key berbeda jika model atau revision berbeda', () => {
      const keyBase = computeCacheKey({
        userId: 1,
        sessionId: 'sess-a',
        query: 'Biaya pendaftaran',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      const keyDiffModel = computeCacheKey({
        userId: 1,
        sessionId: 'sess-a',
        query: 'Biaya pendaftaran',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o',
        temperature: 0.3
      });

      const keyDiffRevision = computeCacheKey({
        userId: 1,
        sessionId: 'sess-a',
        query: 'Biaya pendaftaran',
        promptVersion: 1,
        configRevision: 2,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      assert.notEqual(keyBase, keyDiffModel);
      assert.notEqual(keyBase, keyDiffRevision);
    });

    it('menyimpan dan membaca kembali respon dari mock database terenkripsi', async () => {
      const mockStorage = new Map();
      const mockDb = {
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return mockStorage.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('INSERT INTO rag_response_cache')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            mockStorage.set(key, {
              id: 1,
              user_id: params[0],
              session_id: params[1],
              cache_key: params[2],
              source_revision_digest: params[3],
              response_ciphertext: params[4],
              expires_at: params[5],
              created_at: new Date().toISOString()
            });
            return { changes: 1 };
          }
          if (sql.includes('DELETE FROM rag_response_cache WHERE id = ?')) {
            for (const [k, v] of mockStorage.entries()) {
              if (v.id === params[0]) mockStorage.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        all: async () => [
          { id: 1, current_revision: 1 }
        ]
      };

      const stored = await storeCachedResponse({
        userId: 1,
        sessionId: 'sess-test',
        query: 'Berapa biaya kursus?',
        reply: 'Biaya kursus adalah Rp500.000 per bulan.',
        databaseClient: mockDb
      });

      assert.equal(stored, true);

      const cached = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-test',
        query: 'berapa biaya kursus?',
        databaseClient: mockDb
      });

      assert.ok(cached, 'Cache hit harus ditemukan');
      assert.equal(cached.cacheHit, true);
      assert.equal(cached.reply, 'Biaya kursus adalah Rp500.000 per bulan.');
    });
  });

  describe('RAG-0704: Cache Invalidation & TTL Shift', () => {
    it('menginvalidasi respon cache jika source_revision_digest berubah', async () => {
      let currentRevision = 1;
      const mockStorage = new Map();
      const mockDb = {
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return mockStorage.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('INSERT INTO rag_response_cache')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            mockStorage.set(key, {
              id: 1,
              user_id: params[0],
              session_id: params[1],
              cache_key: params[2],
              source_revision_digest: params[3],
              response_ciphertext: params[4],
              expires_at: params[5],
              created_at: new Date().toISOString()
            });
            return { changes: 1 };
          }
          if (sql.includes('DELETE FROM rag_response_cache WHERE id = ?')) {
            for (const [k, v] of mockStorage.entries()) {
              if (v.id === params[0]) mockStorage.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        all: async () => [
          { id: 1, current_revision: currentRevision }
        ]
      };

      await storeCachedResponse({
        userId: 1,
        sessionId: 'sess-inv',
        query: 'Informasi pendaftaran',
        reply: 'Pendaftaran gelombang 1 dibuka.',
        databaseClient: mockDb
      });

      const beforeUpdate = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-inv',
        query: 'Informasi pendaftaran',
        databaseClient: mockDb
      });
      assert.ok(beforeUpdate, 'Cache harus valid sebelum revisi berubah');

      // Admin mengupdate dokumen sumber pengetahuan (revisi naik)
      currentRevision = 2;

      const afterUpdate = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-inv',
        query: 'Informasi pendaftaran',
        databaseClient: mockDb
      });
      assert.equal(afterUpdate, null, 'Cache lama harus dianggap miss dan dihapus saat digest berubah');
    });

    it('menginvalidasi respon yang melewati waktu kedaluwarsa (expired TTL)', async () => {
      const mockStorage = new Map();
      const pastExpiresAt = new Date(Date.now() - 5000).toISOString();
      const mockDb = {
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return mockStorage.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('DELETE FROM rag_response_cache WHERE id = ?')) {
            for (const [k, v] of mockStorage.entries()) {
              if (v.id === params[0]) mockStorage.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        all: async () => [{ id: 1, current_revision: 1 }]
      };

      const cacheKey = computeCacheKey({
        userId: 1,
        sessionId: 'sess-ttl',
        query: 'Pertanyaan kedaluwarsa'
      });

      mockStorage.set(`1:sess-ttl:${cacheKey}`, {
        id: 99,
        user_id: 1,
        session_id: 'sess-ttl',
        cache_key: cacheKey,
        source_revision_digest: 'digest-1',
        response_ciphertext: 'ciphertext',
        expires_at: pastExpiresAt
      });

      const res = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-ttl',
        query: 'Pertanyaan kedaluwarsa',
        databaseClient: mockDb
      });

      assert.equal(res, null, 'Entri yang sudah melewati TTL harus mengembalikan null');
    });
  });

  describe('RAG-0705: Non-Cacheable Policies', () => {
    it('menolak cache jika status bukan REPLIED atau reply kosong', () => {
      assert.equal(shouldCacheResult({ status: 'ERROR', reply: 'Error' }), false);
      assert.equal(shouldCacheResult({ status: 'CS_FALLBACK', reply: 'Hubungi CS' }), false);
      assert.equal(shouldCacheResult({ status: 'EMPTY_REPLY', reply: '' }), false);
      assert.equal(shouldCacheResult({ status: 'REPLIED', reply: '   ' }), false);
      assert.equal(shouldCacheResult(null), false);
    });

    it('menolak cache jika respons merupakan CS fallback dari metadata RAG', () => {
      const csResult = {
        status: 'REPLIED',
        reply: 'Mohon maaf, saya belum bisa menjawab...',
        ragMetadata: { cs_fallback: true }
      };
      assert.equal(shouldCacheResult(csResult), false);
    });

    it('menolak cache jika finish_reason bukan stop (misal length / terpotong)', () => {
      const truncated = {
        status: 'REPLIED',
        reply: 'Jawaban yang terpotong di tenga...',
        finishReason: 'length'
      };
      assert.equal(shouldCacheResult(truncated), false);

      const normal = {
        status: 'REPLIED',
        reply: 'Jawaban lengkap yang tuntas.',
        finishReason: 'stop'
      };
      assert.equal(shouldCacheResult(normal), true);
    });
  });

  describe('RAG-0706: Cache Default Disabled, TTL Bounds & Session Limit', () => {
    it('memvalidasi batas TTL cache antara 60 detik hingga 86.400 detik (24 jam)', () => {
      assert.equal(validateCacheTtl(10), 60, 'TTL di bawah 60 harus dinaikkan ke batas minimum');
      assert.equal(validateCacheTtl(100_000), 86_400, 'TTL di atas 86.400 harus diturunkan ke 24 jam');
      assert.equal(validateCacheTtl(3600), 3600, 'TTL valid harus dipertahankan');
      assert.equal(validateCacheTtl(null), 86_400, 'TTL default adalah 24 jam');
      assert.equal(validateCacheTtl('invalid'), 86_400);
    });

    it('memastikan cache tidak aktif jika cache_enabled bernilai 0 atau tidak diset', async () => {
      let providerCalled = false;
      const mockDeps = {
        checkSessionIndexReadiness: async () => ({ isReady: true }),
        shouldUseRag: () => true,
        executeRagRetrieval: async () => ({
          ragResult: { context: 'Konteks', selected_count: 1 },
          effectiveMode: 'fts',
          reason: 'ready'
        }),
        executeChatCompletion: async () => {
          providerCalled = true;
          return {
            response: { choices: [{ message: { content: 'Hasil LLM' }, finish_reason: 'stop' }] },
            latencyMs: 5
          };
        },
        lookupCachedResponse: async () => {
          throw new Error('lookupCachedResponse tidak boleh dipanggil jika cache_enabled = 0');
        },
        assertSafeOutboundUrl: async (u) => u,
        recheckDeliveryAccess: async () => ({ allowed: true, reason: 'OK' })
      };

      const result = await processInboundAIMessage({
        sessionId: 'sess-no-cache',
        userId: 1,
        cleanText: 'Pertanyaan',
        aiSettings: {
          is_active: 1,
          rag_mode: 'fts',
          cache_enabled: 0 // Default nonaktif
        },
        credentials: { apiKey: 'key', baseUrl: 'https://ai.example.com/v1', model: 'gpt-4o-mini' }
      }, mockDeps);

      assert.equal(result.status, 'REPLIED');
      assert.equal(providerCalled, true, 'LLM harus dipanggil ketika cache nonaktif');
    });

    it('menegakkan batas maksimal entri cache per sesi (enforceSessionCacheEntryLimit)', async () => {
      const mockStorage = [];
      const mockDb = {
        get: async () => ({ total: mockStorage.length }),
        run: async (sql, params) => {
          if (sql.includes('DELETE FROM rag_response_cache')) {
            const limit = params[2];
            mockStorage.splice(0, limit);
            return { changes: limit };
          }
          return { changes: 0 };
        }
      };

      for (let i = 0; i < 10; i++) {
        mockStorage.push({ id: i + 1, created_at: i });
      }

      const pruned = await enforceSessionCacheEntryLimit(1, 'sess-quota', 5, mockDb);
      assert.equal(pruned, 6, 'Harus menghapus 6 entri terlama agar kuota 5 terpenuhi');
      assert.equal(mockStorage.length, 4);
    });
  });

  describe('RAG-0707: Direct Answer for Canonical Chunks', () => {
    it('mengidentifikasi kandidat direct answer kanonis dengan confidence tinggi', () => {
      const ragResult = {
        results: [
          {
            chunk_id: 1,
            chunk_text: 'Biaya pendaftaran adalah Rp150.000.',
            relevance_score: 0.88,
            metadata: { canonical: true, direct_answer_text: 'Biaya pendaftaran resmi Rp150.000.' }
          },
          {
            chunk_id: 2,
            chunk_text: 'Pendaftaran dibuka online.',
            relevance_score: 0.65
          }
        ]
      };

      const candidate = resolveDirectAnswerCandidate(ragResult);
      assert.ok(candidate);
      assert.equal(candidate.isDirectAnswer, true);
      assert.equal(candidate.directReply, 'Biaya pendaftaran resmi Rp150.000.');
      assert.equal(candidate.confidence, 0.88);
    });

    it('menolak direct answer jika confidence di bawah ambang batas dan bukan kanonis eksplisit', () => {
      const ragResult = {
        results: [
          {
            chunk_id: 1,
            chunk_text: 'Mungkin biaya sekitar 100 ribu.',
            relevance_score: 0.60,
            metadata: {}
          }
        ]
      };

      const candidate = resolveDirectAnswerCandidate(ragResult, { threshold: 0.85 });
      assert.equal(candidate, null);
    });

    it('mengembalikan jawaban langsung tanpa memanggil LLM jika direct_answer_enabled aktif', async () => {
      let llmCalled = false;
      const mockDeps = {
        checkSessionIndexReadiness: async () => ({ isReady: true }),
        shouldUseRag: () => true,
        executeRagRetrieval: async () => ({
          ragResult: {
            context: 'Konteks',
            selected_count: 1,
            results: [
              {
                chunk_id: 10,
                chunk_text: 'Kantor beroperasi Senin-Jumat pukul 08:00 - 17:00 WIB.',
                relevance_score: 0.92,
                metadata: { canonical: true }
              }
            ]
          },
          effectiveMode: 'fts',
          reason: 'ready'
        }),
        executeChatCompletion: async () => {
          llmCalled = true;
          return { response: { choices: [{ message: { content: 'LLM' } }] } };
        },
        recheckDeliveryAccess: async () => ({ allowed: true, reason: 'OK' })
      };

      const result = await processInboundAIMessage({
        sessionId: 'sess-da',
        userId: 1,
        cleanText: 'Jam operasional kantor kapan?',
        aiSettings: {
          is_active: 1,
          rag_mode: 'fts',
          direct_answer_enabled: 1
        },
        credentials: { apiKey: 'key', baseUrl: 'https://ai.example.com/v1', model: 'gpt-4o-mini' },
        deliverReply: async () => {}
      }, mockDeps);

      assert.equal(result.status, 'REPLIED');
      assert.equal(result.reply, 'Kantor beroperasi Senin-Jumat pukul 08:00 - 17:00 WIB.');
      assert.equal(result.fromDirectAnswer, true);
      assert.equal(result.ragMetadata.direct_answer, true);
      assert.equal(result.ragMetadata.ai_call_avoided, true);
      assert.equal(llmCalled, false, 'LLM tidak boleh dipanggil saat direct answer aktif');
    });
  });

  describe('RAG-0708: Telemetry for Cache Hit, Direct Answer & Avoided Calls', () => {
    it('mencatat metrik cache hit dan ai_call_avoided pada runtime event', () => {
      const event = buildRagRuntimeEvent({
        userId: 1,
        result: {
          status: 'REPLIED',
          delivered: true,
          ragMetadata: {
            rag_mode: 'fts',
            effective_mode: 'cache',
            cache_hit: true,
            selected_count: 0
          }
        },
        totalLatencyMs: 15
      });

      assert.equal(event.cache_hit, true);
      assert.equal(event.ai_call_avoided, true);
      assert.equal(event.retrieval_type, 'cache');
      assert.equal(event.total_latency_ms, 15);
    });

    it('mencatat metrik direct answer dan debounced message count', () => {
      const event = buildRagRuntimeEvent({
        userId: 1,
        result: {
          status: 'REPLIED',
          delivered: true,
          ragMetadata: {
            rag_mode: 'fts',
            effective_mode: 'direct_answer',
            direct_answer: true,
            debounced: true,
            debounced_count: 2,
            selected_count: 1
          }
        },
        totalLatencyMs: 25
      });

      assert.equal(event.direct_answer, true);
      assert.equal(event.debounced, true);
      assert.equal(event.debounced_count, 2);
      assert.equal(event.ai_call_avoided, true);
      assert.equal(event.retrieval_type, 'direct_answer');
    });
  });

  describe('RAG-0709: Concurrency & Invalidation Tests', () => {
    it('menjaga isolasi request simultan dari pengirim berbeda tanpa tertukar', async () => {
      const serializer = new SenderRequestSerializer();
      const results = {};

      const reqA = serializer.enqueue('sess-iso', 'senderA@s.whatsapp.net', async () => {
        await new Promise((r) => setTimeout(r, 20));
        results['A'] = 'Jawaban untuk A';
        return 'A_OK';
      });

      const reqB = serializer.enqueue('sess-iso', 'senderB@s.whatsapp.net', async () => {
        results['B'] = 'Jawaban untuk B';
        return 'B_OK';
      });

      await Promise.all([reqA, reqB]);

      assert.equal(results['A'], 'Jawaban untuk A');
      assert.equal(results['B'], 'Jawaban untuk B');
      assert.notEqual(results['A'], results['B']);
    });

    it('menghapus seluruh cache sesi ketika invalidateSessionCache dipanggil', async () => {
      const mockStorage = new Map([
        ['1:sess-clean:k1', { id: 1 }],
        ['1:sess-clean:k2', { id: 2 }],
        ['1:other-sess:k1', { id: 3 }]
      ]);

      const mockDb = {
        run: async (sql, params) => {
          let count = 0;
          for (const [k] of [...mockStorage.entries()]) {
            if (k.startsWith(`${params[0]}:${params[1]}:`)) {
              mockStorage.delete(k);
              count++;
            }
          }
          return { changes: count };
        }
      };

      const deleted = await invalidateSessionCache(1, 'sess-clean', mockDb);
      assert.equal(deleted, 2);
      assert.equal(mockStorage.has('1:other-sess:k1'), true, 'Sesi lain tidak boleh terpengaruh');
    });

    it('membersihkan cache kedaluwarsa secara batch via pruneExpiredCache', async () => {
      const nowIso = new Date().toISOString();
      let executedSql = '';
      const mockDb = {
        run: async (sql, params) => {
          executedSql = sql;
          return { changes: 3 };
        }
      };

      const pruned = await pruneExpiredCache(mockDb, nowIso);
      assert.equal(pruned, 3);
      assert.ok(executedSql.includes('DELETE FROM rag_response_cache WHERE expires_at <= ?'));
    });
  });

  describe('RAG-0710: Privacy, Security & Retention Pruning', () => {
    it('mendeteksi dan menolak caching untuk query atau respon yang memuat data personal / PII', () => {
      assert.equal(containsPersonalData('Nomor saya 081234567890'), true);
      assert.equal(containsPersonalData('Kirim ke email test@example.com ya'), true);
      assert.equal(containsPersonalData('NIK saya 3201234567890001'), true);
      assert.equal(containsPersonalData('Berikut kode OTP Anda 1234'), true);
      assert.equal(containsPersonalData('Berapa harga paket kursus?'), false);

      // shouldCacheResult menolak respon dengan PII
      const piiReplyResult = {
        status: 'REPLIED',
        reply: 'Data Anda tercatat dengan email user@example.id.',
        finishReason: 'stop'
      };
      assert.equal(shouldCacheResult(piiReplyResult), false);

      // shouldCacheResult menolak query dengan nomor telepon
      const piiQueryResult = {
        status: 'REPLIED',
        reply: 'Informasi umum telah dikirim.',
        finishReason: 'stop'
      };
      assert.equal(shouldCacheResult(piiQueryResult, { query: 'Nomor saya 081299998888 mohon dicek' }), false);

      // shouldCacheResult menolak jika ditandai isPersonal: true
      assert.equal(shouldCacheResult(piiQueryResult, { isPersonal: true }), false);
    });

    it('menjalankan pembersihan retensi data lama untuk usage (30 hari) dan index jobs (7 hari)', async () => {
      let usagePruneSql = '';
      let jobsPruneSql = '';

      const mockDb = {
        run: async (sql) => {
          if (sql.includes('chatbot_ai_usage')) {
            usagePruneSql = sql;
            return { changes: 15 };
          }
          if (sql.includes('rag_index_jobs')) {
            jobsPruneSql = sql;
            return { changes: 7 };
          }
          return { changes: 0 };
        }
      };

      const usageDeleted = await pruneOldChatbotAIUsage({ olderThanDays: 30 }, mockDb);
      const jobsDeleted = await pruneOldRagIndexJobs({ olderThanDays: 7 }, mockDb);

      assert.equal(usageDeleted, 15);
      assert.ok(usagePruneSql.includes('DELETE FROM chatbot_ai_usage WHERE created_at <= ?'));

      assert.equal(jobsDeleted, 7);
      assert.ok(jobsPruneSql.includes("DELETE FROM rag_index_jobs WHERE status IN ('READY', 'SUPERSEDED') AND updated_at <= ?"));
    });
  });
});
