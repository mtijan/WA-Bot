import { test } from 'node:test';
import assert from 'node:assert';
import { sendSuccess, sendError } from '../src/utils/http_response.js';

// Helper mock untuk objek Express Response
function createMockResponse() {
  const res = {
    _status: null,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(obj) {
      this._json = obj;
      return this;
    }
  };
  return res;
}

test('HTTP Response - sendSuccess', () => {
  const res = createMockResponse();

  // Test sendSuccess dasar
  sendSuccess(res, { foo: 'bar' });
  assert.strictEqual(res._status, 200);
  assert.deepStrictEqual(res._json, {
    status: 'success',
    data: { foo: 'bar' }
  });

  // Test sendSuccess dengan status kustom
  sendSuccess(res, undefined, 201);
  assert.strictEqual(res._status, 201);
  assert.deepStrictEqual(res._json, {
    status: 'success'
  });

  // Test sendSuccess dengan data dan extra fields
  sendSuccess(res, { list: [] }, 200, { total: 0 });
  assert.deepStrictEqual(res._json, {
    status: 'success',
    data: { list: [] },
    total: 0
  });
});

test('HTTP Response - sendError', () => {
  const res = createMockResponse();

  // Test sendError dasar
  sendError(res, 400, 'BAD_REQUEST', 'Permintaan tidak valid');
  assert.strictEqual(res._status, 400);
  assert.deepStrictEqual(res._json, {
    status: 'error',
    error_code: 'BAD_REQUEST',
    message: 'Permintaan tidak valid'
  });

  // Test sendError dengan detail tambahan (seperti error validasi)
  sendError(res, 422, 'VALIDATION_ERROR', 'Validasi gagal', { field: 'wajib diisi' });
  assert.strictEqual(res._status, 422);
  assert.deepStrictEqual(res._json, {
    status: 'error',
    error_code: 'VALIDATION_ERROR',
    message: 'Validasi gagal',
    details: { field: 'wajib diisi' }
  });
});
