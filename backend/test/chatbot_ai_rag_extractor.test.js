import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chunkKnowledgeDocuments,
  estimateRagTokens,
  extractFlowKnowledgeSource,
  extractManualKnowledgeSource,
  resolveRagSourceRevision
} from '../src/services/chatbot_ai_rag_extractor.service.js';

describe('Chatbot AI deterministic RAG extraction and chunking', () => {
  it('extracts manual knowledge per session and advances revisions only when content changes', () => {
    const source = extractManualKnowledgeSource({
      userId: 7,
      sessionId: 'sales-id',
      knowledgeBase: '  Harga paket dasar Rp150.000.\r\n\r\nHubungi +62 812-3456-7890.  '
    });
    assert.equal(source.sourceType, 'manual');
    assert.equal(source.userId, 7);
    assert.equal(source.manualSessionId, 'sales-id');
    assert.equal(source.documents.length, 1);
    assert.match(source.documents[0].text, /Rp150\.000/);
    assert.equal(source.contentHash.length, 64);
    assert.equal(resolveRagSourceRevision({ contentHash: source.contentHash }), 1);
    assert.equal(resolveRagSourceRevision({
      previousContentHash: source.contentHash,
      previousRevision: 4,
      contentHash: source.contentHash
    }), 4);
    assert.equal(resolveRagSourceRevision({
      previousContentHash: 'old-hash',
      previousRevision: 4,
      contentHash: source.contentHash
    }), 5);
  });

  it('preserves flow, node, keyword, button, and branch provenance without attachment paths', () => {
    const source = extractFlowKnowledgeSource({
      id: 22,
      user_id: 7,
      flow_name: 'Pendaftaran Mahasiswa',
      keywords: '["daftar","biaya"]',
      nodes: [
        {
          id: 'root',
          node_name: 'Pembuka',
          message_content: 'Silakan pilih informasi.',
          buttons: [
            { title: 'Biaya', next_node: 'price' },
            { title: 'Syarat', next_node: 'requirements' }
          ],
          attachment: { type: 'Document', url: 'D:\\private\\brosur.pdf', binary: 'SECRET-BINARY' }
        },
        {
          id: 'price',
          node_name: 'Harga',
          message_content: 'Biaya pendaftaran Rp150.000. Detail https://contoh.id/biaya?a=1&b=2',
          next_node: 'done'
        },
        {
          id: 'requirements',
          node_name: 'Syarat',
          message_content: 'Syarat: KTP, ijazah, dan pas foto.',
          next_node: 'done'
        },
        {
          id: 'empty',
          node_name: 'Node kosong',
          message_content: '   ',
          attachment: { url: '/api/uploads/media/private.pdf' }
        }
      ]
    });

    assert.equal(source.documents.length, 3);
    assert.deepEqual(source.documents[0].metadata.flow_keywords, ['daftar', 'biaya']);
    assert.deepEqual(source.documents[0].metadata.buttons, ['Biaya', 'Syarat']);
    assert.deepEqual(source.documents[1].metadata.branch_path, ['root', 'price']);
    assert.deepEqual(source.documents[2].metadata.branch_path, ['root', 'requirements']);
    const serialized = JSON.stringify(source.documents);
    assert.doesNotMatch(serialized, /private|SECRET-BINARY|uploads\/media/);
    assert.match(source.documents[1].text, /https:\/\/contoh\.id\/biaya\?a=1&b=2/);
  });

  it('keeps short nodes atomic and chunks long Indonesian text within the configured budget', () => {
    const shortDocument = {
      documentId: 'flow:1:node:short',
      text: 'Harga Paket Hemat adalah Rp99.000 per bulan.',
      metadata: { node_id: 'short' }
    };
    const sentence = 'Mahasiswa wajib membawa KTP, ijazah, pas foto, dan bukti pembayaran ke kantor layanan.';
    const longDocument = {
      documentId: 'flow:1:node:long',
      text: Array.from({ length: 75 }, (_, index) => `${sentence} Tahap ${index + 1}.`).join(' '),
      metadata: { node_id: 'long' }
    };
    const chunks = chunkKnowledgeDocuments([shortDocument, longDocument]);

    assert.equal(chunks[0].text, shortDocument.text);
    assert.equal(chunks[0].overlapTokens, 0);
    const longChunks = chunks.filter((chunk) => chunk.metadata.node_id === 'long');
    assert.ok(longChunks.length > 2);
    assert.ok(longChunks.every((chunk) => chunk.tokenCount >= 150));
    assert.ok(longChunks.every((chunk) => chunk.tokenCount <= 300));
    assert.ok(longChunks.slice(1).some((chunk) => chunk.overlapTokens >= 30));
    assert.ok(longChunks.slice(1).every((chunk) => chunk.overlapTokens <= 50));
    assert.equal(chunks.map((chunk) => chunk.chunkIndex).join(','), chunks.map((_, index) => index).join(','));
  });

  it('supports the staging export shape with name/message/options/next_node_id fields', () => {
    const source = extractFlowKnowledgeSource({
      id: 31,
      name: 'Informasi Akademik',
      trigger_keywords: 'kuliah, jadwal',
      nodes: [{
        id: 91,
        name: 'Pilihan layanan',
        node_type: 'question',
        message: 'Pilih layanan akademik yang dibutuhkan.',
        next_node_id: 92,
        options: JSON.stringify({
          interaction_type: 'buttons',
          options: [
            { id: 'a', title: 'Jadwal', display_text: 'Lihat jadwal' },
            { id: 'b', title: 'Biaya', display_text: 'Lihat biaya' }
          ]
        }),
        attachment_type: 'document',
        attachment_data: 'D:\\private\\academic.pdf'
      }, {
        id: 92,
        name: 'Jadwal',
        node_type: 'message',
        message: 'Jadwal tersedia pada portal mahasiswa.',
        options: '[]'
      }]
    }, { userId: 8 });

    assert.equal(source.flowName, 'Informasi Akademik');
    assert.equal(source.userId, 8);
    assert.deepEqual(source.documents[0].metadata.flow_keywords, ['kuliah', 'jadwal']);
    assert.deepEqual(source.documents[0].metadata.buttons, ['Jadwal', 'Biaya']);
    assert.equal(source.documents[0].metadata.next_node, '92');
    assert.deepEqual(source.documents[1].metadata.branch_path, ['91', '92']);
    assert.doesNotMatch(JSON.stringify(source.documents), /academic\.pdf|private/);
  });

  it('does not split protected URLs, prices, phone numbers, or requirement list items', () => {
    const url = 'https://contoh.id/pendaftaran?program=teknik-informatika&gelombang=dua';
    const text = [
      `Biaya resmi Rp 1.250.000 dan bantuan tersedia di ${url}.`,
      '- KTP asli dan dua lembar fotokopi',
      '- Ijazah terakhir yang telah dilegalisasi',
      '- Hubungi +62 812-3456-7890 untuk verifikasi'
    ].join('\n');
    const chunks = chunkKnowledgeDocuments([{
      documentId: 'manual:requirements',
      text,
      metadata: { source_type: 'manual' }
    }], { minTokens: 10, targetTokens: 20, maxTokens: 35, overlapTokens: 5 });
    const recombined = chunks.map((chunk) => chunk.text).join('\n');

    assert.match(recombined, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(recombined, /Rp 1\.250\.000/);
    assert.match(recombined, /\+62 812-3456-7890/);
    for (const requirement of text.split('\n').slice(1)) {
      assert.ok(chunks.some((chunk) => chunk.text.includes(requirement)));
    }
  });

  it('handles Unicode Indonesian text and validates chunk configuration', () => {
    const text = 'Informasi biaya kuliah, syarat, jadwal, dan layanan mahasiswa—termasuk kelas malam.';
    assert.ok(estimateRagTokens(text) > 0);
    const chunks = chunkKnowledgeDocuments([{
      documentId: 'unicode',
      text,
      metadata: { locale: 'id-ID' }
    }]);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, text);
    assert.throws(
      () => chunkKnowledgeDocuments([], { minTokens: 300, targetTokens: 200 }),
      /Invalid RAG chunk options/
    );
  });
});
