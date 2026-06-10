# Changelog

Seluruh perubahan penting proyek WA-Bot Pro dicatat dalam file ini.  
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.8.7] - 2026-06-10

### Added
- Tombol reconnect manual ("Reconnect") di antarmuka Devices / Session Manager [SessionManager.jsx](file:///d:/Self%20Project/WA-Bot/frontend/src/components/SessionManager.jsx) untuk memicu pemutusan socket bersih dan menyambung kembali tanpa menghapus Signal cache/kredensial.
- Handler reconnect backend `reconnectSession` di [whatsapp.service.js](file:///d:/Self%20Project/WA-Bot/backend/src/services/whatsapp.service.js), [session.controller.js](file:///d:/Self%20Project/WA-Bot/backend/src/controllers/session.controller.js), dan [internal.controller.js](file:///d:/Self%20Project/WA-Bot/backend/src/controllers/internal.controller.js) untuk mendukung alur API session-manager yang baru.
- Opsi `keepAliveIntervalMs: 30000` di konfigurasi socket Baileys di [whatsapp.service.js](file:///d:/Self%20Project/WA-Bot/backend/src/services/whatsapp.service.js) untuk deteksi zombie connection otomatis.
- Berkas pengujian baru [sessions.test.js](file:///d:/Self%20Project/WA-Bot/backend/test/sessions.test.js) untuk memvalidasi alur reconnect manual dan perbaikan status WhatsApp.
- Dokumen tata kelola platform [PLATFORM_GOVERNANCE.md](file:///d:/Self%20Project/WA-Bot/docs/PLATFORM_GOVERNANCE.md) untuk mendokumentasikan compliance, manajemen risiko pemblokiran WhatsApp, limits/throttling, retensi, dan siklus hidup media.

### Fixed
- Memperbaiki progress bar visualisasi penggunaan memori sistem di [Monitoring.jsx](file:///d:/Self%20Project/WA-Bot/frontend/src/components/Monitoring.jsx) agar membandingkan memori RSS aplikasi (Resident Set Size) terhadap batas total RAM fisik host sistem, bukan terhadap heap limit.
- Memperbaiki parse tanggal log dari format UTC SQLite menjadi zona waktu lokal browser dengan helper `formatDateTime` di [Dashboard.jsx](file:///d:/Self%20Project/WA-Bot/frontend/src/components/Dashboard.jsx).

## [2.8.6] - 2026-06-08

### Added
- Fitur auto-repair otomatis melalui skrip [auto_repair_disconnected.js](file:///d:/Self%20Project/WA-Bot/backend/scripts/auto_repair_disconnected.js) untuk memperbaiki sesi WhatsApp berstatus `DISCONNECTED` secara periodik.
- Mekanisme pembatas laju (rate-limiter) perbaikan otomatis maksimal 3 kali per 24 jam dengan jeda cooldown 15 menit menggunakan berkas status persisten `backend/data/auto_repair_status.json`.
- Integrasi notifikasi kegagalan perbaikan otomatis serta batas limit pemulihan langsung ke Telegram.
- Perintah `"sessions:repair-auto"` di backend `package.json`.
- Berkas unit systemd [wa-bot-repair.service](file:///d:/Self%20Project/WA-Bot/docs/deploy/systemd/wa-bot-repair.service) dan [wa-bot-repair.timer](file:///d:/Self%20Project/WA-Bot/docs/deploy/systemd/wa-bot-repair.timer) untuk otomasi perbaikan sesi terputus berdurasi setiap jam di VPS staging.
- Migrasi database `008_add_chatbot_ai_error_fields` di [index.js](file:///d:/Self%20Project/WA-Bot/backend/src/migrations/index.js) untuk menambahkan kolom `last_error` dan `last_error_at` pada tabel `chatbot_ai_settings`.
- Pencatatan otomatis kegagalan panggilan API/saldo habis dari AI di [whatsapp.service.js](file:///d:/Self%20Project/WA-Bot/backend/src/services/whatsapp.service.js) ke database serta mekanisme self-healing (menghapus catatan kesalahan) saat pemanggilan AI kembali sukses.
- Box Alert glassmorphic merah premium di dashboard UI [Dashboard.jsx](file:///d:/Self%20Project/WA-Bot/frontend/src/components/Dashboard.jsx) untuk menampilkan error Chatbot AI yang terdeteksi dengan badge kategori dinamis (*Quota / Balance Empty*, *Invalid API Key*, *Connection Timeout*).

### Fixed
- Perbaikan simulator AI pada [ChatbotAI.jsx](file:///d:/Self%20Project/WA-Bot/frontend/src/components/ChatbotAI.jsx) agar menampilkan balasan dengan benar dengan menyesuaikan ekstraksi respons dari `result.reply` menjadi `result.data?.reply`.

## [2.8.5] - 2026-06-08

### Added
- Penambahan metrik penggunaan RAM Sistem host VPS (total, terpakai, dan bebas) di card Sumber Daya Sistem pada dashboard System Monitoring.

### Changed
- Dashboard System Monitoring diubah menggunakan tema putih (light theme) untuk meningkatkan kontras visual.
- Penyegaran otomatis (auto-refresh) 10 detik dinonaktifkan agar penyegaran data sepenuhnya dilakukan secara manual melalui tombol Refresh.
- Menghapus persentase di progress bar, stats koneksi aktif, dan tingkat keberhasilan pengiriman pada halaman monitoring untuk menyederhanakan antarmuka.
- Menghapus visualisasi chart "Aktivitas per Jam (12 jam terakhir)" dari halaman monitoring.

## [2.8.4] - 2026-06-07

### Added
- Evidence browser feature smoke staging PASS untuk login/logout, protected dashboard/API access, manual session Repair, Single Message text/media, Templates media, Chatbot Flow import/export/edit/settings/nodes/metrics/media, Group Grabber reload/export, contact verification, one-target campaign, dan warmer start/stop.
- Catatan performa full Chatbot Flow export di staging: HTTP 200, sekitar 49 MB, sekitar 14.57 detik dari authenticated VPS curl.

### Changed
- Roadmap Process architecture dinaikkan menjadi DONE setelah browser smoke socket-heavy lulus.
- Chatbot Flow table layout dikembalikan ringkas: `Sent` tetap per-flow di tabel, sementara agregat `Triggered` dan `Failed` tampil di kartu laporan atas.

### Fixed
- Chatbot Flow export frontend sekarang memvalidasi response dan menampilkan download progress, sehingga tidak lagi menyimpan file JSON berisi `null` saat response kosong atau format invalid.

## [2.8.3] - 2026-06-07

### Added
- Fitur manual session Repair pada interface UI Devices (Session Manager) beserta route API baru untuk memicu perbaikan sesi.
- Enkripsi offsite backup otomatis via Telegram Bot API (`sendDocument` endpoint) menggunakan format kompresi `.tar.gz`.

### Fixed
- Mitigasi celah keamanan Stored XSS pada proses file upload dengan validasi kecocokan ekstensi dan mime type file secara ketat di [upload.service.js](file:///d:/Self%20Project/WA-Bot/backend/src/services/upload.service.js).
- Mitigasi celah keamanan timing attack pada middleware internal auth [internal_auth.middleware.js](file:///d:/Self%20Project/WA-Bot/backend/src/middleware/internal_auth.middleware.js) menggunakan perbandingan token timing-safe (`crypto.timingSafeEqual`).
- Perbaikan sinkronisasi state WhatsApp: status database otomatis berubah ke `DISCONNECTED` dan menghapus `phone_number` lama saat memicu pembuatan QR code baru di [whatsapp.service.js](file:///d:/Self%20Project/WA-Bot/backend/src/services/whatsapp.service.js).

---

## [2.8.2] - 2026-06-06

### Added
- Chatbot Flow large-data UX: import body limit default `60mb`, progress indicator import/export, lightweight list response tanpa `nodes`, detail fetch by ID untuk editing, dan lightweight settings/device PATCH.
- Migrasi `006_chatbot_flow_delivery_metrics` yang memisahkan counter flow menjadi `trigger_count`, `sent_count`, dan `failed_count`.
- Dokumentasi: CHANGELOG.md, docs/html/monitoring.html, docs/html/security.html, dan README.md root.

### Changed
- `sent_count` sekarang menghitung pesan node yang benar-benar terkirim (bukan trigger). Nilai `sent_count` historis dipindahkan ke `trigger_count` oleh migrasi.
- Update PRIVACY.md: tambah bagian media upload lifecycle dan detail enforcement chatbot.
- Update SECURITY_AUDIT.md: catatan branch sqlite3 v6 sudah merged, tambah evidence test suite.

---

## [2.8.1] - 2026-06-06

### Added
- Skrip smoke test otomatis `backend/scripts/deploy_smoke_test.js` untuk memvalidasi frontend statis, public API (`/health`, `/health/ready`), dan internal API (`/internal/health/live`, `/internal/health/ready`, `/internal/sessions`).
- Perintah `npm run test:smoke` di backend `package.json`.
- Panduan smoke test di `docs/deploy/README.md`.

---

## [2.8.0] - 2026-06-06

### Added
- Pruner log otomatis: skrip `prune_delivery_logs.js` untuk memangkas `delivery_logs`, `warmer_logs`, file ekspor `ExportWAContacts_*`, dan folder backup usang berdasarkan `WA_BOT_LOG_RETENTION_DAYS`.
- Unit test `prune.test.js` untuk verifikasi fungsionalitas pruner.
- 54 test cases backend integration & unit test suite (validator, auth, templates, opt-outs, chatbot flows session isolation, single-message delegation, spintax engine, dan log/file pruner).

### Changed
- CSP disempurnakan di `security.middleware.js` untuk mengizinkan Google Fonts dan koneksi websocket domain staging/produksi.
- Evaluasi rate-limiter multi-proses: in-memory untuk single-instance staging, reverse-proxy untuk multi-instance produksi.
- Evaluasi dedicated-user ACL diselesaikan; template ACL terdokumentasi.

---

## [2.7.1] - 2026-06-06

### Added
- Frontend production build guard `assert-production-api-url.mjs`: gagalkan build jika bundle membawa direct private backend URL `:3001/api`.

### Fixed
- Regresi login staging yang disebabkan bundle frontend memanggil `:3001/api/auth/login` secara langsung. Perbaikan: rebuild dengan `VITE_API_URL=/api`.

---

## [2.7.0] - 2026-06-06

### Added
- Media upload end-to-end: backend `multer`, upload service/controller/routes, komponen reusable frontend `MediaUploadField.jsx`, integrasi ke Templates, Single Message, dan Chatbot Flow.
- Batas upload: gambar 5 MB, video 10 MB.

### Fixed
- Penonaktifan loop auto-repair WhatsApp session yang merusak kredensial Signal cache akibat error dekripsi riwayat lama.
- Penyaringan global verbose log noise libsignal (MessageCounterError, Closing session, Failed to decrypt).

---

## [2.6.1] - 2026-06-05

### Added
- UFW aktif pada staging VPS (inbound 22/80/443 saja).
- Backup/restore timers staging: `wa-bot-backup.timer`, `wa-bot-restore-drill.timer`.
- Local healthcheck timer staging: `wa-bot-healthcheck.timer`.
- Logrotate: `/etc/logrotate.d/wa-bot`.
- HTTP smoke evidence.
- auth-controller dan dashboard API-client migrasi ke pattern terbaru.

---

## [2.6.0] - 2026-06-05

### Added
- Staging VPS baseline verified: Caddy HTTP, systemd `wa-bot-api`/`wa-bot-worker`, frontend static, API/worker readiness.
- Domain HTTPS aktif dengan Let's Encrypt melalui Caddy.
- Secure cookie/CORS staging.
- Provider firewall review evidence.
- Telegram alert timer `wa-bot-alertcheck.timer` dengan healthy run dan forced alert evidence.
- Auth HTTPS smoke login/cookie/me/logout.
- Manual browser smoke HTTPS.

---

## [2.5.0] - 2026-06-04

### Added
- Codebase quality baseline: central config (`config.js`), structured Pino logger (`logger.js`), HTTP response helper (`http_response.js`), secret masking helper (`secret_masking.js`).
- Frontend API client terpadu `apiRequest` di `apiClient.js`.
- Migrasi seluruh React UI components ke `apiRequest`.
- Migrasi seluruh 15 backend controllers ke Pino logger, config terpusat, response helper, dan declarative validation middleware (`validator.js`).

---

## [2.4.0] - 2026-06-04

### Added
- Deploy automation templates: PM2, systemd, Nginx, Caddy, logrotate, UFW, ACL, env example.
- Security hardening baseline: CORS, rate limiting, security headers, request-size policy, optional API key auth, CSP.
- Dependency audit evidence: `sqlite3@^6` upgrade path tested, `npm audit` clean.

---

## [2.3.0] - 2026-06-04

### Added
- Admin auth cookie flow, logout menu sidebar.
- Opt-out suppression flow.
- Deployment topology VPS diagrams.

---

## [2.2.0] - 2026-06-04

### Added
- Forward roadmap production-hardening menuju VPS.
- Runtime role split: `start:api`, `start:sessions`, `start:campaign-worker`, `start:warmer-worker`, `start:worker`.
- Versioned database migration runner dan `npm run db:migrate`.
- Encrypted backup AES-256-GCM (`npm run backup:encrypted`).
- Non-destructive restore drill (`npm run restore:drill`).
- Monitoring template `docs/MONITORING.md`.

---

## [2.1.0] - 2026-06-01

### Added
- RTM alignment, API Reference, 16-tabel database visualization, 23 test case notes.
- Backend hardening.
- Suppression list opt-out.
- Accessibility (a11y) dan print styles untuk HTML docs.

---

## [2.0.0] - 2026-05-28

### Added
- Chatbot Flows, Auto-Reply, manajemen kontak.
- Skema data dictionary SQLite.

---

## [1.0.0] - 2026-05-20

### Added
- Rilis inisiasi: dokumentasi modul dasar (Session Management, REST API, DFD dasar).
