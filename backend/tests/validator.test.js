import { test } from 'node:test';
import assert from 'node:assert';
import { validate } from '../src/utils/validator.js';

test('Validator - Aturan Required', () => {
  const rules = {
    name: { required: true }
  };

  // Kasus data valid
  const errorsValid = validate({ name: 'WA-Bot' }, rules);
  assert.strictEqual(errorsValid, null);

  // Kasus data kosong / tidak ada
  const errorsMissing = validate({}, rules);
  assert.deepStrictEqual(errorsMissing, { name: 'name wajib diisi.' });

  // Kasus data string kosong
  const errorsEmpty = validate({ name: '' }, rules);
  assert.deepStrictEqual(errorsEmpty, { name: 'name wajib diisi.' });
});

test('Validator - Aturan Tipe Data', () => {
  const rules = {
    age: { type: 'number' },
    tags: { type: 'array' },
    active: { type: 'boolean' }
  };

  // Kasus tipe data valid
  const errorsValid = validate({ age: 25, tags: ['wa', 'bot'], active: true }, rules);
  assert.strictEqual(errorsValid, null);

  // Kasus tipe data salah
  const errorsInvalid = validate({ age: 'duapuluh', tags: 'bukan-array', active: 'yes' }, rules);
  assert.deepStrictEqual(errorsInvalid, {
    age: 'age harus berupa angka.',
    tags: 'tags harus berupa array.',
    active: 'active harus berupa boolean.'
  });
});

test('Validator - Rentang Nilai Min/Max', () => {
  const rules = {
    phone: { type: 'string', min: 10, max: 13 },
    count: { type: 'number', min: 1, max: 5 }
  };

  // Kasus valid
  const errorsValid = validate({ phone: '08123456789', count: 3 }, rules);
  assert.strictEqual(errorsValid, null);

  // Kasus melanggar batas min
  const errorsUnder = validate({ phone: '0812', count: 0 }, rules);
  assert.deepStrictEqual(errorsUnder, {
    phone: 'phone minimal 10 karakter.',
    count: 'count minimal bernilai 1.'
  });

  // Kasus melanggar batas max
  const errorsOver = validate({ phone: '0812345678901234', count: 6 }, rules);
  assert.deepStrictEqual(errorsOver, {
    phone: 'phone maksimal 13 karakter.',
    count: 'count maksimal bernilai 5.'
  });
});

test('Validator - Aturan AllowedValues (Enum)', () => {
  const rules = {
    role: { allowedValues: ['admin', 'user'] }
  };

  // Kasus valid
  const errorsValid = validate({ role: 'admin' }, rules);
  assert.strictEqual(errorsValid, null);

  // Kasus tidak valid
  const errorsInvalid = validate({ role: 'superadmin' }, rules);
  assert.deepStrictEqual(errorsInvalid, {
    role: 'role bernilai tidak valid. Harus salah satu dari: admin, user.'
  });
});

test('Validator - Pengujian Regex (matches)', () => {
  const rules = {
    email: { matches: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
  };

  // Kasus valid
  const errorsValid = validate({ email: 'test@example.com' }, rules);
  assert.strictEqual(errorsValid, null);

  // Kasus tidak valid
  const errorsInvalid = validate({ email: 'email-tidak-valid' }, rules);
  assert.deepStrictEqual(errorsInvalid, {
    email: 'email format tidak sesuai.'
  });
});
