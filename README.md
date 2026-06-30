# WA-Bot Pro

WhatsApp Multi-Account & Bulk Messaging System - platform otomatisasi komunikasi berbasis web untuk mengelola multisesi WhatsApp secara konkuren.

**Status:** Internal baseline, dalam tahap pengerasan (hardening) menuju produksi  
**Versi Dokumen/Sistem:** 2.9.8
**Terakhir Diperbarui:** 2026-06-30

---

## Daftar Isi
- Fitur Utama
- Prasyarat Sistem
- Cara Menjalankan Secara Lokal
- Arsitektur Sistem & Peran Proses
- Panduan Pengujian (Testing)
- Panduan Pemeliharaan (Maintenance)
- Keamanan & Praktik Terbaik
- Indeks Dokumentasi Lengkap
- Lisensi

---

## Fitur Utama

- **Multi-Session Management:** Pengelolaan banyak sesi akun WhatsApp secara konkuren dan independen melalui satu antarmuka dashboard.
- **Bulk Campaign:** Pengiriman pesan massal ke daftar kontak dengan penjadwalan, penundaan acak (random delay) untuk keselamatan akun, personalisasi template (contoh: `{{name|first}}`), dan spintax engine (contoh: `{Hi|Hello}`).
- **Account Warmer:** Simulasi percakapan otomatis dua arah antar-sesi internal secara berkala untuk memanaskan reputasi pengirim dan mengurangi risiko pemblokiran.
- **Chatbot Flow:** Alur auto-reply interaktif berbasis node dengan perancang visual yang mendukung teks, gambar, video, audio, dokumen, dan template respons.
- **Chatbot Flow Runtime Scaling:** Assignment flow-ke-sesi dinormalisasi melalui `chatbot_flow_sessions`, sehingga pesan masuk hanya mencari flow aktif untuk sesi terkait lewat index dan tidak melakukan scan semua flow aktif.
- **Chatbot AI:** Integrasi penyedia AI (seperti OpenAI GPT atau Google Gemini) dengan mode operasional fleksibel per-sesi (off, chatbot flow saja, AI saja, atau kombinasi keduanya).
- **Group Grabber:** Ekstraksi anggota grup WhatsApp secara instan ke file CSV 14 kolom dengan resolusi LID (Lid-to-Jid resolution) untuk penargetan campaign yang aman.
- **Single Message Composer:** Pengiriman pesan individual cepat dengan dukungan lampiran media dan pembuatan jajak pendapat (polls).
- **Media Upload Manager:** Upload gambar (maksimal 5 MB), video (maksimal 10 MB), audio (maksimal 2 MB), dan dokumen (maksimal 5 MB) dengan mitigasi Stored XSS, metadata kepemilikan tenant di `uploaded_media`, serta download/delete terautentikasi hanya untuk pemilik file.
- **Consent & Opt-Out Handling:** Sistem filter daftar pencegahan (suppression list) otomatis jika penerima membalas dengan kata kunci seperti STOP, UNSUBSCRIBE, atau BERHENTI.
- **Session Auto-Repair & Crypt-Key Reset:** Pemantauan dan pemulihan otomatis sesi terputus berdurasi setiap 10 menit ([auto_repair_disconnected.js](file:///d:/Self%20Project/WA-Bot/backend/scripts/auto_repair_disconnected.js)) di staging VPS dengan pembatasan laju 5x/24j dan alert Telegram. Fitur manual Repair pada UI Session Manager juga tersedia untuk membersihkan cache kunci Signal tanpa menghapus kredensial utama.
- **Chatbot AI Error logs & Dashboard Alerts:** Deteksi dan pencatatan error API/saldo chatbot AI secara persisten ke database serta visualisasi Alert Box glassmorphic merah self-healing di dashboard admin.
- **Database & File Pruner Otomatis:** Script pruner berkala (`npm run logs:prune:apply`) untuk menghapus log pengiriman lama, log warmer, file ekspor lawas, dan berkas cadangan (backup) kedaluwarsa secara otomatis serta melakukan SQLite VACUUM untuk merampingkan ukuran database.
- **Security Hardening Baseline:** Login dashboard admin berbasis secure cookie HttpOnly, proteksi kunci API server-to-server (X-API-Key), Content Security Policy (CSP) ketat yang mendukung Google Fonts & Websocket staging, serta in-memory API rate limiter.
- **Multi-User RBAC & Tenant Isolation:** Login JWT dual-cookie dengan access/refresh token, refresh token rotation/revocation, User Management admin-only, role `admin`/`user`, serta isolasi data per `user_id`.
- **SaaS Plans & Entitlements:** Admin mengatur paket langganan di Plans Management; runtime menolak sesi, campaign bulanan, chatbot flow, upload, single-message, dan warmer action saat subscription tidak aktif atau kuota habis.
- **Race-Safe Device Quota:** Kuota device WhatsApp menggunakan `subscription_plans.max_sessions` sebagai sumber limit utama dan reservasi slot sesi atomik di SQLite untuk mencegah race condition saat banyak request masuk bersamaan.
- **Audit Logs:** Tindakan sensitif seperti auth, user, session, campaign, template, chatbot flow, proxy, dan setting tercatat di tabel `audit_logs`; admin melihat global, user hanya melihat log aktornya sendiri.
- **Admin-Only Monitoring:** Menu dan route Monitoring hanya untuk admin/operator platform; user tenant biasa fokus pada data dan device miliknya sendiri.
- **SaaS Operations Baseline:** Keputusan tenant/admin global, entitlement, audit log, backup/retention, acceptable use, dan launch gates dicatat di `docs/SAAS_OPERATIONS.md`.
- **Fully Transparent QR Code Generator:** Pembuatan QR Code kustom dengan latar belakang transparan penuh pada sela-sela modul dan pola mata pojok (finder pattern) menggunakan HTML5 Canvas 2D compositing, dengan opsi gaya transparansi terpisah untuk menjaga kemudahan pemindaian (scannable).

---

## Prasyarat Sistem

- Node.js >= 18.16.0
- npm >= 9.x
- Sistem Operasi: Windows, Linux (Ubuntu disarankan untuk staging), macOS

---

## Cara Menjalankan Secara Lokal

### Menggunakan Skrip Otomatis

#### Windows:
```powershell
.\run.bat
```

#### Linux / macOS:
```bash
chmod +x run.sh
./run.sh
```

### Secara Manual

#### Terminal 1 - Backend (API & Session Manager):
```bash
cd backend
npm install
npm start
```

#### Terminal 2 - Frontend (React Dev Server):
```bash
cd frontend
npm install
npm run dev
```

### Alamat Endpoint Default Lokal:

| Layanan | URL | Deskripsi |
|---------|-----|-----------|
| Backend API | `http://localhost:3001/api` | REST API utama |
| Frontend Dev | `http://localhost:5173` | Halaman dashboard React dev |

---

## Arsitektur Sistem & Peran Proses

### Topologi Hubungan Komponen:
```
Frontend (React/Vite)
       |
       | /api (Caddy / Nginx Reverse Proxy)
       v
Backend (Express.js Monolith atau Split Roles)
  |-- SQLite (database.sqlite)
  |-- Baileys (WhatsApp WebSocket integration)
  |-- Sessions (kredensial autentikasi WhatsApp)
  |-- Uploads (media runtime & lampiran)
```

### Mode Eksekusi Peran Proses (Process Roles):
Untuk deployment di lingkungan server produksi/staging, backend dapat dijalankan secara terpisah menggunakan systemd atau PM2 dengan perintah berikut:

- **Monolith Mode (API + Workers):** `npm start`
- **API Server Only:** `npm run start:api` (Express HTTP server saja, dapat mendelegasikan sesi ke manajer sesi internal lewat `WA_BOT_SESSION_MANAGER_URL`)
- **Combined Worker:** `npm run start:worker` (Menjalankan session manager, polling campaign, dan polling warmer secara bersamaan tanpa HTTP API publik)
- **Session Manager Only:** `npm run start:sessions` (Menjalankan manajer sesi Baileys saja)
- **Campaign Worker Only:** `npm run start:campaign-worker` (Memproses antrean pengiriman pesan campaign massal)
- **Warmer Worker Only:** `npm run start:warmer-worker` (Memproses simulasi chat pemanasan reputasi akun)

---

## Panduan Pengujian (Testing)

### Pengujian Unit & Integrasi Backend
Memvalidasi seluruh logika internal backend (validator input, parser spintax, auth token rotation/revocation, campaign tenant personalization, pruner logs, kuota device plan-based, audit/plan entitlement, uploaded-media tenant isolation/delete, dan isolasi/mapping sesi flow) menggunakan SQLite test database tanpa memerlukan server berjalan. Suite terakhir: 99 test pass.
```bash
cd backend
npm test
```

### Smoke Test Peluncuran (Deploy Smoke Test)
Menjalankan pengujian cepat pasca-deploy untuk memastikan keandalan API publik dan respons delegasi internal:
```bash
cd backend
npm run test:smoke
```

### Pengujian Integrasi Sistem QA
Melakukan simulasi QA menyeluruh (verifikasi skema database inti dan pengujian endpoint API melalui Axios). Memerlukan server backend API berjalan di port `3001`.
```bash
# Terminal 1:
cd backend && npm run start:api

# Terminal 2:
cd qa_tests && npm test
```

---

## Panduan Pemeliharaan (Maintenance)

### 1. Pencadangan Data (Backup & Restore)
- **Backup Terenkripsi:** Membuat salinan basis data dan sesi Baileys terkompresi serta terenkripsi dengan AES-256-GCM.
  ```bash
  cd backend
  npm run backup:encrypted
  ```
- **Restore Drill:** Simulasi pemulihan dari berkas cadangan terenkripsi terakhir untuk memastikan integritas data.
  ```bash
  cd backend
  npm run restore:drill
  ```
- **Offsite Backup:** Pada staging VPS, salinan berkas cadangan terenkripsi otomatis dikirimkan ke Telegram melalui integrasi bot Telegram.

### 2. Pembersihan Rutin (Log & File Pruning)
Script pruner akan menghapus log pengiriman lama yang melebihi retensi, log warmer, file CSV hasil ekspor lawas, serta berkas backup kedaluwarsa.
```bash
cd backend
npm run logs:prune:apply
```

---

## Keamanan & Praktik Terbaik

- **Jangan Ekspos Port 3001:** Port API backend `3001` tidak boleh dibuka ke internet publik. Gunakan reverse proxy (seperti Caddy atau Nginx) untuk mengamankan lalu lintas data.
- **Frontend Build Guard:** Frontend memiliki mekanisme proteksi build (`assert-production-api-url.mjs`) yang akan menghentikan build jika aset produksi kedapatan memanggil URL private backend `:3001/api`. Selalu set `VITE_API_URL=/api` saat membangun aset produksi.
- **Isolasi Database & Kredensial:** Batasi hak akses direktori `backend/sessions/`, `backend/database.sqlite`, dan `.env` menggunakan izin sistem operasi ketat (rekomendasi chmod `640` / `600`).
- **AES-GCM Key Encryption:** Konfigurasikan `WA_BOT_SECRET_ENCRYPTION_KEY` di environment untuk memastikan kunci API Chatbot AI tersimpan dalam bentuk terenkripsi di database SQLite.
- **Monitoring Mandiri:** Pantau performa melalui endpoint kesiapan `/health/ready` (untuk API publik) dan `/internal/health/ready` (untuk internal workers). Netdata diatur hanya mendengarkan di localhost (`127.0.0.1:19999`) dan diakses aman menggunakan SSH Tunneling.

---

## Indeks Dokumentasi Lengkap

Seluruh dokumentasi teknis tersimpan di dalam folder `docs/`. Anda dapat merujuk ke dokumen berikut untuk pemahaman mendalam:

| Berkas Dokumen | Tujuan & Deskripsi |
|----------------|---------------------|
| [sdlc_documentation.md](file:///d:/Self%20Project/WA-Bot/sdlc_documentation.md) | Dokumen master SDLC: SRS, arsitektur, test plan, dan peta jalan VPS. |
| [docs/RUNBOOK.md](file:///d:/Self%20Project/WA-Bot/docs/RUNBOOK.md) | Panduan operasional harian, tata cara pemulihan darurat, pruner, dan backup. |
| [docs/SECURITY.md](file:///d:/Self%20Project/WA-Bot/docs/SECURITY.md) | Kebijakan keamanan, kontrol aktif, backend hardening, dan checklist rilis. |
| [docs/PRIVACY.md](file:///d:/Self%20Project/WA-Bot/docs/PRIVACY.md) | Kebijakan pesan, aturan persetujuan (consent), penanganan opt-out, dan retensi log. |
| [docs/MONITORING.md](file:///d:/Self%20Project/WA-Bot/docs/MONITORING.md) | Metrik yang harus dipantau, batas ambang sumber daya (thresholds), dan respons alert. |
| [docs/STAGING.md](file:///d:/Self%20Project/WA-Bot/docs/STAGING.md) | Catatan dan bukti verifikasi lingkungan staging VPS. |
| [docs/CODEBASE_QUALITY.md](file:///d:/Self%20Project/WA-Bot/docs/CODEBASE_QUALITY.md) | Panduan migrasi logger Pino, response helper, dan struktur config. |
| [docs/MEDIA_UPLOAD_WORKLOG.md](file:///d:/Self%20Project/WA-Bot/docs/MEDIA_UPLOAD_WORKLOG.md) | Catatan log implementasi fitur pengunggahan media di backend & frontend. |
| [docs/deploy/README.md](file:///d:/Self%20Project/WA-Bot/docs/deploy/README.md) | Template konfigurasi server (PM2, systemd, Caddy, logrotate). |
| [docs/openapi.yaml](file:///d:/Self%20Project/WA-Bot/docs/openapi.yaml) | Spesifikasi OpenAPI 3.0 untuk endpoints REST API. |
| [checklist.html](file:///d:/Self%20Project/WA-Bot/checklist.html) | Halaman referensi interaktif status roadmap development. |
| [AGENTS.md](file:///d:/Self%20Project/WA-Bot/AGENTS.md) | Catatan serah terima (handoff context) untuk agen AI berikutnya. |

---

## Lisensi

Proyek internal eksklusif. Dilarang mendistribusikan ulang kode sumber tanpa persetujuan tertulis pemilik lisensi.
