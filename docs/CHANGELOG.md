# Changelog

Seluruh perubahan penting proyek WA-Bot Pro dicatat dalam file ini.  
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

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
