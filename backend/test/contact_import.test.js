import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { cleanupTestDb, getTestAgent } from './helpers/test_app.js';
import { parseContactImportFile } from '../src/services/contact_import.service.js';

after(() => cleanupTestDb());

function createSheet1WorkbookBuffer({ sheetName = 'Sheet1' } = {}) {
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`;
  const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
        Target="worksheets/sheet1.xml"/>
    </Relationships>`;
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>Nama</t></is></c>
          <c r="B1" t="inlineStr"><is><t>No</t></is></c>
          <c r="C1" t="inlineStr"><is><t>NIM</t></is></c>
          <c r="D1" t="inlineStr"><is><t>No Rek</t></is></c>
          <c r="E1" t="inlineStr"><is><t>Jumlah</t></is></c>
          <c r="F1" t="inlineStr"><is><t>Jatuh Tempo</t></is></c>
        </row>
        <row r="2">
          <c r="A2" t="inlineStr"><is><t>Alya</t></is></c>
          <c r="B2" t="inlineStr"><is><t>081234567890</t></is></c>
          <c r="C2" t="inlineStr"><is><t>2026001</t></is></c>
          <c r="D2" t="inlineStr"><is><t>123456789</t></is></c>
          <c r="E2"><v>150000</v></c>
          <c r="F2" t="inlineStr"><is><t>31/07/2026</t></is></c>
        </row>
      </sheetData>
    </worksheet>`;

  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(relationshipsXml),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml)
  }));
}

describe('Contact Excel/CSV import parser', () => {
  it('membaca Sheet1 dan mempertahankan header non-standar sebagai custom variables', () => {
    const buffer = createSheet1WorkbookBuffer();
    const result = parseContactImportFile({
      buffer,
      size: buffer.length,
      originalname: 'contacts.xlsx'
    });

    assert.equal(result.source_sheet, 'Sheet1');
    assert.deepEqual(result.custom_fields, ['NIM', 'No Rek', 'Jumlah', 'Jatuh Tempo']);
    assert.equal(result.counts.valid_rows, 1);
    assert.equal(result.contacts[0].phone_number, '6281234567890');
    assert.deepEqual(result.contacts[0].custom_fields, {
      NIM: '2026001',
      'No Rek': '123456789',
      Jumlah: '150000',
      'Jatuh Tempo': '31/07/2026'
    });
  });

  it('menolak workbook yang tidak memiliki worksheet bernama Sheet1', () => {
    const buffer = createSheet1WorkbookBuffer({ sheetName: 'Data' });
    assert.throws(
      () => parseContactImportFile({ buffer, size: buffer.length, originalname: 'contacts.xlsx' }),
      (error) => error.errorCode === 'CONTACT_IMPORT_SHEET1_REQUIRED'
    );
  });

  it('mendeteksi CSV semicolon dan nomor duplikat', () => {
    const buffer = Buffer.from(
      'Nama;No;NIM\r\nAlya;081234567890;2026001\r\nAlya Duplikat;6281234567890;2026002\r\n',
      'utf8'
    );
    const result = parseContactImportFile({
      buffer,
      size: buffer.length,
      originalname: 'contacts.csv'
    });

    assert.equal(result.counts.valid_rows, 1);
    assert.equal(result.counts.duplicate_rows, 1);
    assert.equal(result.contacts[0].custom_fields.NIM, '2026001');
  });
});

describe('Contact import API', () => {
  it('preview dan import menyimpan custom variables lalu memperbarui nomor yang sama', async () => {
    const agent = await getTestAgent();
    const { dbRun, dbGet } = await import('../src/database.js');
    const groupResult = await dbRun(
      "INSERT INTO contact_groups (name, user_id) VALUES ('Import Group', 1)"
    );
    const firstCsv = Buffer.from(
      'Nama,No,NIM,No Rek,Jumlah,Jatuh Tempo\r\nAlya,081234567890,2026001,123456789,150000,31/07/2026\r\n',
      'utf8'
    );

    const previewResponse = await agent
      .post('/api/contacts/import/preview')
      .field('group_id', String(groupResult.id))
      .attach('file', firstCsv, 'contacts.csv');
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.body.data.counts.valid_rows, 1);
    assert.deepEqual(previewResponse.body.data.custom_fields, ['NIM', 'No Rek', 'Jumlah', 'Jatuh Tempo']);

    const importResponse = await agent
      .post('/api/contacts/import')
      .field('group_id', String(groupResult.id))
      .field('duplicate_mode', 'update')
      .attach('file', firstCsv, 'contacts.csv');
    assert.equal(importResponse.status, 201);
    assert.equal(importResponse.body.data.inserted, 1);

    const secondCsv = Buffer.from(
      'Nama,No,NIM,Jumlah\r\nAlya Baru,6281234567890,2026001,175000\r\n',
      'utf8'
    );
    const updateResponse = await agent
      .post('/api/contacts/import')
      .field('group_id', String(groupResult.id))
      .field('duplicate_mode', 'update')
      .attach('file', secondCsv, 'contacts.csv');
    assert.equal(updateResponse.status, 201);
    assert.equal(updateResponse.body.data.updated, 1);

    const stored = await dbGet(
      'SELECT name, phone_number, custom_fields, status FROM contacts WHERE group_id = ?',
      [groupResult.id]
    );
    assert.equal(stored.name, 'Alya Baru');
    assert.equal(stored.phone_number, '6281234567890');
    assert.equal(stored.status, 'UNVERIFIED');
    assert.deepEqual(JSON.parse(stored.custom_fields), {
      NIM: '2026001',
      'No Rek': '123456789',
      Jumlah: '175000',
      'Jatuh Tempo': '31/07/2026'
    });
  });
});
