# Kebijakan Penangguhan & Penghapusan Data (Suspension & Data Deletion Policy) - WA-Bot Pro

**Versi:** 1.0.0  
**Tanggal Berlaku:** 28 Juni 2026  
**Status:** Dokumen Hukum Publik  

Kebijakan ini menjelaskan jangka waktu penyimpanan data, prosedur penangguhan akun, dan proses penghapusan data secara permanen dari sistem WA-Bot Pro untuk menjamin efisiensi penyimpanan server dan menghormati hak privasi pengguna.

---

## 1. Retensi dan Pembersihan Log Otomatis
Untuk menjaga performa database SQLite dan menghemat penyimpanan VPS, kami menerapkan kebijakan retensi log pengiriman pesan secara ketat:
* **Log Pengiriman & Warmer**: Catatan pada tabel `delivery_logs` dan `warmer_logs` akan disimpan selama jumlah hari yang ditentukan oleh variabel lingkungan `WA_BOT_LOG_RETENTION_DAYS` (default: 30 hari).
* **Pembersihan Otomatis (Pruner)**: Sistem secara berkala menjalankan skrip `npm run logs:prune:apply` untuk menghapus data log yang usang, file ekspor kontak lama (`ExportWAContacts_*.csv`), dan folder cadangan terenkripsi yang berumur lebih dari batas retensi.
* **Aset Media Upload**: File gambar atau video yang diunggah ke folder `/api/uploads/media` akan tetap disimpan selama aset tersebut masih ditautkan aktif ke template pesan atau alur chatbot aktif Anda. File media yang tidak terpakai lagi akan dihapus dalam tinjauan pemeliharaan bulanan oleh admin.

## 2. Kebijakan Penangguhan Akun (Account Suspension)
Akun Anda dapat ditangguhkan oleh administrator jika terjadi keterlambatan pembayaran langganan atau indikasi pelanggaran [Acceptable Use Policy](ACCEPTABLE_USE_POLICY.md).
* **Tindakan Penangguhan**: Akun pengguna dinonaktifkan (`is_active=0`). Seluruh cookie login dan refresh token dibatalkan seketika (`users.token_version` dinaikkan).
* **Status Sesi WhatsApp**: Seluruh koneksi WhatsApp yang aktif (Baileys socket) milik akun yang ditangguhkan akan diputuskan sementara demi keamanan jaringan.
* **Masa Tenggang (Grace Period)**: Selama masa penangguhan, seluruh data Anda (sesi, kontak, kampanye, alur chatbot) **tetap disimpan dengan aman** selama minimal **30 hari**. Data tidak akan dihapus untuk memberi kesempatan Pelanggan menyelesaikan administrasi langganan.

## 3. Kebijakan Penghentian & Penghapusan Akun (Account Termination)
Jika Pelanggan memutuskan untuk berhenti berlangganan atau masa tenggang penangguhan 30 hari telah terlampaui tanpa penyelesaian administrasi:
* **Penghapusan Kredensial Sesi**: Folder sesi WhatsApp terisolasi milik akun Anda di server (`backend/sessions/`) akan dihapus secara permanen. Kredensial tidak dapat dipulihkan kembali.
* **Penghapusan Data Database**: Seluruh baris data pada tabel `sessions`, `contacts`, `campaigns`, `templates`, dan `chatbot_flows` yang terikat pada `user_id` Pelanggan akan dihapus secara bersih dari database utama.
* **Waktu Eksekusi**: Proses penghapusan data secara menyeluruh setelah akun resmi dinyatakan dihentikan (terminated) akan diselesaikan dalam waktu **7 hari kerja**.

## 4. Hak untuk Dihapus (Right to be Forgotten)
Pelanggan dapat mengajukan permohonan penghapusan seluruh data pribadi mereka dan daftar kontak yang diunggah secara instan dan permanen:
* **Prosedur Pengajuan**: Kirimkan email resmi atau buka tiket dukungan teknis yang meminta "Penghapusan Data Akun Secara Penuh".
* **Verifikasi**: Administrator wajib melakukan verifikasi identitas Pelanggan secara ketat sebelum mengeksekusi perintah penghapusan data database.
* **Pembersihan Bersih**: Setelah dikonfirmasi, seluruh data terkait `user_id` Pelanggan tersebut akan dihapus seketika dari database operasional dan file sistem server. Berkas tersebut hanya akan tersisa pada file cadangan (backups) terenkripsi lama dan akan hilang dengan sendirinya seiring berjalannya rotasi retensi file cadangan (maksimal 30 hari).
