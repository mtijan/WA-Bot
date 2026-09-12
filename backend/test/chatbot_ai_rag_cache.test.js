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
  normalizeQueryForCache
} = await import('../src/services/chatbot_ai_rag_cache.service.js');

const {
  processInboundAIMessage,
  RAG_RUNTIME_STATUSES
} = await import('../src/services/chatbot_ai_rag_runtime.service.js');

describe('Fase 7: Debounce, Serialization, & Response Cache (RAG-0701 - RAG-0705)', () => {
  describe('RAG-0701: Inbound Debouncer', () => {
    it('menggabungkan pesan berurutan dari pengirim yang sama dalam jendela debounce', async () => {
      const debouncer = new InboundDebouncer();
      const flushed = [];

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Halo kak',
        debounceMs: 50,
        onFlush: (text) => flushed.push(text)
      });

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Mau tanya harga paket',
        debounceMs: 50,
        onFlush: (text) => flushed.push(text)
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(flushed.length, 1, 'Hanya satu panggilan flush yang harus dieksekusi');
      assert.equal(flushed[0], 'Halo kak\nMau tanya harga paket', 'Teks pesan harus digabungkan dengan baris baru');
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
      assert.equal(senderA?.text, 'Pesan A');
      assert.equal(senderB?.text, 'Pesan B');
    });

    it('mengeksekusi langsung jika debounceMs bernilai 0', () => {
      const debouncer = new InboundDebouncer();
      let result = null;

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Pesan instan',
        debounceMs: 0,
        onFlush: (text) => {
          result = text;
        }
      });

      assert.equal(result, 'Pesan instan', 'Pesan harus langsung dieksekusi secara sinkron');
    });

    it('mendukung pembatalan debounce aktif via cancel', async () => {
      const debouncer = new InboundDebouncer();
      let flushed = false;

      debouncer.debounce({
        sessionId: 'sess-1',
        senderJid: 'user-1@s.whatsapp.net',
        text: 'Pesan batal',
        debounceMs: 50,
        onFlush: () => {
          flushed = true;
        }
      });

      assert.equal(debouncer.hasPending('sess-1', 'user-1@s.whatsapp.net'), true);
      const cancelled = debouncer.cancel('sess-1', 'user-1@s.whatsapp.net');
      assert.equal(cancelled, true);

      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(flushed, false, 'Pesan yang dibatalkan tidak boleh diflush');
    });
  });

  describe('RAG-0702: Sender Request Serializer', () => {
    it('mengeksekusi request dari pengirim yang sama secara serial FIFO', async () => {
      const serializer = new SenderRequestSerializer();
      const order = [];

      const p1 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        await new Promise((r) => setTimeout(r, 40));
        order.push('task-1-done');
        return 'res-1';
      });

      const p2 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('task-2-done');
        return 'res-2';
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1, 'res-1');
      assert.equal(r2, 'res-2');
      assert.deepEqual(order, ['task-1-done', 'task-2-done'], 'Task 1 harus selesai sebelum task 2 dimulai');
    });

    it('menjalankan pengirim yang berbeda secara paralel', async () => {
      const serializer = new SenderRequestSerializer();
      const order = [];

      const pA = serializer.enqueue('sess-1', 'user-A@s.whatsapp.net', async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push('user-A');
      });

      const pB = serializer.enqueue('sess-1', 'user-B@s.whatsapp.net', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('user-B');
      });

      await Promise.all([pA, pB]);
      assert.deepEqual(order, ['user-B', 'user-A'], 'User B yang lebih cepat harus selesai lebih dulu tanpa terhalang User A');
    });

    it('kegagalan task tidak memutus antrean berikutnya untuk pengirim tersebut', async () => {
      const serializer = new SenderRequestSerializer();

      const p1 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        throw new Error('Task 1 fail');
      });

      const p2 = serializer.enqueue('sess-1', 'user-1@s.whatsapp.net', async () => {
        return 'task-2-success';
      });

      await assert.rejects(p1, { message: 'Task 1 fail' });
      const r2 = await p2;
      assert.equal(r2, 'task-2-success', 'Task 2 harus tetap berjalan sukses setelah task 1 gagal');
    });
  });

  describe('RAG-0703: SQLite Response Cache Storage & Key Generation', () => {
    it('menghasilkan cache key deterministik dan normalisasi query', () => {
      const key1 = computeCacheKey({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Berapa Biaya Pendaftaran?  ',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      const key2 = computeCacheKey({
        userId: 1,
        sessionId: 'sess-1',
        query: '  berapa biaya pendaftaran? ',
        promptVersion: 1,
        configRevision: 1,
        model: 'gpt-4o-mini',
        temperature: 0.3
      });

      assert.equal(key1, key2, 'Query dengan spasi dan huruf kapital berbeda harus menghasilkan key yang sama');
      assert.equal(typeof key1, 'string');
      assert.equal(key1.length, 64, 'Key harus berupa hex SHA-256 (64 karakter)');
    });

    it('menyimpan dan membaca kembali cache terenkripsi dengan mock DB', async () => {
      const cacheStore = new Map();
      const mockDb = {
        all: async () => [{ id: 10, current_revision: 2 }],
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return cacheStore.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('INSERT INTO rag_response_cache')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            cacheStore.set(key, {
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
            for (const [k, v] of cacheStore.entries()) {
              if (v.id === params[0]) cacheStore.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };

      const stored = await storeCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Berapa biayanya?',
        reply: 'Biayanya adalah Rp100.000.',
        ttlSeconds: 3600,
        databaseClient: mockDb
      });
      assert.equal(stored, true);

      // Verifikasi bahwa isi yang tersimpan di disk terenkripsi
      const savedEntry = Array.from(cacheStore.values())[0];
      assert.ok(savedEntry.response_ciphertext.startsWith('enc:v1:'), 'Ciphertext harus terenkripsi dengan prefix enc:v1');
      assert.ok(!savedEntry.response_ciphertext.includes('Rp100.000'), 'Plaintext tidak boleh ada di ciphertext');

      // Lookup cache kembali
      const retrieved = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Berapa biayanya?',
        databaseClient: mockDb
      });

      assert.ok(retrieved);
      assert.equal(retrieved.cacheHit, true);
      assert.equal(retrieved.reply, 'Biayanya adalah Rp100.000.');
    });
  });

  describe('RAG-0704: Cache Invalidation', () => {
    it('menganggap cache miss dan menghapus entri jika revisi source berubah', async () => {
      let currentSourceRev = 1;
      const cacheStore = new Map();
      const mockDb = {
        all: async () => [{ id: 10, current_revision: currentSourceRev }],
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return cacheStore.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('INSERT INTO rag_response_cache')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            cacheStore.set(key, {
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
            for (const [k, v] of cacheStore.entries()) {
              if (v.id === params[0]) cacheStore.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };

      await storeCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Jam buka kantor?',
        reply: 'Pukul 08.00 - 17.00.',
        databaseClient: mockDb
      });

      // Validasi awal: hit
      const hit1 = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Jam buka kantor?',
        databaseClient: mockDb
      });
      assert.equal(hit1?.cacheHit, true);

      // Sumber diperbarui menjadi revisi 2
      currentSourceRev = 2;

      // Lookup kembali: harus miss dan menghapus entri usang
      const hit2 = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Jam buka kantor?',
        databaseClient: mockDb
      });
      assert.equal(hit2, null, 'Cache dengan revisi sumber lama harus dianggap miss');
      assert.equal(cacheStore.size, 0, 'Entri cache usang harus otomatis dihapus');
    });

    it('menganggap cache miss dan menghapus entri jika sudah expired', async () => {
      const cacheStore = new Map();
      const mockDb = {
        all: async () => [{ id: 10, current_revision: 1 }],
        get: async (sql, params) => {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return cacheStore.get(key) || null;
        },
        run: async (sql, params) => {
          if (sql.includes('INSERT INTO rag_response_cache')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            cacheStore.set(key, {
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
            for (const [k, v] of cacheStore.entries()) {
              if (v.id === params[0]) cacheStore.delete(k);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };

      const pastTime = Date.now() - 10_000;
      await storeCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Lokasi cabang?',
        reply: 'Jakarta Selatan',
        ttlSeconds: 60,
        now: pastTime - 100_000,
        databaseClient: mockDb
      });

      const result = await lookupCachedResponse({
        userId: 1,
        sessionId: 'sess-1',
        query: 'Lokasi cabang?',
        databaseClient: mockDb,
        now: Date.now()
      });

      assert.equal(result, null, 'Entri yang sudah melewati expires_at harus miss');
      assert.equal(cacheStore.size, 0, 'Entri kadaluarsa harus dihapus');
    });
  });

  describe('RAG-0705: Policy Non-Cacheable Error / Fallback', () => {
    it('menolak cache untuk status CS_FALLBACK, EMPTY_REPLY, ERROR, atau truncated', () => {
      assert.equal(shouldCacheResult({
        status: RAG_RUNTIME_STATUSES.CS_FALLBACK,
        reply: 'Mohon maaf, CS kami...',
        finishReason: 'stop'
      }), false, 'CS fallback tidak boleh dicache');

      assert.equal(shouldCacheResult({
        status: RAG_RUNTIME_STATUSES.EMPTY_REPLY,
        reply: null,
        error: 'Empty response'
      }), false, 'Empty reply tidak boleh dicache');

      assert.equal(shouldCacheResult({
        status: RAG_RUNTIME_STATUSES.ERROR,
        reply: null,
        error: new Error('Timeout')
      }), false, 'Error tidak boleh dicache');

      assert.equal(shouldCacheResult({
        status: RAG_RUNTIME_STATUSES.REPLIED,
        reply: 'Jawaban terpotong...',
        finishReason: 'length'
      }), false, 'Jawaban terpotong (length finish) tidak boleh dicache');

      assert.equal(shouldCacheResult({
        status: RAG_RUNTIME_STATUSES.REPLIED,
        reply: 'Jawaban lengkap dan valid.',
        finishReason: 'stop',
        error: null
      }), true, 'Jawaban sukses berstatus stop harus diizinkan dicache');
    });

    it('integrasi runtime: cache hit menghindari eksekusi retrieval dan provider', async () => {
      let providerCalls = 0;
      let retrievalCalls = 0;

      const mockDependencies = {
        lookupCachedResponse: async () => ({
          cacheHit: true,
          reply: 'Jawaban dari cache SQLite.'
        }),
        executeRagRetrieval: async () => {
          retrievalCalls++;
          return { ragResult: { context: 'ctx', selected_count: 1 }, effectiveMode: 'fts', reason: 'ready' };
        },
        executeChatCompletion: async () => {
          providerCalls++;
          return {
            response: { choices: [{ message: { content: 'LLM reply' }, finish_reason: 'stop' }] },
            latencyMs: 10
          };
        },
        assertSafeOutboundUrl: async (url) => url,
        recheckDeliveryAccess: async () => ({ allowed: true, reason: 'OK' })
      };

      const result = await processInboundAIMessage({
        sessionId: 'sess-cache-test',
        userId: 1,
        cleanText: 'Pertanyaan populer',
        aiSettings: {
          is_active: 1,
          chatbot_mode: 'ai',
          rag_mode: 'fts',
          cache_enabled: 1
        },
        credentials: {
          apiKey: 'test-key',
          baseUrl: 'https://ai.example.com/v1',
          model: 'gpt-4o-mini'
        },
        deliverReply: async () => {}
      }, mockDependencies);

      assert.equal(result.status, RAG_RUNTIME_STATUSES.REPLIED);
      assert.equal(result.reply, 'Jawaban dari cache SQLite.');
      assert.equal(result.fromCache, true);
      assert.equal(providerCalls, 0, 'Provider LLM tidak boleh dipanggil saat cache hit');
      assert.equal(retrievalCalls, 0, 'Retrieval RAG tidak boleh dipanggil saat cache hit');
    });
  });
});
