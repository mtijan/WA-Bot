import path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { strFromU8, unzipSync } from 'fflate';
import { config } from '../config.js';

export const CONTACT_IMPORT_MAX_BYTES = config.uploads.contactImportMaxBytes;
export const CONTACT_IMPORT_MAX_ROWS = 10_000;
export const CONTACT_IMPORT_MAX_COLUMNS = 50;
const CONTACT_IMPORT_MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const CONTACT_IMPORT_MAX_CELL_LENGTH = 10_000;

const STANDARD_FIELD_ALIASES = new Map([
  ['nama', 'name'],
  ['name', 'name'],
  ['fullname', 'name'],
  ['full name', 'name'],
  ['no', 'phone_number'],
  ['nomor', 'phone_number'],
  ['phone', 'phone_number'],
  ['phone number', 'phone_number'],
  ['no hp', 'phone_number'],
  ['nomor hp', 'phone_number'],
  ['telepon', 'phone_number'],
  ['telp', 'phone_number'],
  ['handphone', 'phone_number'],
  ['mobile', 'phone_number'],
  ['email', 'email'],
  ['mail', 'email'],
  ['surel', 'email'],
  ['company', 'company'],
  ['perusahaan', 'company'],
  ['instansi', 'company'],
  ['position', 'position'],
  ['jabatan', 'position'],
  ['role', 'position'],
  ['tags', 'tags'],
  ['tag', 'tags'],
  ['kategori', 'tags'],
  ['notes', 'notes'],
  ['note', 'notes'],
  ['catatan', 'notes'],
  ['keterangan', 'notes']
]);

const RESERVED_CUSTOM_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class ContactImportError extends Error {
  constructor(message, errorCode = 'CONTACT_IMPORT_INVALID', statusCode = 400, details = undefined) {
    super(message);
    this.name = 'ContactImportError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function canonicalHeader(value) {
  return normalizeHeader(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('id-ID');
}

export function getStandardFieldForHeader(value) {
  return STANDARD_FIELD_ALIASES.get(canonicalHeader(value)) || null;
}

function decodeXml(value = '') {
  return String(value).replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi,
    (match, decimal, hexadecimal) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      if (match === '&amp;') return '&';
      if (match === '&lt;') return '<';
      if (match === '&gt;') return '>';
      if (match === '&quot;') return '"';
      if (match === '&apos;') return "'";
      return match;
    }
  );
}

function getXmlAttribute(fragment = '', name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fragment.match(new RegExp(`(?:^|\\s)${escapedName}=(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeXml(match[2]) : '';
}

function getXmlTextNodes(fragment = '') {
  const values = [];
  const regex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
  let match;
  while ((match = regex.exec(fragment)) !== null) {
    values.push(decodeXml(match[1]));
  }
  return values.join('');
}

function getXmlElementValue(fragment = '', tagName) {
  const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fragment.match(new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function findZipEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function assertSafeXlsxArchive(buffer) {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new ContactImportError('Berkas XLSX tidak memiliki struktur ZIP yang valid.', 'CONTACT_IMPORT_XLSX_INVALID');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > 1_000 || centralDirectoryOffset >= buffer.length) {
    throw new ContactImportError('Struktur XLSX terlalu kompleks atau tidak valid.', 'CONTACT_IMPORT_XLSX_INVALID');
  }

  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new ContactImportError('Central directory XLSX tidak valid.', 'CONTACT_IMPORT_XLSX_INVALID');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    if ((flags & 0x1) !== 0 || uncompressedBytes === 0xffffffff) {
      throw new ContactImportError('XLSX terenkripsi atau ZIP64 tidak didukung.', 'CONTACT_IMPORT_XLSX_UNSUPPORTED');
    }

    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > CONTACT_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      throw new ContactImportError(
        'Isi XLSX setelah diekstrak melebihi batas aman 25 MB.',
        'CONTACT_IMPORT_XLSX_TOO_LARGE',
        413
      );
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
}

function readZipText(entries, entryName, required = true) {
  const entry = entries[entryName];
  if (!entry) {
    if (!required) return '';
    throw new ContactImportError(`Komponen XLSX tidak ditemukan: ${entryName}.`, 'CONTACT_IMPORT_XLSX_INVALID');
  }
  return strFromU8(entry);
}

function resolveSheet1Entry(entries) {
  const workbookXml = readZipText(entries, 'xl/workbook.xml');
  const relationXml = readZipText(entries, 'xl/_rels/workbook.xml.rels');

  let relationshipId = '';
  const sheetRegex = /<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/gi;
  let sheetMatch;
  while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
    const attributes = sheetMatch[1] || '';
    if (getXmlAttribute(attributes, 'name') === 'Sheet1') {
      relationshipId = getXmlAttribute(attributes, 'r:id');
      break;
    }
  }

  if (!relationshipId) {
    throw new ContactImportError(
      'Worksheet "Sheet1" tidak ditemukan. Sistem hanya membaca Sheet1.',
      'CONTACT_IMPORT_SHEET1_REQUIRED'
    );
  }

  let target = '';
  const relationshipRegex = /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/gi;
  let relationshipMatch;
  while ((relationshipMatch = relationshipRegex.exec(relationXml)) !== null) {
    const attributes = relationshipMatch[1] || '';
    if (getXmlAttribute(attributes, 'Id') === relationshipId) {
      target = getXmlAttribute(attributes, 'Target');
      break;
    }
  }

  if (!target) {
    throw new ContactImportError('Relasi worksheet Sheet1 tidak valid.', 'CONTACT_IMPORT_XLSX_INVALID');
  }

  const normalizedTarget = target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalizedTarget.includes('..')) {
    throw new ContactImportError('Path worksheet XLSX tidak aman.', 'CONTACT_IMPORT_XLSX_INVALID');
  }
  return normalizedTarget.startsWith('xl/') ? normalizedTarget : `xl/${normalizedTarget}`;
}

function readSharedStrings(entries) {
  const xml = readZipText(entries, 'xl/sharedStrings.xml', false);
  if (!xml) return [];

  const values = [];
  const regex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    values.push(getXmlTextNodes(match[1]));
  }
  return values;
}

function readDateStyles(entries) {
  const stylesXml = readZipText(entries, 'xl/styles.xml', false);
  if (!stylesXml) return new Set();

  const customFormats = new Map();
  const numFmtRegex = /<numFmt\b([^>]*?)(?:\/>|>[\s\S]*?<\/numFmt>)/gi;
  let numFmtMatch;
  while ((numFmtMatch = numFmtRegex.exec(stylesXml)) !== null) {
    const id = Number.parseInt(getXmlAttribute(numFmtMatch[1], 'numFmtId'), 10);
    const code = getXmlAttribute(numFmtMatch[1], 'formatCode');
    if (Number.isFinite(id)) customFormats.set(id, code);
  }

  const dateFormatIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] || '';
  const dateStyleIndexes = new Set();
  const xfRegex = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/gi;
  let xfMatch;
  let styleIndex = 0;

  while ((xfMatch = xfRegex.exec(cellXfs)) !== null) {
    const numFmtId = Number.parseInt(getXmlAttribute(xfMatch[1], 'numFmtId'), 10);
    const customFormat = customFormats.get(numFmtId) || '';
    const normalizedFormat = customFormat
      .replace(/"[^"]*"/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\\./g, '');
    if (dateFormatIds.has(numFmtId) || /[dmyhs]/i.test(normalizedFormat)) {
      dateStyleIndexes.add(styleIndex);
    }
    styleIndex += 1;
  }

  return dateStyleIndexes;
}

function formatExcelSerialDate(value, date1904) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return String(value);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial * 86_400_000));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hasTime = Math.abs(serial - Math.trunc(serial)) > Number.EPSILON;
  if (!hasTime) return `${day}/${month}/${year}`;
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function columnIndexFromReference(reference = '') {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters) index = (index * 26) + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readXlsxRows(buffer) {
  assertSafeXlsxArchive(buffer);
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new ContactImportError('Berkas XLSX rusak atau tidak dapat diekstrak.', 'CONTACT_IMPORT_XLSX_INVALID');
  }

  const workbookXml = readZipText(entries, 'xl/workbook.xml');
  const date1904 = /<workbookPr\b[^>]*\bdate1904=(["'])(?:1|true)\1/i.test(workbookXml);
  const sheetEntry = resolveSheet1Entry(entries);
  const sheetXml = readZipText(entries, sheetEntry);
  const sharedStrings = readSharedStrings(entries);
  const dateStyles = readDateStyles(entries);

  const rows = [];
  let formulaCells = 0;
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    if (rows.length > CONTACT_IMPORT_MAX_ROWS) {
      throw new ContactImportError(
        `Sheet1 melebihi batas ${CONTACT_IMPORT_MAX_ROWS.toLocaleString('id-ID')} baris data.`,
        'CONTACT_IMPORT_TOO_MANY_ROWS',
        413
      );
    }

    const rowNumber = Number.parseInt(getXmlAttribute(rowMatch[1], 'r'), 10) || rows.length + 1;
    const values = [];
    let sequentialIndex = 0;
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[2])) !== null) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const reference = getXmlAttribute(attributes, 'r');
      const index = columnIndexFromReference(reference);
      const columnIndex = index >= 0 ? index : sequentialIndex;
      sequentialIndex = columnIndex + 1;
      if (columnIndex >= CONTACT_IMPORT_MAX_COLUMNS) {
        throw new ContactImportError(
          `Jumlah kolom maksimal ${CONTACT_IMPORT_MAX_COLUMNS}.`,
          'CONTACT_IMPORT_TOO_MANY_COLUMNS'
        );
      }

      const type = getXmlAttribute(attributes, 't');
      const styleIndex = Number.parseInt(getXmlAttribute(attributes, 's'), 10);
      const rawValue = getXmlElementValue(body, 'v');
      const hasFormula = /<f\b/i.test(body);
      if (hasFormula) formulaCells += 1;

      let value = '';
      if (type === 's') {
        value = sharedStrings[Number.parseInt(rawValue, 10)] ?? '';
      } else if (type === 'inlineStr') {
        value = getXmlTextNodes(body);
      } else if (type === 'b') {
        value = rawValue === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        value = '';
      } else if (type === 'd') {
        value = rawValue;
      } else if (dateStyles.has(styleIndex) && rawValue !== '') {
        value = formatExcelSerialDate(rawValue, date1904);
      } else {
        value = rawValue;
      }

      values[columnIndex] = String(value ?? '').slice(0, CONTACT_IMPORT_MAX_CELL_LENGTH);
    }

    rows.push({ rowNumber, values });
  }

  return { rows, formulaCells, sourceSheet: 'Sheet1' };
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t'];
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function readCsvRows(buffer) {
  const text = buffer.toString('utf8');
  if (text.includes('\u0000')) {
    throw new ContactImportError('CSV harus menggunakan encoding teks UTF-8.', 'CONTACT_IMPORT_CSV_INVALID');
  }

  let records;
  try {
    records = parseCsv(text, {
      bom: true,
      delimiter: detectCsvDelimiter(text),
      relax_column_count: true,
      relax_quotes: false,
      skip_empty_lines: false,
      max_record_size: 100_000
    });
  } catch (error) {
    throw new ContactImportError(
      `CSV tidak valid: ${error.message}`,
      'CONTACT_IMPORT_CSV_INVALID'
    );
  }

  if (records.length - 1 > CONTACT_IMPORT_MAX_ROWS) {
    throw new ContactImportError(
      `CSV melebihi batas ${CONTACT_IMPORT_MAX_ROWS.toLocaleString('id-ID')} baris data.`,
      'CONTACT_IMPORT_TOO_MANY_ROWS',
      413
    );
  }
  if (records.some((record) => record.length > CONTACT_IMPORT_MAX_COLUMNS)) {
    throw new ContactImportError(
      `Jumlah kolom maksimal ${CONTACT_IMPORT_MAX_COLUMNS}.`,
      'CONTACT_IMPORT_TOO_MANY_COLUMNS'
    );
  }

  return {
    rows: records.map((values, index) => ({
      rowNumber: index + 1,
      values: values.slice(0, CONTACT_IMPORT_MAX_COLUMNS).map((value) =>
        String(value ?? '').slice(0, CONTACT_IMPORT_MAX_CELL_LENGTH)
      )
    })),
    formulaCells: 0,
    sourceSheet: 'CSV'
  };
}

function expandScientificNotation(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!match) return text;

  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2];
  const fraction = match[3] || '';
  const exponent = Number.parseInt(match[4], 10);
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  const decimalPosition = whole.length + exponent;

  if (decimalPosition <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(decimalPosition))}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function canonicalPhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

function buildHeaderDefinitions(headerValues) {
  const headers = [];
  const seen = new Set();
  const seenStandardFields = new Set();
  let hasPhone = false;

  for (let index = 0; index < headerValues.length; index += 1) {
    const name = normalizeHeader(headerValues[index]);
    if (!name) continue;
    const key = canonicalHeader(name);
    if (seen.has(key)) {
      throw new ContactImportError(
        `Header duplikat ditemukan: "${name}".`,
        'CONTACT_IMPORT_DUPLICATE_HEADER'
      );
    }
    const reservedKey = name.toLocaleLowerCase('id-ID');
    if (RESERVED_CUSTOM_KEYS.has(reservedKey)) {
      throw new ContactImportError(
        `Header "${name}" tidak diizinkan.`,
        'CONTACT_IMPORT_HEADER_NOT_ALLOWED'
      );
    }
    seen.add(key);

    const standardField = getStandardFieldForHeader(name);
    if (standardField && seenStandardFields.has(standardField)) {
      throw new ContactImportError(
        `Lebih dari satu header dipetakan ke field standar "${standardField}".`,
        'CONTACT_IMPORT_DUPLICATE_STANDARD_FIELD'
      );
    }
    if (standardField) seenStandardFields.add(standardField);
    if (standardField === 'phone_number') hasPhone = true;
    headers.push({ index, name, standardField });
  }

  if (headers.length === 0) {
    throw new ContactImportError('Baris pertama harus berisi header.', 'CONTACT_IMPORT_HEADER_REQUIRED');
  }
  if (headers.length > CONTACT_IMPORT_MAX_COLUMNS) {
    throw new ContactImportError(
      `Jumlah header maksimal ${CONTACT_IMPORT_MAX_COLUMNS}.`,
      'CONTACT_IMPORT_TOO_MANY_COLUMNS'
    );
  }
  if (!hasPhone) {
    throw new ContactImportError(
      'Header nomor telepon tidak ditemukan. Gunakan "No", "Phone", atau "Phone Number".',
      'CONTACT_IMPORT_PHONE_HEADER_REQUIRED'
    );
  }

  return headers;
}

function buildContactRows(parsedRows, formulaCells, sourceSheet) {
  const headerRow = parsedRows[0];
  if (!headerRow) {
    throw new ContactImportError('File kosong.', 'CONTACT_IMPORT_EMPTY');
  }
  const headers = buildHeaderDefinitions(headerRow.values);
  const customFields = headers.filter((header) => !header.standardField).map((header) => header.name);
  const presentStandardFields = [...new Set(
    headers.filter((header) => header.standardField).map((header) => header.standardField)
  )];

  const contacts = [];
  const invalidRows = [];
  const duplicateRows = [];
  const seenPhones = new Set();
  let dataRows = 0;

  for (const parsedRow of parsedRows.slice(1)) {
    const hasValue = headers.some(({ index }) => String(parsedRow.values[index] ?? '').trim() !== '');
    if (!hasValue) continue;
    dataRows += 1;

    const standard = Object.create(null);
    const custom = Object.create(null);
    for (const header of headers) {
      const value = String(parsedRow.values[header.index] ?? '').trim();
      if (header.standardField) standard[header.standardField] = value;
      else custom[header.name] = value;
    }

    const expandedPhone = expandScientificNotation(standard.phone_number || '');
    const phoneNumber = canonicalPhoneNumber(expandedPhone);
    if (phoneNumber.length < 8 || phoneNumber.length > 16) {
      invalidRows.push({
        row: parsedRow.rowNumber,
        reason: 'Nomor telepon tidak valid.'
      });
      continue;
    }

    if (seenPhones.has(phoneNumber)) {
      duplicateRows.push({
        row: parsedRow.rowNumber,
        phone_number: phoneNumber,
        reason: 'Nomor duplikat di dalam file.'
      });
      continue;
    }
    seenPhones.add(phoneNumber);

    contacts.push({
      source_row: parsedRow.rowNumber,
      name: standard.name || `Contact-${phoneNumber}`,
      phone_number: phoneNumber,
      email: standard.email || '',
      company: standard.company || '',
      position: standard.position || '',
      tags: standard.tags || '',
      notes: standard.notes || '',
      custom_fields: { ...custom }
    });
  }

  return {
    source_sheet: sourceSheet,
    headers: headers.map(({ name, standardField }) => ({
      name,
      type: standardField ? 'standard' : 'custom',
      field: standardField
    })),
    standard_fields: presentStandardFields,
    custom_fields: customFields,
    counts: {
      total_rows: dataRows,
      valid_rows: contacts.length,
      invalid_rows: invalidRows.length,
      duplicate_rows: duplicateRows.length,
      formula_cells_ignored: formulaCells
    },
    preview: contacts.slice(0, 20),
    invalid_rows: invalidRows.slice(0, 50),
    duplicate_rows: duplicateRows.slice(0, 50),
    contacts
  };
}

export function parseContactImportFile(file) {
  if (!file?.buffer || !file.originalname) {
    throw new ContactImportError('File Excel/CSV wajib disertakan.', 'CONTACT_IMPORT_FILE_REQUIRED');
  }
  if (file.size > CONTACT_IMPORT_MAX_BYTES) {
    const maxMegabytes = Math.ceil(CONTACT_IMPORT_MAX_BYTES / (1024 * 1024));
    throw new ContactImportError(`Ukuran file maksimal ${maxMegabytes} MB.`, 'CONTACT_IMPORT_FILE_TOO_LARGE', 413);
  }

  const extension = path.extname(file.originalname).toLocaleLowerCase('en-US');
  let parsed;
  if (extension === '.xlsx') {
    const signature = file.buffer.subarray(0, 4);
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    if (!isZip) {
      throw new ContactImportError('Berkas tidak memiliki format XLSX yang valid.', 'CONTACT_IMPORT_XLSX_INVALID');
    }
    parsed = readXlsxRows(file.buffer);
  } else if (extension === '.csv') {
    parsed = readCsvRows(file.buffer);
  } else {
    throw new ContactImportError(
      'Hanya file .xlsx dan .csv yang didukung.',
      'CONTACT_IMPORT_TYPE_NOT_ALLOWED'
    );
  }

  return buildContactRows(parsed.rows, parsed.formulaCells, parsed.sourceSheet);
}
