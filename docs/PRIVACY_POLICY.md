# Kebijakan Privasi (Privacy Policy) - WA-Bot Pro

**Versi:** 1.0.0  
**Tanggal Berlaku:** 28 Juni 2026  
**Status:** Dokumen Hukum Publik  

Penyedia WA-Bot Pro ("Kami") berkomitmen untuk melindungi privasi pelanggan ("Anda", "Tenant") dan data penerima pesan (kontak) Anda. Kebijakan Privasi ini menjelaskan bagaimana data Anda dikumpulkan, disimpan, diproses, dan dilindungi di platform kami.

---

## 1. Data yang Kami Kumpulkan dan Simpan
Untuk menyediakan fungsionalitas pengiriman pesan dan manajemen chatbot, sistem kami mengumpulkan dan menyimpan data berikut:
* **Informasi Akun**: Nama pengguna (username), nama tampilan (display name), alamat email (jika ada), hash kata sandi terenkripsi (bcrypt), dan informasi paket langganan.
* **Sesi WhatsApp (Credentials)**: Kredensial autentikasi WhatsApp yang dihasilkan saat Anda memindai kode QR (menggunakan pustaka Baileys). Kredensial ini disimpan secara lokal di server dalam direktori isolasi (`backend/sessions/`) untuk menjaga koneksi socket tetap aktif.
* **Data Kontak & Grup**: Nama kontak, nomor telepon, dan daftar grup WhatsApp yang Anda impor atau ambil dari perangkat terhubung untuk keperluan kampanye.
* **Konten & Template**: Teks pesan, lampiran file media (gambar/video yang Anda unggah ke folder `/api/uploads/media`), dan alur logika chatbot (Chatbot Flows).
* **Log Pengiriman (Delivery Logs)**: Catatan status pesan terkirim/gagal, stempel waktu (timestamp), nomor tujuan, dan log kesalahan untuk keperluan audit dan statistik monitoring.
* **Kredensial Pihak Ketiga (AI Provider Key)**: API Key untuk Chatbot AI (seperti OpenAI/Gemini Key) yang diisi oleh pengguna disimpan di database. API key ini disamarkan di UI dan dapat dienkripsi at-rest menggunakan algoritma AES-256-GCM jika kunci enkripsi diaktifkan di server.

## 2. Pemrosesan Data dan Isolasi Multi-Tenant
* **Isolasi Tenant**: Sistem kami menerapkan pembatasan `user_id` yang ketat pada setiap kueri database SQLite. Data Anda (sesi, kontak, kampanye, log) sepenuhnya terisolasi dan tidak dapat dilihat atau diakses oleh pengguna/tenant lain.
* **Tujuan Pemrosesan**: Kami memproses data Anda semata-mata untuk mengoperasikan Layanan, memvalidasi kuota penggunaan, menjalankan kampanye pesan Anda, dan memproses respons chatbot otomatis. Kami tidak menjual atau membagikan data Anda atau daftar kontak Anda kepada pihak ketiga untuk tujuan periklanan atau komersial lainnya.

## 3. Keamanan Data
* **Keamanan Cookie & Sesi**: Dashboard kami menggunakan dual-JWT (access token + refresh token) untuk autentikasi. Token dikirim melalui cookie HTTP-Only yang aman dengan bendera `Secure` (pada HTTPS) dan proteksi `SameSite` untuk mencegah serangan CSRF/XSS.
* **Enkripsi Cadangan**: Berkas cadangan database dan sesi di server dikompresi dan dienkripsi menggunakan sandi AES-256-GCM sebelum disimpan secara offsite untuk mencegah kebocoran data jika terjadi pembobolan infrastruktur.
* **Masking Data Sensitif**: Informasi sensitif seperti kredensial proxy atau API Key Chatbot AI disamarkan (*masked*) pada respons API publik untuk mencegah pembacaan langsung di sisi klien.

## 4. Akses Data oleh Operator/Admin
* **Akses Global Terbatas**: Administrator platform kami memiliki akses global untuk memantau kesehatan sistem, penggunaan sumber daya, dan melakukan perbaikan otomatis/manual.
* **Kepatuhan Audit**: Tindakan administratif (seperti pembuatan/penonaktifan user, modifikasi proxy global, pemangkasan database, atau inisiasi restore cadangan) dicatat secara append-only di tabel `audit_logs` untuk mencegah penyalahgunaan wewenang admin.

## 5. Cookie Aplikasi
Kami menggunakan cookie teknis yang diperlukan untuk:
* Mempertahankan sesi login Anda (JWT access/refresh tokens).
* Menerapkan pembatasan laju (*rate limiting*) untuk melindungi API backend dari serangan DDoS atau brute-force.

## 6. Hubungi Kami
Jika Anda memiliki pertanyaan tentang kebijakan privasi ini atau ingin mengajukan perbaikan informasi akun Anda, silakan hubungi tim administrator platform.
