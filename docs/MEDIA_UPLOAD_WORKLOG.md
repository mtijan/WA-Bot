# Media Upload Worklog

**Status:** Completed  
**Last updated:** 2026-06-05

Dokumen ini dibuat agar agent berikutnya bisa melanjutkan fitur upload media tanpa mengulang investigasi dari awal.

## Goal

Tambahkan upload media admin supaya operator bisa memakai file lokal, bukan hanya URL eksternal.

Target area:

- Message Templates
- Single Message
- Chatbot Flow node attachments

Target limit:

- Gambar maksimal 5 MB
- Video maksimal 10 MB

## Current Implementation State

Backend foundation sudah mulai dibuat, tetapi fitur belum selesai end-to-end.

Sudah ada:

- Dependency backend `multer`.
- `.gitignore` untuk runtime upload `backend/uploads/`.
- Config upload di `backend/src/config.js`.
- Env example upload di `backend/.env.example`.
- Upload service/controller/routes:
  - `backend/src/services/upload.service.js`
  - `backend/src/controllers/upload.controller.js`
  - `backend/src/routes/upload.routes.js`
- Route upload dimount di `backend/src/index.js` pada `/api/uploads`.
- `backend/src/services/whatsapp.service.js` mulai resolve `/api/uploads/media/<file>` menjadi path lokal sebelum media dikirim via Baileys.

Endpoint yang dituju:

```http
POST /api/uploads/media
Content-Type: multipart/form-data

field: media
```

Response sukses yang diharapkan:

```json
{
  "status": "success",
  "data": {
    "url": "/api/uploads/media/<stored-file>",
    "media_type": "Image",
    "file_name": "original.png",
    "stored_name": "timestamp-uuid.png",
    "mime_type": "image/png",
    "size_bytes": 12345
  }
}
```

## Completed Implementation Details

Semua gap yang ada pada fitur upload media telah diselesaikan dan diverifikasi:
- Controller `backend/src/controllers/upload.controller.js` telah diperbaiki agar signature `sendSuccess` dipanggil dengan benar.
- Komponen frontend reusable `frontend/src/components/MediaUploadField.jsx` telah dibuat untuk menangani upload, status indikator, serta validasi ukuran file client-side (image <= 5MB, video <= 10MB).
- Integrasi ke `Templates.jsx`, `SingleMessage.jsx`, dan `ChatbotFlowModal.jsx` telah selesai. Kolom URL diubah tipenya ke text untuk mendukung path relatif `/api/uploads/media/...`.
- Seluruh syntax check backend dan build frontend telah dijalankan dan lulus tanpa kesalahan.

## Runtime and Security Notes

- `backend/uploads/` adalah runtime data dan tidak boleh masuk git.
- Uploaded media bisa berisi data bisnis atau personal.
- Lindungi upload directory seperti `backend/database.sqlite` dan `backend/sessions/`.
- Untuk public deploy, media upload/serve harus tetap berada di balik auth `/api` dan reverse proxy.
