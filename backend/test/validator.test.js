import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import langsung tanpa perlu database
import { validate } from '../src/utils/validator.js';

describe('validate()', () => {
  it('mengembalikan null untuk data valid tanpa aturan', () => {
    const result = validate({ name: 'Test' }, {});
    assert.equal(result, null);
  });

  it('mengembalikan null untuk data valid dengan aturan required', () => {
    const result = validate({ name: 'Hello' }, {
      name: { required: true, type: 'string' }
    });
    assert.equal(result, null);
  });

  it('mengembalikan error untuk field required yang kosong', () => {
    const result = validate({}, {
      name: { required: true, type: 'string' }
    });
    assert.notEqual(result, null);
    assert.ok(result.name);
  });

  it('mengembalikan error untuk field required bernilai string kosong', () => {
    const result = validate({ name: '' }, {
      name: { required: true, type: 'string' }
    });
    assert.notEqual(result, null);
    assert.ok(result.name);
  });

  it('mengembalikan error untuk tipe data yang salah (string bukan number)', () => {
    const result = validate({ count: 'bukan-angka' }, {
      count: { type: 'number' }
    });
    assert.notEqual(result, null);
    assert.ok(result.count);
  });

  it('mengembalikan null untuk angka valid', () => {
    const result = validate({ count: 42 }, {
      count: { type: 'number' }
    });
    assert.equal(result, null);
  });

  it('mengembalikan null untuk string angka valid (koersi number)', () => {
    const result = validate({ count: '10' }, {
      count: { type: 'number' }
    });
    assert.equal(result, null);
  });

  it('mengembalikan error untuk string terlalu pendek', () => {
    const result = validate({ name: 'AB' }, {
      name: { type: 'string', min: 3 }
    });
    assert.notEqual(result, null);
    assert.ok(result.name);
  });

  it('mengembalikan error untuk string terlalu panjang', () => {
    const result = validate({ name: 'A'.repeat(101) }, {
      name: { type: 'string', max: 100 }
    });
    assert.notEqual(result, null);
    assert.ok(result.name);
  });

  it('mengembalikan error untuk nilai di luar allowedValues', () => {
    const result = validate({ type: 'unknown' }, {
      type: { type: 'string', allowedValues: ['text', 'image', 'video'] }
    });
    assert.notEqual(result, null);
    assert.ok(result.type);
  });

  it('mengembalikan null untuk nilai yang ada dalam allowedValues', () => {
    const result = validate({ type: 'image' }, {
      type: { type: 'string', allowedValues: ['text', 'image', 'video'] }
    });
    assert.equal(result, null);
  });

  it('mengembalikan error untuk format regex yang tidak cocok', () => {
    const result = validate({ phone: 'bukan-nomor' }, {
      phone: { type: 'string', matches: /^\d+$/ }
    });
    assert.notEqual(result, null);
    assert.ok(result.phone);
  });

  it('mengembalikan null untuk format regex yang cocok', () => {
    const result = validate({ phone: '628123456789' }, {
      phone: { type: 'string', matches: /^\d+$/ }
    });
    assert.equal(result, null);
  });

  it('mengembalikan error untuk array yang bukan array', () => {
    const result = validate({ items: 'bukan-array' }, {
      items: { type: 'array' }
    });
    assert.notEqual(result, null);
    assert.ok(result.items);
  });

  it('mengembalikan null untuk array valid', () => {
    const result = validate({ items: [1, 2, 3] }, {
      items: { type: 'array' }
    });
    assert.equal(result, null);
  });

  it('mengembalikan error untuk array lebih pendek dari min', () => {
    const result = validate({ items: [1] }, {
      items: { type: 'array', min: 2 }
    });
    assert.notEqual(result, null);
    assert.ok(result.items);
  });

  it('mengembalikan error untuk custom validator', () => {
    const result = validate({ value: 'test' }, {
      value: { custom: (v) => v === 'test' ? 'Nilai tidak boleh test.' : null }
    });
    assert.notEqual(result, null);
    assert.equal(result.value, 'Nilai tidak boleh test.');
  });

  it('mengembalikan null untuk custom validator yang lolos', () => {
    const result = validate({ value: 'valid' }, {
      value: { custom: (v) => v === 'test' ? 'Nilai tidak boleh test.' : null }
    });
    assert.equal(result, null);
  });

  it('mengabaikan field opsional yang tidak disertakan', () => {
    const result = validate({}, {
      optional_field: { type: 'string', min: 3 }
    });
    assert.equal(result, null);
  });

  it('menangkap banyak error sekaligus', () => {
    const result = validate({}, {
      name: { required: true },
      phone: { required: true }
    });
    assert.notEqual(result, null);
    assert.ok(result.name);
    assert.ok(result.phone);
  });
});
