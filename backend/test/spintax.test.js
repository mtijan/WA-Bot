import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpintax } from '../src/services/whatsapp.service.js';

describe('parseSpintax', () => {
  it('seharusnya mengembalikan teks asli jika tidak ada spintax', () => {
    const text = 'Halo ini pesan biasa tanpa spintax.';
    assert.equal(parseSpintax(text), text);
  });

  it('seharusnya memilih salah satu opsi spintax secara acak', () => {
    const text = '{Halo|Hai|Hallo} kawan!';
    const parsed = parseSpintax(text);
    
    // Hasil parse harus merupakan salah satu dari tiga kemungkinan
    assert.ok(
      parsed === 'Halo kawan!' || 
      parsed === 'Hai kawan!' || 
      parsed === 'Hallo kawan!',
      `Hasil '${parsed}' tidak sesuai dengan opsi spintax`
    );
  });

  it('seharusnya mengabaikan template variabel double-curly braces {{name}} dengan aman', () => {
    const text = '{Halo|Hai} {{name}}, selamat {pagi|siang}!';
    const parsed = parseSpintax(text);

    // Variabel {{name}} harus tetap utuh dan tidak terpotong atau terubah
    assert.ok(parsed.includes('{{name}}'), 'Variabel {{name}} seharusnya tetap ada');
    
    // Bagian spintax harus berhasil diparse
    assert.ok(
      parsed.startsWith('Halo ') || parsed.startsWith('Hai '),
      `Awalan '${parsed}' seharusnya diparse dari spintax`
    );
    assert.ok(
      parsed.endsWith('pagi!') || parsed.endsWith('siang!'),
      `Akhiran '${parsed}' seharusnya diparse dari spintax`
    );
  });

  it('seharusnya mengabaikan kurung kurawal tunggal yang bukan spintax (tidak mengandung karakter pipe)', () => {
    const text = 'Silakan baca {panduan} ini.';
    assert.equal(parseSpintax(text), text, 'Kurung kurawal tanpa pipe tidak boleh diparse');
  });

  it('seharusnya menangani beberapa spintax sejajar dengan benar', () => {
    const text = '{A|B} dan {C|D}';
    const parsed = parseSpintax(text);

    assert.ok(
      parsed === 'A dan C' ||
      parsed === 'A dan D' ||
      parsed === 'B dan C' ||
      parsed === 'B dan D',
      `Hasil '${parsed}' tidak valid untuk double spintax`
    );
  });
});
