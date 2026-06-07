/**
 * Skrip tes minimal untuk mengecek apakah Baileys menerima event messages.upsert.
 * Jalankan: node src/test_messages.js
 * Lalu kirim pesan ke nomor yang terhubung dan lihat apakah log muncul.
 */
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSIONS_DIR = join(__dirname, '..', 'sessions');
const SESSION_ID = 'testing-lokal-device-1';

async function main() {
  const sessionFolder = join(SESSIONS_DIR, SESSION_ID);
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  let version;
  try {
    const { version: v } = await fetchLatestBaileysVersion();
    version = v;
  } catch {
    version = [2, 3000, 1017531287];
  }

  const sock = makeWASocket.default
    ? makeWASocket.default({ version, auth: state, printQRInTerminal: true, logger: pino({ level: 'warn' }) })
    : makeWASocket({ version, auth: state, printQRInTerminal: true, logger: pino({ level: 'warn' }) });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    console.log('[TEST] connection.update:', JSON.stringify(update));
    if (update.connection === 'open') {
      console.log('[TEST] TERHUBUNG! Kirim pesan ke nomor ini untuk tes.');
    }
  });

  // Event utama yang diuji
  sock.ev.on('messages.upsert', (m) => {
    console.log('[TEST] >>> messages.upsert DITERIMA <<<');
    console.log('[TEST] type:', m.type);
    console.log('[TEST] jumlah pesan:', m.messages?.length);
    for (const msg of m.messages) {
      console.log('[TEST] key:', JSON.stringify(msg.key));
      console.log('[TEST] fromMe:', msg.key.fromMe);
      console.log('[TEST] message keys:', msg.message ? Object.keys(msg.message) : 'null');
      console.log('[TEST] pushName:', msg.pushName);
    }
  });

  // Monitor semua event untuk melihat mana yang aktif
  sock.ev.on('messages.update', () => console.log('[TEST] messages.update diterima'));
  sock.ev.on('message-receipt.update', () => console.log('[TEST] message-receipt.update diterima'));
  sock.ev.on('contacts.upsert', (c) => console.log(`[TEST] contacts.upsert: ${c.length} kontak`));
  sock.ev.on('contacts.update', (c) => console.log(`[TEST] contacts.update: ${c.length} kontak`));
  sock.ev.on('messaging-history.set', (h) => console.log(`[TEST] messaging-history.set: ${h.contacts?.length} kontak`));
}

main().catch(console.error);
