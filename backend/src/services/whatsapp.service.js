import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import { revealSecret } from './secret.service.js';
import { isOptOutKeyword, recordOptOut } from './opt_out.service.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pino from 'pino';
import QRCode from 'qrcode';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { dbRun, dbGet, dbAll } from '../database.js';
import { resolveUploadedMediaPath } from './upload.service.js';
import { resolveKnowledgeBase } from './chatbot_ai.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSIONS_DIR = join(__dirname, '..', '..', 'sessions');

// Pastikan folder sesi ada
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getMediaSource(urlOrPath) {
  if (!urlOrPath) return null;
  try {
    if (fs.existsSync(urlOrPath)) {
      return fs.readFileSync(urlOrPath);
    }
  } catch (err) {
    console.error('[WhatsApp Service] Gagal membaca berkas media lokal:', err);
  }
  return { url: urlOrPath };
}

function getMimeTypeFromUrl(url, defaultMime = 'application/octet-stream') {
  if (!url) return defaultMime;
  const ext = url.split('.').pop().toLowerCase();
  const map = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'zip': 'application/zip'
  };
  return map[ext] || defaultMime;
}

function getFileNameFromUrl(url, defaultName = 'Document.pdf') {
  if (!url) return defaultName;
  try {
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      return decodeURIComponent(lastPart).split(/[?#]/)[0] || defaultName;
    }
  } catch (err) {
    // ignore
  }
  return defaultName;
}

export function parseSpintax(text) {
  if (typeof text !== 'string') return text;

  // Pola regex untuk mencocokkan kurung kurawal terluar yang berisi karakter '|'
  const regex = /\{([^{|}]+\|[^{}]+)\}/g;
  let result = text;
  let match;

  while ((match = regex.exec(result)) !== null) {
    const options = match[1].split('|');
    const randomIndex = Math.floor(Math.random() * options.length);
    const chosen = options[randomIndex];

    result = result.replace(match[0], chosen);
    regex.lastIndex = 0; // Reset index untuk pencarian ulang karena panjang string berubah
  }

  return result;
}

// -------------------------------------------------------------------
// Penyaring output konsol dari library libsignal.
// Library ini mencetak pesan debug langsung ke console.info/warn/error
// yang tidak bisa dikendalikan melalui konfigurasi logger Baileys.
// Pesan-pesan ini (misal: "Closing session", "Failed to decrypt message")
// adalah hal normal saat sinkronisasi riwayat dan bukan masalah serius.
// -------------------------------------------------------------------
const LIBSIGNAL_NOISE_PATTERNS = [
  'Closing session',
  'Closing open session in favor of incoming prekey bundle',
  'Failed to decrypt message with any known session',
  'Session error:',
  'MessageCounterError',
  'Key used already or never filled'
];

function isLibsignalNoise(args) {
  if (!args || args.length === 0) return false;
  const first = args[0];
  if (typeof first !== 'string') return false;
  return LIBSIGNAL_NOISE_PATTERNS.some(pattern => first.includes(pattern));
}

const _origConsoleInfo = console.info;
const _origConsoleWarn = console.warn;
const _origConsoleError = console.error;

console.info = function (...args) {
  if (isLibsignalNoise(args)) return;
  _origConsoleInfo.apply(console, args);
};
console.warn = function (...args) {
  if (isLibsignalNoise(args)) return;
  _origConsoleWarn.apply(console, args);
};
console.error = function (...args) {
  if (isLibsignalNoise(args)) return;
  _origConsoleError.apply(console, args);
};

class WhatsAppService {
  constructor() {
    this.sockets = {};
    this.qrCodes = {};
    this.silentLogger = pino({ level: 'silent' });
  }

  // Auto-load semua sesi yang terdaftar saat server menyala
  async initAllSessions() {
    try {
      const allSessions = await dbAll("SELECT session_id FROM sessions");
      for (const row of allSessions) {
        const sessionFolder = join(SESSIONS_DIR, row.session_id);
        if (fs.existsSync(sessionFolder)) {
          console.log(`[WA Server] Memulihkan sesi: ${row.session_id}`);
          this.initSession(row.session_id).catch(err => {
            console.error(`Gagal memulihkan sesi ${row.session_id}:`, err);
          });
        }
      }
    } catch (err) {
      console.error('Gagal menginisialisasi sesi otomatis:', err);
    }
  }

  async initSession(sessionId) {
    if (this.sockets[sessionId]) {
      return this.sockets[sessionId];
    }

    const sessionFolder = join(SESSIONS_DIR, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    let version = [2, 3000, 1017531287];
    try {
      const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[WA Socket] Sesi ${sessionId} menggunakan WA Web v${latestVersion.join('.')}, isLatest: ${isLatest}`);
      version = latestVersion;
    } catch (err) {
      console.warn(`[WA Socket] Sesi ${sessionId} gagal mengambil versi WA Web terbaru, menggunakan fallback.`, err.message);
    }

    // Pastikan entri sesi ada di DB
    let existing = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
    if (!existing) {
      await dbRun('INSERT INTO sessions (session_id, status) VALUES (?, ?)', [sessionId, 'DISCONNECTED']);
    }

    // Ambil proxy_url baik dari kolom warisan (proxy_url) atau dari relasi (proxy_id)
    const sessionWithProxy = await dbGet(
      `SELECT s.*, p.proxy_url as resolved_proxy_url 
       FROM sessions s 
       LEFT JOIN proxies p ON s.proxy_id = p.id 
       WHERE s.session_id = ?`, 
      [sessionId]
    );

    const proxyUrl = sessionWithProxy ? (sessionWithProxy.resolved_proxy_url || sessionWithProxy.proxy_url) : null;

    const socketConfig = {
      version,
      auth: state,
      printQRInTerminal: false,
      logger: this.silentLogger,
      browser: ['WA-Bot System', 'Chrome', '1.0.0'],
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true
    };

    // Menonaktifkan proxy sementara (dinonaktifkan oleh pengguna)
    if (false && proxyUrl) {
      socketConfig.agent = new HttpsProxyAgent(proxyUrl);
      console.log(`[WA Socket] Sesi ${sessionId} terhubung melewati proxy: ${proxyUrl}`);
    }


    const sock = (makeWASocket.default || makeWASocket)(socketConfig);

    this.sockets[sessionId] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.qrCodes[sessionId] = qrDataUrl;
          await dbRun('UPDATE sessions SET status = ?, phone_number = NULL WHERE session_id = ?', ['DISCONNECTED', sessionId]);
        } catch (err) {
          console.error('Gagal membuat Base64 QR Code:', err);
        }
      }

      if (connection === 'open') {
        const rawJid = sock.user.id;
        const phone = rawJid.split(':')[0];
        console.log(`[WA Socket] Sesi ${sessionId} terhubung ke nomor: ${phone}`);
        
        delete this.qrCodes[sessionId];
        await dbRun('UPDATE sessions SET status = ?, phone_number = ? WHERE session_id = ?', ['CONNECTED', phone, sessionId]);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WA Socket] Sesi ${sessionId} terputus. Status Code: ${statusCode}. Reconnect: ${shouldReconnect}`);
        
        await dbRun('UPDATE sessions SET status = ? WHERE session_id = ?', ['DISCONNECTED', sessionId]);
        delete this.sockets[sessionId];
        delete this.qrCodes[sessionId];

        if (shouldReconnect) {
          // Koneksi ulang otomatis dengan delay kecil
          setTimeout(() => this.initSession(sessionId), 5000);
        } else {
          // Jika logged out, hapus kredensial lokal
          console.log(`[WA Socket] Kredensial sesi ${sessionId} kedaluwarsa/keluar. Menghapus folder lokal.`);
          fs.rmSync(sessionFolder, { recursive: true, force: true });
        }
      }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
      console.log(`[WA Contacts] contacts.upsert: ${contacts.length} kontak untuk sesi ${sessionId}`);
      for (const contact of contacts) {
        try {
          const jid = contact.id;
          const name = contact.name || null;
          const notify = contact.notify || null;
          const verifiedName = contact.verifiedName || null;
          const lid = contact.lid || null;

          await dbRun(
            `INSERT INTO whatsapp_contacts (jid, name, notify, verified_name, lid)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               name = COALESCE(excluded.name, name),
               notify = COALESCE(excluded.notify, notify),
               verified_name = COALESCE(excluded.verified_name, verified_name),
               lid = COALESCE(excluded.lid, lid)`,
            [jid, name, notify, verifiedName, lid]
          );
        } catch (err) {
          // Silent catch
        }
      }
    });

    sock.ev.on('contacts.update', async (updates) => {
      for (const update of updates) {
        try {
          const jid = update.id;
          const name = update.name || null;
          const notify = update.notify || null;
          const verifiedName = update.verifiedName || null;
          const lid = update.lid || null;

          await dbRun(
            `INSERT INTO whatsapp_contacts (jid, name, notify, verified_name, lid)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               name = COALESCE(excluded.name, name),
               notify = COALESCE(excluded.notify, notify),
               verified_name = COALESCE(excluded.verified_name, verified_name),
               lid = COALESCE(excluded.lid, lid)`,
            [jid, name, notify, verifiedName, lid]
          );
        } catch (err) {
          // Silent catch
        }
      }
    });

    // Tangkap kontak dari sinkronisasi riwayat pesan (history sync saat koneksi awal)
    sock.ev.on('messaging-history.set', async ({ contacts: historyContacts }) => {
      if (!Array.isArray(historyContacts) || historyContacts.length === 0) return;
      console.log(`[WA Contacts] Menerima ${historyContacts.length} kontak dari messaging-history.set untuk sesi ${sessionId}`);
      for (const contact of historyContacts) {
        try {
          const jid = contact.id;
          if (!jid) continue;
          const name = contact.name || null;
          const notify = contact.notify || null;
          const verifiedName = contact.verifiedName || null;
          const lid = contact.lid || null;

          await dbRun(
            `INSERT INTO whatsapp_contacts (jid, name, notify, verified_name, lid)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               name = COALESCE(excluded.name, name),
               notify = COALESCE(excluded.notify, notify),
               verified_name = COALESCE(excluded.verified_name, verified_name),
               lid = COALESCE(excluded.lid, lid)`,
            [jid, name, notify, verifiedName, lid]
          );
        } catch (err) {
          // Silent catch
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      // Debug: log paling awal untuk konfirmasi event messages.upsert diterima
      console.log(`[Chatbot Debug] >>> messages.upsert diterima, type=${m.type}, jumlah=${m.messages?.length}`);

      // Lewati hanya jika ini history sync (append), proses semua lainnya termasuk undefined
      if (m.type === 'append') return;

      try {
        const msg = m.messages[0];
        if (!msg) return;
        console.log(`[Chatbot Debug] msg.key=${JSON.stringify(msg.key)}, hasMessage=${!!msg.message}, fromMe=${msg.key?.fromMe}`);
        if (!msg.message || msg.key.fromMe) return;

        const senderId = msg.key.remoteJid;
        if (!senderId || senderId.endsWith('@newsletter') || senderId.endsWith('@broadcast') || senderId === 'status@broadcast') return;

        // Simpan push name (nama publik WA) dari pengirim pesan ke DB whatsapp_contacts
        const pushName = msg.pushName || null;
        const senderParticipant = msg.key.participant || senderId;
        if (pushName && senderParticipant && !senderParticipant.endsWith('@g.us')) {
          try {
            await dbRun(
              `INSERT INTO whatsapp_contacts (jid, notify)
               VALUES (?, ?)
               ON CONFLICT(jid) DO UPDATE SET
                 notify = COALESCE(excluded.notify, notify)`,
              [senderParticipant, pushName]
            );
          } catch (err) {
            // Silent catch
          }
        }
        
        // Unwrap pesan dari container Baileys (ephemeral, viewOnce, senderKeyDistribution, dll.)
        // Baileys sering membungkus pesan di layer ekstra sehingga Object.keys()[0]
        // bisa mengembalikan key wrapper, bukan tipe pesan sebenarnya.
        let innerMessage = msg.message;
        const wrapperKeys = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'];
        for (const wk of wrapperKeys) {
          if (innerMessage[wk]?.message) {
            innerMessage = innerMessage[wk].message;
          }
        }

        // Ambil kunci pesan sebenarnya, lewati key metadata seperti senderKeyDistributionMessage
        // dan messageContextInfo yang bukan tipe pesan teks/media.
        const skipKeys = ['senderKeyDistributionMessage', 'messageContextInfo', 'protocolMessage'];
        const allKeys = Object.keys(innerMessage);
        const messageType = allKeys.find(k => !skipKeys.includes(k)) || allKeys[0];

        console.log(`[Chatbot Debug] Pesan masuk dari ${senderId}, type=${m.type}, messageType=${messageType}, allKeys=${allKeys.join(',')}`);

        // Extract text message
        let text = '';
        if (messageType === 'conversation') {
          text = innerMessage.conversation;
        } else if (messageType === 'extendedTextMessage') {
          text = innerMessage.extendedTextMessage?.text;
        } else if (messageType === 'imageMessage') {
          text = innerMessage.imageMessage?.caption;
        } else if (messageType === 'videoMessage') {
          text = innerMessage.videoMessage?.caption;
        } else if (messageType === 'buttonsResponseMessage') {
          text = innerMessage.buttonsResponseMessage?.selectedButtonId;
        } else if (messageType === 'templateButtonReplyMessage') {
          text = innerMessage.templateButtonReplyMessage?.selectedId;
        } else if (messageType === 'interactiveResponseMessage') {
          const nativeFlow = innerMessage.interactiveResponseMessage?.nativeFlowResponseMessage;
          if (nativeFlow) {
            try {
              const params = JSON.parse(nativeFlow.paramsJson);
              text = params.id;
            } catch (e) {
              console.error('Gagal memproses paramsJson pada interactiveResponseMessage:', e);
            }
          }
        }

        console.log(`[Chatbot Debug] Extracted text: "${text || '(kosong)'}"`);
        
        if (!text) return;

        const isGroup = senderId.endsWith('@g.us');
        if (!isGroup && isOptOutKeyword(text)) {
          await recordOptOut(senderId, 'INBOUND_KEYWORD');
          await sock.sendMessage(senderId, {
            text: 'Permintaan berhenti menerima pesan telah dicatat. Anda tidak akan menerima pesan kampanye berikutnya.'
          });
          console.log(`[Opt-Out] Suppression list diperbarui untuk ${senderId}`);
          return;
        }
        
        const cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();

        // Ambil pengaturan Chatbot AI/Mode untuk sesi ini
        const aiSettings = await dbGet('SELECT * FROM chatbot_ai_settings WHERE session_id = ?', [sessionId]);
        const chatbotMode = aiSettings ? (aiSettings.chatbot_mode || 'both') : 'both';

        if (chatbotMode === 'off') {
          return; // Chatbot dinonaktifkan sepenuhnya untuk sesi ini
        }

        let matchedFlow = null;
        if (chatbotMode === 'flow' || chatbotMode === 'both') {
          // Check chatbot flows
          const allActiveFlows = await dbAll("SELECT * FROM chatbot_flows WHERE status = 'ACTIVE'");
          const flows = allActiveFlows.filter(flow => {
            try {
              const ids = JSON.parse(flow.session_ids || '[]');
              return Array.isArray(ids) && ids.includes(sessionId);
            } catch (e) {
              return false;
            }
          });

          matchedFlow = flows.find(flow => {
            // Evaluasi batasan obrolan (target_type)
            const target = flow.target_type || 'ALL';
            if (target === 'PERSONAL' && isGroup) return false;
            if (target === 'GROUP' && !isGroup) return false;

            let flowKeywords = flow.keywords.split(',').map(k => k.trim()).filter(k => k !== '');
            if (flowKeywords.length === 0) return false;

            if (!flow.case_sensitive) {
               flowKeywords = flowKeywords.map(k => k.toLowerCase());
            }
            const textToMatch = flow.case_sensitive ? cleanText : lowerText;

            if (flow.match_type === 'EXACT') {
              return flowKeywords.includes(textToMatch);
            } else if (flow.match_type === 'STARTS_WITH') {
              return flowKeywords.some(k => textToMatch.startsWith(k));
            } else {
              // CONTAINS (Default)
              return flowKeywords.some(k => textToMatch.includes(k));
            }
          });
        }

        if (matchedFlow) {
          console.log(`[Chatbot] Sesi ${sessionId} membalas ke ${senderId} untuk flow: ${matchedFlow.flow_name}`);

          if (matchedFlow.delay > 0) {
             await new Promise(r => setTimeout(r, matchedFlow.delay * 1000));
          }
          const stats = await this.executeFlowNodes(sock, senderId, matchedFlow);
          await this.recordFlowDeliveryStats(matchedFlow.id, {
            triggered: 1,
            sent: stats.sent,
            failed: stats.failed
          });
        } else if ((chatbotMode === 'ai' || chatbotMode === 'both') && !isGroup) {
          // Fallback ke Chatbot AI (SumoPod API)
          if (aiSettings && aiSettings.is_active === 1) {
            let apiKeyToUse = null;
            let baseUrlToUse = aiSettings.base_url || 'https://ai.sumopod.com/v1';
            let modelNameToUse = aiSettings.model_name || 'gpt-4o-mini';

            if (aiSettings.credential_id) {
              const cred = await dbGet('SELECT * FROM chatbot_ai_credentials WHERE id = ? AND is_active = 1', [aiSettings.credential_id]);
              if (cred && cred.api_key) {
                apiKeyToUse = revealSecret(cred.api_key);
                baseUrlToUse = cred.base_url || baseUrlToUse;
                modelNameToUse = cred.model_name || modelNameToUse;
              } else {
                console.log(`[Chatbot AI] Sesi ${sessionId} dilewati karena kredensial terikat (#${aiSettings.credential_id}) tidak aktif atau tidak ditemukan.`);
              }
            } else if (aiSettings.api_key) {
              apiKeyToUse = revealSecret(aiSettings.api_key);
            }

            if (apiKeyToUse) {
              console.log(`[Chatbot AI] Sesi ${sessionId} memproses pesan masuk dari ${senderId} via SumoPod AI`);
              
              if (aiSettings.show_typing) {
                try {
                  await sock.presenceSubscribe(senderId);
                  await sock.sendPresenceUpdate('composing', senderId);
                } catch (e) {
                  // Abaikan jika presence gagal
                }
              }

              try {
                const systemPrompt = [];
                if (aiSettings.system_instruction) {
                  systemPrompt.push(aiSettings.system_instruction);
                }
                const resolvedKb = await resolveKnowledgeBase(aiSettings);
                if (resolvedKb) {
                  systemPrompt.push(
                    "Anda adalah asisten virtual yang ramah dan membantu untuk menjawab pertanyaan pelanggan.\n\n" +
                    "Gunakan informasi berikut sebagai basis pengetahuan untuk menjawab pertanyaan pelanggan. Informasi ini berisi catatan manual dan alur chatbot otomatis (yang terdiri dari nama 'Alur' dan 'Isi Pesan').\n\n" +
                    "Aturan menjawab:\n" +
                    "1. Jika pelanggan bertanya tentang topik yang relevan dengan salah satu Alur (misalnya tentang pendaftaran, biaya, beasiswa, akreditasi, dll), berikan informasi, link, dan kontak yang tertera di bawah Alur tersebut secara ramah. Jangan katakan bahwa Anda tidak mengetahuinya jika ada alur yang membahas topik tersebut; cukup arahkan mereka menggunakan informasi di alur tersebut.\n" +
                    "2. Jika pertanyaan benar-benar di luar topik yang disediakan di bawah ini, jawablah secara sopan bahwa Anda belum memiliki informasi tersebut dan tawarkan mereka untuk menghubungi customer service.\n" +
                    "3. Jangan sebutkan kata teknis seperti 'database', 'alur', atau 'knowledge base' kepada pelanggan.\n\n" +
                    "Berikut adalah basis pengetahuan Anda:\n" +
                    resolvedKb
                  );
                }

                const finalSystemPrompt = systemPrompt.join("\n\n");

                const { OpenAI } = await import('openai');
                const openai = new OpenAI({
                  apiKey: apiKeyToUse,
                  baseURL: baseUrlToUse,
                  timeout: 15000
                });

                const response = await openai.chat.completions.create({
                  model: modelNameToUse || 'gpt-4o-mini',
                  messages: [
                    ...(finalSystemPrompt ? [{ role: 'system', content: finalSystemPrompt }] : []),
                    { role: 'user', content: cleanText }
                  ],
                  temperature: 0.7
                });

                const aiReply = response.choices[0]?.message?.content;

                // Terapkan delay sebelum mengirim pesan balasan
                const delay = aiSettings.delay_seconds || 2;
                if (delay > 0) {
                  await new Promise(r => setTimeout(r, delay * 1000));
                }

                // Hentikan status mengetik
                if (aiSettings.show_typing) {
                  try {
                    await sock.sendPresenceUpdate('paused', senderId);
                  } catch (e) {
                    // Abaikan jika presence gagal
                  }
                }

                if (aiReply && aiReply.trim() !== '') {
                  await sock.sendMessage(senderId, { text: aiReply.trim() });
                  console.log(`[Chatbot AI] Sukses membalas ke ${senderId}`);
                } else {
                  console.warn(`[Chatbot AI Warning] Model '${modelNameToUse}' mengembalikan respon kosong untuk pesan '${cleanText}'`);
                }
              } catch (aiErr) {
                console.error('[Chatbot AI Error]', aiErr);
              if (aiSettings.show_typing) {
                try {
                  await sock.sendPresenceUpdate('paused', senderId);
                } catch (e) {
                  // Abaikan
                }
              }
            }
          }
        }
      }

      } catch (err) {
        console.error('Error handling messages.upsert:', err);
      }
    });

    return sock;
  }

  getQRCode(sessionId) {
    return this.qrCodes[sessionId] || null;
  }

  async getSessionStatus(sessionId) {
    const session = await dbGet(
      `SELECT s.*, p.name as proxy_name, p.proxy_url as resolved_proxy_url 
       FROM sessions s 
       LEFT JOIN proxies p ON s.proxy_id = p.id 
       WHERE s.session_id = ?`, 
      [sessionId]
    );
    if (!session) return null;
    return {
      session_id: session.session_id,
      phone_number: session.phone_number,
      status: session.status,
      proxy_id: session.proxy_id,
      proxy_name: session.proxy_name,
      proxy_url: session.resolved_proxy_url || session.proxy_url,
      qr_code: this.qrCodes[sessionId] || null
    };
  }

  async deleteSession(sessionId) {
    const sock = this.sockets[sessionId];
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        // Abaikan jika socket sudah mati
      }
    }

    const sessionFolder = join(SESSIONS_DIR, sessionId);
    if (fs.existsSync(sessionFolder)) {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }

    delete this.sockets[sessionId];
    delete this.qrCodes[sessionId];

    await dbRun('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  }

  async sendMessage(sessionId, target, text) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }

    // Format nomor WhatsApp (e.g. 0812 -> 62812@s.whatsapp.net)
    let cleanNumber = target.replace(/\D/g, '');
    if (cleanNumber.startsWith('0')) {
      cleanNumber = '62' + cleanNumber.slice(1);
    }
    
    const jid = `${cleanNumber}@s.whatsapp.net`;

    // Cek status kepemilikan nomor WhatsApp sebelum kirim (Opsional & Aman)
    const [result] = await sock.onWhatsApp(jid);
    if (!result || !result.exists) {
      throw new Error(`Nomor ${target} tidak terdaftar di WhatsApp.`);
    }

    const parsedText = parseSpintax(text || '');
    await sock.sendMessage(jid, { text: parsedText });
    return true;
  }

  async executeFlowNodes(sock, jid, flow) {
    const stats = { sent: 0, failed: 0 };
    const sendAndCount = async (sendAction) => {
      try {
        await sendAction();
        stats.sent += 1;
      } catch (error) {
        stats.failed += 1;
        throw error;
      }
    };

    try {
      const nodes = JSON.parse(flow.nodes || '[]');
      if (nodes.length === 0) return stats;

      // Buat map node berdasarkan ID agar pencarian cepat
      const nodesMap = new Map();
      nodes.forEach(n => nodesMap.set(String(n.id), n));

      // Mulai dari node pertama
      let currentNode = nodes[0];
      const visited = new Set(); // Mencegah infinite loop jika ada siklus/circular references

      while (currentNode) {
        const nodeIdStr = String(currentNode.id);
        if (visited.has(nodeIdStr)) {
          console.warn(`[Chatbot] Terdeteksi siklus melingkar (circular loop) pada node ${nodeIdStr}. Eksekusi dihentikan.`);
          break;
        }
        visited.add(nodeIdStr);

        const messageContentParsed = parseSpintax(currentNode.message_content || '');

        // Eksekusi node saat ini
        if (currentNode.typing_indicator) {
          await sock.presenceSubscribe(jid);
          await sock.sendPresenceUpdate('composing', jid);
          await new Promise(r => setTimeout(r, 2000));
          await sock.sendPresenceUpdate('paused', jid);
        }

        const isInteractive = currentNode.message_type === 'Interactive Buttons' && currentNode.buttons && currentNode.buttons.length > 0;

        // Kirim lampiran terlebih dahulu
        if (currentNode.attachment && currentNode.attachment.url) {
          const url = resolveUploadedMediaPath(currentNode.attachment.url);
          const mediaSource = getMediaSource(url);
          let attachmentPayload = {};
          
          if (mediaSource) {
            switch (currentNode.attachment.type) {
              case 'Image':
                attachmentPayload = isInteractive 
                  ? { image: mediaSource } 
                  : { image: mediaSource, caption: messageContentParsed };
                break;
              case 'Video':
                attachmentPayload = isInteractive 
                  ? { video: mediaSource } 
                  : { video: mediaSource, caption: messageContentParsed };
                break;
              case 'Audio': {
                const mimeType = getMimeTypeFromUrl(url, 'audio/mp4');
                attachmentPayload = { audio: mediaSource, mimetype: mimeType };
                break;
              }
              case 'Document': {
                const mimeType = getMimeTypeFromUrl(url, 'application/pdf');
                const fileName = getFileNameFromUrl(url, 'Document.pdf');
                attachmentPayload = isInteractive 
                  ? { document: mediaSource, mimetype: mimeType, fileName: fileName } 
                  : { document: mediaSource, mimetype: mimeType, fileName: fileName, caption: messageContentParsed };
                break;
              }
            }
          }

          if (Object.keys(attachmentPayload).length > 0) {
            await sendAndCount(() => sock.sendMessage(jid, attachmentPayload));
            if (isInteractive) {
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        }

        if (isInteractive) {
          const buttons = (currentNode.buttons || []).map((btnText) => ({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
              display_text: btnText,
              id: btnText
            })
          }));

          const interactiveMessage = proto.Message.InteractiveMessage.fromObject({
            body: {
              text: messageContentParsed
            },
            nativeFlowMessage: {
              buttons: buttons
            }
          });

          const userJid = sock.authState?.creds?.me?.id || sock.user?.id;
          const msg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadata: {},
                  deviceListMetadataVersion: 2,
                },
                interactiveMessage: interactiveMessage
              }
            }
          }, { userJid });

          const additionalNodes = [];
          additionalNodes.push({
            tag: 'biz',
            attrs: {},
            content: [{
              tag: 'interactive',
              attrs: {
                type: 'native_flow',
                v: '1'
              },
              content: [{
                tag: 'native_flow',
                attrs: {
                  v: '9',
                  name: 'mixed'
                }
              }]
            }]
          });

          const isGroup = jid.endsWith('@g.us');
          if (!isGroup) {
            additionalNodes.push({
              tag: 'bot',
              attrs: {
                biz_bot: '1'
              }
            });
          }

          await sendAndCount(() => sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes 
          }));
        } else {
          if (!(currentNode.attachment && currentNode.attachment.url)) {
            await sendAndCount(() => sock.sendMessage(jid, { text: messageContentParsed }));
          }
        }

        await new Promise(r => setTimeout(r, 1000));

        // Tentukan node berikutnya
        if (currentNode.next_node) {
          if (String(currentNode.next_node).startsWith('flow:')) {
            const nextFlowId = String(currentNode.next_node).split(':')[1];
            const nextFlow = await dbGet("SELECT * FROM chatbot_flows WHERE id = ?", [nextFlowId]);
            if (nextFlow) {
              console.log(`[Chatbot] Alur melompat ke flow lain: ${nextFlow.flow_name}`);
              const nextStats = await this.executeFlowNodes(sock, jid, nextFlow);
              await this.recordFlowDeliveryStats(nextFlow.id, {
                triggered: 1,
                sent: nextStats.sent,
                failed: nextStats.failed
              });
            }
            break; // Hentikan eksekusi flow saat ini
          } else {
            // Lompat ke node dalam flow yang sama
            currentNode = nodesMap.get(String(currentNode.next_node)) || null;
          }
        } else {
          // Jika disetel Auto, cari node berikutnya dalam index array
          const currentIndex = nodes.findIndex(n => String(n.id) === nodeIdStr);
          currentNode = currentIndex !== -1 && currentIndex + 1 < nodes.length ? nodes[currentIndex + 1] : null;
        }
      }
    } catch (error) {
      console.error('Error executing flow nodes:', error);
    }

    return stats;
  }

  async recordFlowDeliveryStats(flowId, stats = {}) {
    await dbRun(
      `UPDATE chatbot_flows
       SET trigger_count = COALESCE(trigger_count, 0) + ?,
           sent_count = COALESCE(sent_count, 0) + ?,
           failed_count = COALESCE(failed_count, 0) + ?
       WHERE id = ?`,
      [
        stats.triggered || 0,
        stats.sent || 0,
        stats.failed || 0,
        flowId
      ]
    );
  }

  async getGroups(sessionId) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }
    try {
      const groups = await sock.groupFetchAllParticipating();
      return Object.values(groups).map(g => ({
        id: g.id,
        subject: g.subject,
        size: g.participants?.length || 0
      }));
    } catch (err) {
      console.error(`Gagal mengambil daftar grup untuk sesi ${sessionId}:`, err);
      return [];
    }
  }

  async sendSingleMessage(sessionId, target, payload) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }

    let jid = target;
    if (!jid.endsWith('@g.us')) {
      let cleanNumber = target.replace(/\D/g, '');
      if (cleanNumber.startsWith('0')) {
        cleanNumber = '62' + cleanNumber.slice(1);
      }
      jid = `${cleanNumber}@s.whatsapp.net`;
      
      const [result] = await sock.onWhatsApp(jid);
      if (!result || !result.exists) {
        throw new Error(`Nomor ${target} tidak terdaftar di WhatsApp.`);
      }
    }

    const { messageType, text, attachmentUrl, attachmentType, attachmentName, templateId } = payload;

    // Cari nama kontak jika ada untuk personalisasi {{name}}, [name], {{nama}}, [nama]
    let targetName = '';
    if (!jid.endsWith('@g.us')) {
      try {
        let cleanNum = target.replace(/\D/g, '');
        let altNum = cleanNum;
        if (cleanNum.startsWith('62')) {
          altNum = '0' + cleanNum.slice(2);
        } else if (cleanNum.startsWith('0')) {
          altNum = '62' + cleanNum.slice(1);
        }

        // 1. Cari di tabel contacts (database manual)
        const contactRow = await dbGet(
          'SELECT name FROM contacts WHERE phone_number = ? OR phone_number = ? OR phone_number = ? LIMIT 1',
          [target, cleanNum, altNum]
        );
        if (contactRow && contactRow.name) {
          targetName = contactRow.name;
        }

        // 2. Jika tidak ada, cari di tabel whatsapp_contacts (synced contacts)
        if (!targetName) {
          const waContactRow = await dbGet(
            'SELECT name, notify, verified_name FROM whatsapp_contacts WHERE jid = ? OR jid = ? LIMIT 1',
            [jid, `${cleanNum}@s.whatsapp.net`]
          );
          if (waContactRow) {
            targetName = waContactRow.name || waContactRow.verified_name || waContactRow.notify || '';
          }
        }

        // 3. Jika masih tidak ada, cari di cache memory sock.contacts
        if (!targetName && sock.contacts) {
          const memContact = sock.contacts[jid] || sock.contacts[`${cleanNum}@s.whatsapp.net`];
          if (memContact) {
            targetName = memContact.name || memContact.notify || memContact.verifiedName || '';
          }
        }
      } catch (err) {
        console.error('Error fetching contact name for single message personalization:', err);
      }
    }

    let displayName = targetName;
    if (!displayName || displayName.startsWith('Contact-')) {
      displayName = '';
    }

    const formatMessageText = (rawText) => {
      if (!rawText) return '';
      const withName = rawText
        .replace(/\{\{name\}\}/gi, displayName)
        .replace(/\[name\]/gi, displayName)
        .replace(/\{\{nama\}\}/gi, displayName)
        .replace(/\[nama\]/gi, displayName);
      return parseSpintax(withName);
    };

    const parsedText = formatMessageText(text || '');

    if (messageType === 'template' && templateId) {
      const template = await dbGet("SELECT * FROM message_templates WHERE id = ?", [templateId]);
      if (!template) {
        throw new Error(`Template dengan ID ${templateId} tidak ditemukan.`);
      }

      const type = template.type || 'text';
      const content = formatMessageText(template.content || '');

      if (type === 'text') {
        await sock.sendMessage(jid, { text: content });
      } else if (type === 'media' || type === 'image' || type === 'video' || type === 'document') {
        const url = resolveUploadedMediaPath(template.attachment_url);
        const caption = content;
        let mediaPayload = {};

        const lowerUrl = (url || '').toLowerCase();
        let detectType = type;
        if (detectType === 'media') {
          if (lowerUrl.match(/\.(jpeg|jpg|png|webp|gif)/)) detectType = 'image';
          else if (lowerUrl.match(/\.(mp4|3gp|avi)/)) detectType = 'video';
          else if (lowerUrl.match(/\.(mp3|ogg|wav|m4a)/)) detectType = 'audio';
          else detectType = 'document';
        }

        const mediaSource = getMediaSource(url);
        if (mediaSource) {
          if (detectType === 'image') {
            mediaPayload = { image: mediaSource, caption };
          } else if (detectType === 'video') {
            mediaPayload = { video: mediaSource, caption };
          } else if (detectType === 'audio') {
            mediaPayload = { audio: mediaSource, mimetype: getMimeTypeFromUrl(url, 'audio/mp4') };
          } else {
            mediaPayload = { document: mediaSource, mimetype: getMimeTypeFromUrl(url, 'application/pdf'), fileName: template.attachment_name || getFileNameFromUrl(url, 'Document.pdf'), caption };
          }
          await sock.sendMessage(jid, mediaPayload);
        }
      } else if (type === 'poll') {
        const question = formatMessageText(template.poll_question || 'Poll Question');
        let options = [];
        try {
          options = JSON.parse(template.poll_options || '[]');
        } catch (e) {
          options = (template.poll_options || '').split(',').map(o => o.trim()).filter(Boolean);
        }
        options = options.map(o => formatMessageText(o));
        await sock.sendMessage(jid, {
          poll: {
            name: question,
            values: options,
            selectableCount: 1
          }
        });
      } else if (type === 'contact') {
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${template.contact_name || 'Contact'}\nTEL;type=CELL;type=VOICE;waid=${(template.contact_number || '').replace(/\D/g, '')}:${template.contact_number || ''}\nEND:VCARD`;
        await sock.sendMessage(jid, {
          contacts: {
            displayName: template.contact_name || 'Contact',
            contacts: [{ vcard }]
          }
        });
      } else {
        await sock.sendMessage(jid, { text: content });
      }
    } else if (messageType === 'text') {
      await sock.sendMessage(jid, { text: parsedText });
    } else if (messageType === 'media' && attachmentUrl) {
      let mediaPayload = {};
      const url = resolveUploadedMediaPath(attachmentUrl);
      const caption = parsedText;
      const mediaSource = getMediaSource(url);

      if (mediaSource) {
        switch (attachmentType) {
          case 'Image':
            mediaPayload = { image: mediaSource, caption };
            break;
          case 'Video':
            mediaPayload = { video: mediaSource, caption };
            break;
          case 'Audio':
            mediaPayload = { audio: mediaSource, mimetype: getMimeTypeFromUrl(url, 'audio/mp4') };
            break;
          case 'Document':
            mediaPayload = { document: mediaSource, mimetype: getMimeTypeFromUrl(url, 'application/pdf'), fileName: attachmentName || getFileNameFromUrl(url, 'Document.pdf'), caption };
            break;
          default:
            mediaPayload = { document: mediaSource, mimetype: getMimeTypeFromUrl(url, 'application/octet-stream'), fileName: attachmentName || getFileNameFromUrl(url, 'File'), caption };
            break;
        }
        await sock.sendMessage(jid, mediaPayload);
      }
    } else {
      throw new Error(`Data pesan tidak lengkap.`);
    }

    return true;
  }

  async getDetailedGroups(sessionId) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }
    try {
      const groups = await sock.groupFetchAllParticipating();
      const ownJid = sock.authState?.creds?.me?.id || sock.user?.id;
      const ownJidClean = ownJid ? ownJid.split(':')[0].split('@')[0] + '@s.whatsapp.net' : '';

      const ownLid = sock.authState?.creds?.me?.lid || sock.user?.lid;
      const ownLidClean = ownLid ? ownLid.split(':')[0].split('@')[0] + '@lid' : '';

      return Object.values(groups).map(g => {
        // Cek apakah user adalah admin (bisa JID atau LID)
        const me = g.participants?.find(p => {
          const pJid = p.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
          const pLid = p.id.split(':')[0].split('@')[0] + '@lid';
          return (pJid === ownJidClean) || (pLid === ownLidClean);
        });
        const isAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');

        // Identifikasi tipe grup (grup biasa atau komunitas)
        const isCommunity = !!(g.isCommunity || g.isCommunityAnnounce || g.id.includes('community'));

        return {
          id: g.id,
          subject: g.subject,
          size: g.participants?.length || 0,
          isAdmin: !!isAdmin,
          isCommunity: isCommunity,
          participants: g.participants?.map(p => {
            const pJid = p.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            const cachedContact = sock.contacts?.[pJid];
            return {
              id: p.id,
              admin: p.admin,
              name: cachedContact?.name || cachedContact?.notify || cachedContact?.verifiedName || p.name || p.notify || p.verifiedName || ''
            };
          }) || []
        };
      });
    } catch (err) {
      console.error(`Gagal mengambil daftar grup detail untuk sesi ${sessionId}:`, err);
      throw err;
    }
  }

  async getGroupInviteLink(sessionId, groupId) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }
    try {
      const code = await sock.groupInviteCode(groupId);
      return `https://chat.whatsapp.com/${code}`;
    } catch (err) {
      console.error(`Gagal membuat link undangan untuk grup ${groupId}:`, err);
      throw new Error(`Gagal membuat link undangan. Pastikan akun WhatsApp Anda adalah admin dari grup tersebut.`);
    }
  }

  async getGroupsMetadata(sessionId, groupIds) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif atau belum terhubung.`);
    }

    if (!Array.isArray(groupIds)) {
      throw new Error('Parameter groupIds harus berupa array.');
    }

    const ownJid = sock.authState?.creds?.me?.id || sock.user?.id;
    const ownJidClean = ownJid ? ownJid.split(':')[0].split('@')[0] + '@s.whatsapp.net' : '';

    const ownLid = sock.authState?.creds?.me?.lid || sock.user?.lid;
    const ownLidClean = ownLid ? ownLid.split(':')[0].split('@')[0] + '@lid' : '';

    const selectedGroups = [];
    for (const gid of groupIds) {
      try {
        const metadata = await sock.groupMetadata(gid);
        if (!metadata) continue;

        const me = metadata.participants?.find(p => {
          const pJid = p.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
          const pLid = p.id.split(':')[0].split('@')[0] + '@lid';
          return (pJid === ownJidClean) || (pLid === ownLidClean);
        });

        const isAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');
        const isCommunity = !!(metadata.isCommunity || metadata.isCommunityAnnounce || metadata.id.includes('community'));

        selectedGroups.push({
          id: metadata.id,
          subject: metadata.subject,
          size: metadata.participants?.length || 0,
          isAdmin: !!isAdmin,
          isCommunity,
          participants: (metadata.participants || []).map(p => {
            const pJid = p.id ? p.id.split(':')[0].split('@')[0] + '@s.whatsapp.net' : '';
            const cachedContact = sock.contacts?.[pJid] || sock.contacts?.[p.id] || sock.contacts?.[p.lid];
            return {
              id: p.id,
              jid: p.jid || cachedContact?.jid || null,
              lid: p.lid || cachedContact?.lid || null,
              admin: p.admin,
              name: cachedContact?.name || cachedContact?.notify || cachedContact?.verifiedName || p.name || p.notify || p.verifiedName || ''
            };
          })
        });
      } catch (err) {
        console.error(`Gagal mengambil metadata grup live untuk ${gid}:`, err.message);
      }
    }

    return selectedGroups;
  }

  /**
   * Memaksa re-sinkronisasi kontak dari WhatsApp.
   * Menghapus file app-state-sync agar Baileys meminta ulang data kontak dari server.
   * Setelah panggilan ini, sesi perlu di-restart agar sinkronisasi berjalan.
   */
  async forceSyncContacts(sessionId) {
    const sock = this.sockets[sessionId];
    if (!sock) {
      throw new Error(`Sesi ${sessionId} tidak aktif.`);
    }

    const sessionFolder = join(SESSIONS_DIR, sessionId);
    const appStateFile = join(sessionFolder, 'app-state-sync-version-regular.json');

    // Hapus file app-state agar Baileys minta ulang dari server
    if (fs.existsSync(appStateFile)) {
      fs.unlinkSync(appStateFile);
      console.log(`[WA Contacts] app-state-sync-version-regular.json dihapus untuk sesi ${sessionId}. Restart sesi diperlukan.`);
    }

    // Coba panggil resyncAppState jika tersedia di versi Baileys ini
    try {
      if (sock.resyncAppState) {
        await sock.resyncAppState(['regular']);
        console.log(`[WA Contacts] resyncAppState dipanggil untuk sesi ${sessionId}`);
      }
    } catch (err) {
      console.warn(`[WA Contacts] resyncAppState gagal:`, err.message);
    }

    return { message: 'Sync dipaksa. Restart sesi untuk mendapatkan kontak terbaru.' };
  }

  /**
   * Perbaikan sesi manual: menghapus cache Signal tanpa menghapus creds.json.
   * Metode ini dapat dipanggil melalui API jika pengguna ingin memaksa
   * negosiasi ulang kunci enkripsi tanpa harus scan QR code ulang.
   * CATATAN: Tidak dilakukan secara otomatis karena error dekripsi dari
   * sinkronisasi riwayat pesan lama adalah hal normal dan permanen.
   */
  async repairSession(sessionId) {
    console.log(`[WA Server] Menjalankan perbaikan sesi untuk: ${sessionId}`);

    const sock = this.sockets[sessionId];
    if (sock) {
      try {
        console.log(`[WA Server] Menutup socket aktif untuk sesi ${sessionId}...`);
        if (sock.ws) {
          sock.ws.close();
        } else if (typeof sock.end === 'function') {
          sock.end(undefined);
        }
      } catch (err) {
        // Abaikan
      }
      delete this.sockets[sessionId];
    }

    // Beri jeda agar penutupan selesai
    await new Promise(resolve => setTimeout(resolve, 3000));

    const sessionFolder = join(SESSIONS_DIR, sessionId);
    if (fs.existsSync(sessionFolder)) {
      try {
        const files = fs.readdirSync(sessionFolder);
        let deletedCount = 0;
        for (const file of files) {
          // Hanya hapus file Signal session cache, biarkan creds.json tetap utuh
          if (file !== 'creds.json') {
            fs.rmSync(join(sessionFolder, file), { recursive: true, force: true });
            deletedCount++;
          }
        }
        console.log(`[WA Server] Berhasil menghapus ${deletedCount} berkas cache Signal pada folder sesi ${sessionId}. Kredensial utama tetap aman.`);
      } catch (err) {
        console.error(`[WA Server] Gagal membersihkan cache Signal pada folder sesi ${sessionId}:`, err);
      }
    }

    // Mulai ulang sesi
    console.log(`[WA Server] Memulai kembali sesi ${sessionId} setelah perbaikan...`);
    try {
      await this.initSession(sessionId);
      console.log(`[WA Server] Sesi ${sessionId} berhasil dihubungkan kembali.`);
    } catch (err) {
      console.error(`[WA Server] Gagal memulihkan sesi ${sessionId} setelah perbaikan:`, err);
    }
  }
}

const whatsappService = new WhatsAppService();
export default whatsappService;
