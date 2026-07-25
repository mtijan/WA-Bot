import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { isValidSessionId, resolveSessionDirectory } from '../src/utils/session_id.js';

describe('Session ID filesystem security', () => {
  it('menerima ID sesi kompatibel yang aman', () => {
    assert.equal(isValidSessionId('kartu-xl_01'), true);
    assert.equal(isValidSessionId('session_1771258347453_d9eig11qr'), true);
  });

  it('menolak traversal, separator path, dot, spasi, dan ID terlalu panjang', () => {
    for (const value of ['..', '../uploads', '..\\uploads', '.', 'session name', 'a'.repeat(65)]) {
      assert.equal(isValidSessionId(value), false, `Seharusnya ditolak: ${value}`);
    }
  });

  it('selalu meresolusi direktori valid di bawah root sessions', () => {
    const root = path.resolve('safe-session-root');
    const resolved = resolveSessionDirectory(root, 'tenant-session_01');
    assert.equal(path.dirname(resolved), root);
    assert.equal(path.basename(resolved), 'tenant-session_01');
  });

  it('melempar error sebelum path traversal dapat diresolusi', () => {
    assert.throws(
      () => resolveSessionDirectory(path.resolve('safe-session-root'), '../outside'),
      (error) => error?.code === 'INVALID_SESSION_ID' && error?.statusCode === 400
    );
  });
});
