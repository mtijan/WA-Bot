import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { useEncryptedMultiFileAuthState, encryptSessionFile, decryptSessionFile } from '../src/utils/encrypted_auth_state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_TEST_DIR = path.join(__dirname, 'temp_auth_test');
process.env.WA_BOT_SECRET_ENCRYPTION_KEY = 'testing-encryption-secret-at-least-32-characters';

describe('Encrypted Auth State Provider', () => {
  after(() => {
    // Cleanup temp test directory
    if (fs.existsSync(TEMP_TEST_DIR)) {
      fs.rmSync(TEMP_TEST_DIR, { recursive: true, force: true });
    }
  });

  it('seharusnya mengamankan creds.json dengan prefix enkripsi dan dapat membacanya kembali', async () => {
    const provider = await useEncryptedMultiFileAuthState(TEMP_TEST_DIR);
    
    // Simpan credentials palsu
    provider.state.creds.me = { id: '628123456789@s.whatsapp.net', name: 'Test' };
    await provider.saveCreds();

    // Verifikasi bahwa data di disk terenkripsi
    const credsPath = path.join(TEMP_TEST_DIR, 'creds.json');
    const rawContent = fs.readFileSync(credsPath, 'utf8');
    assert.ok(rawContent.startsWith('enc:session:v1:'), 'Berkas creds.json harus dimulai dengan prefix enkripsi');

    // Verifikasi pemulihan data menggunakan provider baru
    const newProvider = await useEncryptedMultiFileAuthState(TEMP_TEST_DIR);
    assert.deepEqual(newProvider.state.creds.me, { id: '628123456789@s.whatsapp.net', name: 'Test' });
  });

  it('seharusnya mendukung migrasi mulus untuk berkas sesi yang sebelumnya tidak terenkripsi', async () => {
    // Siapkan unencrypted session file manual
    const mockCreds = {
      noiseKey: { public: 'abc', private: 'def' },
      me: { id: 'migration@s.whatsapp.net' }
    };
    
    const migrationDir = path.join(TEMP_TEST_DIR, 'migration_test');
    if (!fs.existsSync(migrationDir)) {
      fs.mkdirSync(migrationDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(migrationDir, 'creds.json'),
      JSON.stringify(mockCreds),
      'utf8'
    );

    // Muat menggunakan provider terenkripsi kita
    const provider = await useEncryptedMultiFileAuthState(migrationDir);
    assert.equal(provider.state.creds.me.id, 'migration@s.whatsapp.net', 'Harus bisa membaca creds yang tidak terenkripsi');

    // Tulis kembali
    await provider.saveCreds();

    // Verifikasi bahwa sekarang berkas telah terenkripsi
    const rawContent = fs.readFileSync(path.join(migrationDir, 'creds.json'), 'utf8');
    assert.ok(rawContent.startsWith('enc:session:v1:'), 'Berkas harus otomatis dienkripsi saat ditulis kembali');
  });

  it('seharusnya mendukung operasi get dan set key secara aman', async () => {
    const keyDir = path.join(TEMP_TEST_DIR, 'key_test');
    const provider = await useEncryptedMultiFileAuthState(keyDir);

    const testKeyData = {
      'pre-key': {
        '1': { public: 'pub1', private: 'priv1' },
        '2': { public: 'pub2', private: 'priv2' }
      }
    };

    // Set key data
    await provider.state.keys.set(testKeyData);

    // Verifikasi berkas di disk terenkripsi
    const keyPath = path.join(keyDir, 'pre-key-1.json');
    const rawContent = fs.readFileSync(keyPath, 'utf8');
    assert.ok(rawContent.startsWith('enc:session:v1:'), 'Berkas key data harus terenkripsi');

    // Get key data kembali
    const retrieved = await provider.state.keys.get('pre-key', ['1', '2']);
    assert.deepEqual(retrieved['1'], { public: 'pub1', private: 'priv1' });
    assert.deepEqual(retrieved['2'], { public: 'pub2', private: 'priv2' });
  });
});
