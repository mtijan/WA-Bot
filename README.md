# WA-Bot Pro

WhatsApp Multi-Account & Bulk Messaging System -- platform otomatisasi komunikasi berbasis web untuk mengelola multisesi WhatsApp secara konkuren.

**Status:** Internal baseline, belum production-ready  
**Versi dokumen:** 2.8.2

---

## Fitur Utama

- **Multi-Session Management** -- kelola banyak sesi WhatsApp secara simultan melalui satu antarmuka web.
- **Bulk Campaign** -- kirim pesan massal ke daftar kontak dengan delay acak, personalisasi template (`{{name|first}}`), dan spintax (`{Hi|Hello}`).
- **Account Warmer** -- simulasi percakapan dua arah antar-sesi untuk memanaskan reputasi pengirim.
- **Chatbot Flow** -- alur auto-reply interaktif berbasis node dengan dukungan teks, gambar, video, audio, dan template.
- **Chatbot AI** -- integrasi provider AI (OpenAI, Gemini, dll.) dengan mode operasional per-sesi (off/flow/ai/both).
- **Group Grabber** -- ekstraksi anggota grup WhatsApp ke CSV 14 kolom dengan resolusi LID-ke-JID.
- **Single Message** -- kirim pesan individual dengan media attachment dan poll.
- **Media Upload** -- upload gambar (maks 5 MB) dan video (maks 10 MB) langsung dari UI admin.
- **Consent & Opt-Out** -- suppression list otomatis untuk kata kunci STOP/UNSUBSCRIBE/BERHENTI.
- **Admin Dashboard** -- login admin berbasis cookie HttpOnly, visualisasi statistik, dan manajemen proxy.

---

## Prasyarat

- Node.js >= 18.16.0
- npm >= 9.x
- Sistem operasi: Windows, Linux, macOS

---

## Menjalankan Lokal

### Windows

```powershell
.\run.bat
```

### Linux / macOS / WSL

```bash
./run.sh
```

### Manual

```bash
# Terminal 1 -- Backend
cd backend
npm install
npm start

# Terminal 2 -- Frontend
cd frontend
npm install
npm run dev
```

Endpoint default:

| Layanan | URL |
|---------|-----|
| Backend API | `http://localhost:3001/api` |
| Frontend Dev | `http://localhost:5173` |

---

## Arsitektur Ringkas

```
Frontend (React/Vite)
       |
       | /api (reverse proxy)
       v
Backend (Express.js)
  |-- SQLite (database.sqlite)
  |-- Baileys (WhatsApp WebSocket)
  |-- Sessions (auth state per-sesi)
  |-- Uploads (media runtime)
```

Untuk deployment, backend dapat dijalankan per-role:

| Role | Perintah |
|------|----------|
| Monolith (default lokal) | `npm start` |
| API only | `npm run start:api` |
| Combined worker | `npm run start:worker` |
| Session manager | `npm run start:sessions` |
| Campaign worker | `npm run start:campaign-worker` |
| Warmer worker | `npm run start:warmer-worker` |

---

## Dokumentasi

| Dokumen | Deskripsi |
|---------|-----------|
| `sdlc_documentation.md` | Master SDLC: SRS, arsitektur, test plan, roadmap |
| `docs/html/index.html` | Portal dokumentasi HTML interaktif |
| `docs/RUNBOOK.md` | Panduan operasional harian |
| `docs/SECURITY.md` | Baseline keamanan dan production checklist |
| `docs/PRIVACY.md` | Kebijakan messaging, consent, dan retensi data |
| `docs/MONITORING.md` | Template monitoring dan alert |
| `docs/STAGING.md` | Catatan staging VPS (local-only) |
| `docs/CHANGELOG.md` | Riwayat perubahan per versi |
| `docs/CODEBASE_QUALITY.md` | Baseline kualitas kode dan aturan migrasi |
| `docs/MEDIA_UPLOAD_WORKLOG.md` | Riwayat implementasi media upload |
| `docs/SECURITY_AUDIT.md` | Hasil audit dependensi |
| `docs/deploy/README.md` | Template deploy VPS (systemd, PM2, Caddy, Nginx) |
| `docs/openapi.yaml` | Spesifikasi OpenAPI 3.0 |
| `checklist.html` | Developer checklist interaktif |
| `HANDOFF.md` | Handoff note (local-only) |
| `AGENTS.md` | Agent context (local-only) |

---

## Testing

```bash
# Backend integration & unit tests (54 test cases)
cd backend
npm test

# Deploy smoke test
cd backend
npm run test:smoke

# Browser QA suite
cd qa_tests
npm test
```

---

## Keamanan

- Jangan ekspos port backend `3001` ke internet publik. Gunakan reverse proxy (Caddy/Nginx).
- Jangan masukkan `WA_BOT_API_KEY` atau secret lain ke dalam JavaScript frontend.
- Perlakukan `backend/database.sqlite`, `backend/sessions/`, dan `backend/uploads/` sebagai data sensitif.
- Lihat `docs/SECURITY.md` untuk production checklist lengkap.

---

## Lisensi

Proyek internal. Lihat ketentuan penggunaan yang berlaku.
