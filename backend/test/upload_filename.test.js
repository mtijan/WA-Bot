import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMediaFilename } from '../src/services/upload_metadata.service.js';
import { getFileNameFromUrl, getMediaSource } from '../src/services/whatsapp.helpers.js';

describe('Preservasi Nama Berkas Media', () => {
  describe('createMediaFilename', () => {
    it('seharusnya menghasilkan nama berkas yang mengandung nama asli yang disanitasi', () => {
      const mockFile = {
        originalname: 'FORMULIR PENDAFTARAN MAHASISWA BARU.pdf',
        mimetype: 'application/pdf'
      };
      
      const generatedFilename = createMediaFilename(mockFile);
      
      // Memverifikasi nama berkas mengandung format: timestamp-uuid-FORMULIR_PENDAFTARAN_MAHASISWA_BARU.pdf
      assert.ok(generatedFilename.includes('FORMULIR PENDAFTARAN MAHASISWA BARU'), `Nama berkas '${generatedFilename}' tidak mengandung nama asli`);
      assert.ok(generatedFilename.endsWith('.pdf'), 'Ekstensi berkas tidak sesuai');
    });

    it('seharusnya mensanitasi karakter ilegal Windows dan slash', () => {
      const mockFile = {
        originalname: 'folder/subfolder/file:*?<>|name.bin',
        mimetype: 'application/octet-stream'
      };
      
      const generatedFilename = createMediaFilename(mockFile);
      
      // Memverifikasi karakter ilegal dihapus/diganti
      assert.ok(!generatedFilename.includes(':'), 'Karakter titik dua seharusnya dihapus');
      assert.ok(!generatedFilename.includes('*'), 'Karakter asterisk seharusnya dihapus');
      assert.ok(!generatedFilename.includes('?'), 'Karakter tanda tanya seharusnya dihapus');
      assert.ok(!generatedFilename.includes('<'), 'Karakter kurang dari seharusnya dihapus');
      assert.ok(!generatedFilename.includes('>'), 'Karakter lebih dari seharusnya dihapus');
      assert.ok(!generatedFilename.includes('|'), 'Karakter pipe seharusnya dihapus');
      
      // Slashes diganti dengan underscore oleh regex [\/\\]
      assert.ok(!generatedFilename.includes('/'), 'Slash seharusnya disanitasi');
      assert.ok(generatedFilename.endsWith('.bin'), 'Ekstensi berkas tidak sesuai');
    });
  });

  describe('getFileNameFromUrl', () => {
    it('seharusnya mengekstrak nama berkas asli dari nama terunggah berskema UUID', () => {
      const url = 'http://localhost:3001/api/uploads/media/1781409608992-7b13f683-c7c3-4cf9-86bf-3b76fc2400b-FORMULIR PENDAFTARAN MAHASISWA BARU.pdf';
      const extracted = getFileNameFromUrl(url);
      
      assert.equal(extracted, 'FORMULIR PENDAFTARAN MAHASISWA BARU.pdf');
    });

    it('seharusnya merekonstruksi nama berkas asli yang mengandung tanda hubung', () => {
      const url = '/api/uploads/media/1781409608992-7b13f683-c7c3-4cf9-86bf-3b76fc2400b-my-doc-v2.pdf';
      const extracted = getFileNameFromUrl(url);
      
      assert.equal(extracted, 'my-doc-v2.pdf');
    });

    it('seharusnya kompatibel dengan format lama tanpa nama asli (mengembalikan nama lengkap berkas)', () => {
      const url = '/api/uploads/media/1781409608992-7b13f683-c7c3-4cf9-86bf-3b76fc2400b.pdf';
      const extracted = getFileNameFromUrl(url);
      
      assert.equal(extracted, '1781409608992-7b13f683-c7c3-4cf9-86bf-3b76fc2400b.pdf');
    });

    it('seharusnya mengembalikan nama default jika URL kosong/null', () => {
      assert.equal(getFileNameFromUrl('', 'Fallback.pdf'), 'Fallback.pdf');
      assert.equal(getFileNameFromUrl(null, 'Fallback.pdf'), 'Fallback.pdf');
    });
  });

  describe('getMediaSource security boundary', () => {
    it('hanya membaca file reguler di dalam root upload terkelola', () => {
      const testRoot = mkdtempSync(join(tmpdir(), 'wa-bot-media-root-'));
      const managedFile = join(testRoot, 'managed.txt');
      writeFileSync(managedFile, 'managed-media-test', 'utf8');

      try {
        const source = getMediaSource(managedFile, { mediaRoot: testRoot });
        assert.ok(Buffer.isBuffer(source));
        assert.equal(source.toString('utf8'), 'managed-media-test');
      } finally {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });

    it('menolak pembacaan file lokal di luar root upload', () => {
      const testRoot = mkdtempSync(join(tmpdir(), 'wa-bot-media-root-'));
      const outsideRoot = mkdtempSync(join(tmpdir(), 'wa-bot-media-outside-'));
      const outsideFile = join(outsideRoot, 'secret.txt');
      writeFileSync(outsideFile, 'must-not-be-readable', 'utf8');

      try {
        assert.throws(
          () => getMediaSource(outsideFile, { mediaRoot: testRoot }),
          (error) => error?.code === 'UNSAFE_MEDIA_SOURCE'
        );
      } finally {
        rmSync(testRoot, { recursive: true, force: true });
        rmSync(outsideRoot, { recursive: true, force: true });
      }
    });

    it('menolak URL remote agar tidak menjadi SSRF', () => {
      const testRoot = mkdtempSync(join(tmpdir(), 'wa-bot-media-root-'));
      try {
        assert.throws(
          () => getMediaSource('http://127.0.0.1:3002/internal/health/ready', { mediaRoot: testRoot }),
          (error) => error?.code === 'UNSAFE_MEDIA_SOURCE'
        );
      } finally {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });
  });
});
