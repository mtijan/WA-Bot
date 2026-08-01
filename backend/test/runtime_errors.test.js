import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientBaileysConnectionClosed } from '../src/utils/runtime_errors.js';

describe('Runtime error handling', () => {
  it('mengenali transient Baileys Connection Closed 428 dari stack Baileys', () => {
    const error = new Error('Connection Closed');
    error.output = { statusCode: 428 };
    error.stack = 'Error: Connection Closed\n    at sendRawMessage (node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:56:19)';

    assert.equal(isTransientBaileysConnectionClosed(error), true);
  });

  it('tidak mengabaikan error Connection Closed dari sumber lain', () => {
    const error = new Error('Connection Closed');
    error.output = { statusCode: 428 };
    error.stack = 'Error: Connection Closed\n    at app.js:1:1';

    assert.equal(isTransientBaileysConnectionClosed(error), false);
  });

  it('tidak mengabaikan status code Baileys selain 428', () => {
    const error = new Error('Connection Closed');
    error.output = { statusCode: 401 };
    error.stack = 'Error: Connection Closed\n    at sendRawMessage (node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:56:19)';

    assert.equal(isTransientBaileysConnectionClosed(error), false);
  });
});
