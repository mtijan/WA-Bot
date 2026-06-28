# WA-Bot Platform Governance and Compliance Policy

Dokumen ini merinci kebijakan tata kelola platform, evaluasi risiko integrasi, serta protokol operasional untuk meminimalkan risiko pemblokiran nomor pada sistem WA-Bot.

Untuk keputusan operasional SaaS lintas-tenant, billing, audit log, backup, retention, launch gate, dan customer policy, gunakan [SAAS_OPERATIONS.md](./SAAS_OPERATIONS.md) sebagai decision record pendamping.

---

## 1. Evaluasi Teknis & Kepatuhan: Baileys vs WhatsApp Business Platform Resmi

Sistem WA-Bot saat ini menggunakan **Baileys**, yang merupakan integrasi tidak resmi (*unofficial reverse-engineered Web WA library*). Berikut adalah analisis risiko dan perbandingannya dengan **WhatsApp Business Platform (Cloud API Resmi)**:

| Dimensi | Baileys (Headless / Web Bypass) | WhatsApp Business Platform (API Resmi) |
|---|---|---|
| **Kepatuhan Hukum** | Melanggar Ketentuan Layanan (ToS) WhatsApp. Nomor berisiko tinggi diblokir permanen oleh Meta. | 100% patuh terhadap kebijakan Meta. Tidak ada risiko pemblokiran nomor untuk penggunaan normal. |
| **Biaya Pesan** | Gratis (hanya biaya infrastruktur server mandiri). | Berbayar per sesi percakapan berdasarkan tarif resmi Meta (*Conversation-Based Pricing*). |
| **Fitur Grup** | Mendukung pembacaan grup, ekstraksi anggota, dan pengiriman pesan ke grup secara penuh. | Sangat terbatas, tidak mendukung ekstraksi anggota grup secara native. |
| **Fleksibilitas Pesan** | Pesan interaktif (tombol, media) dapat langsung dikirim tanpa persetujuan awal dari Meta. | Templat pesan (*message templates*) wajib melalui persetujuan (approval) Meta sebelum dapat dikirim. |
| **Stabilitas API** | Rentan terganggu apabila Meta melakukan pembaruan protokol WhatsApp Web secara sepihak. | Sangat stabil dengan dokumentasi resmi dan jaminan *uptime* dari Meta. |

### Rekomendasi Penggunaan
1. **Fase Uji Coba & Internal:** Pustaka Baileys aman digunakan untuk operasional internal, pengetesan fitur, ekstraksi grup internal, dan pengiriman transaksional skala kecil.
2. **Fase Produksi Kritis (Business-Critical):** Untuk pengiriman pesan skala besar yang krusial bagi bisnis (seperti notifikasi OTP, pengingat tagihan, atau dukungan pelanggan skala besar), sangat disarankan untuk bermigrasi ke WhatsApp Business Platform resmi guna menghindari risiko pemadaman layanan akibat pemblokiran nomor.

---

## 2. Protokol Batas Operasional & Pemanasan Akun (Warmup Protocol)

Guna mengurangi kecurigaan algoritma anti-spam Meta saat menggunakan Baileys, setiap operator wajib mengikuti batasan berikut:

### A. Batasan Kecepatan Pengiriman (Rate Limiting)
- **Volume Harian:** Maksimal 100-200 pesan per hari per nomor pengirim WhatsApp.
- **Jeda Pengiriman (Delay):** Wajib menggunakan jeda acak (*random delay*) antara 30 hingga 90 detik antar-pesan. Hindari jeda konstan (misal tepat setiap 5 detik) karena pola tersebut mudah dideteksi sebagai bot.
- **Variasi Pesan (Spintax):** Hindari mengirimkan teks yang identik secara massal. Gunakan fitur Spintax (misal `{Halo|Hai|Selamat pagi}`) untuk memvariasikan isi pesan.

### B. Protokol Pemanasan Akun Baru (Warmup Protocol)
Sebelum sebuah nomor baru digunakan untuk mengirimkan kampanye bulk:
1. **Langkah Awal:** Gunakan fitur **Warmer Campaign** untuk melakukan simulasi chat dua arah antar-nomor internal yang terhubung selama 7-14 hari.
2. **Eskalasi Bertahap:** Mulai pengiriman dengan volume kecil (5-10 pesan per hari), lalu tingkatkan secara bertahap sebanyak 5-10 pesan tambahan setiap harinya hingga mencapai kapasitas maksimum harian yang aman.
3. **Interaksi Organik:** Pastikan nomor tersebut juga digunakan untuk menerima chat masuk dan dibalas secara manual oleh manusia untuk membangun reputasi organik.

---

## 3. Kebijakan Persetujuan & Supresi Opt-Out (Consent & Opt-Out Policy)

Kepatuhan terhadap privasi penerima pesan adalah kunci utama mempertahankan reputasi nomor WhatsApp.

### A. Persetujuan Awal (Consent)
- Pesan hanya boleh dikirim kepada nomor penerima yang telah memberikan persetujuan eksplisit (misal melalui pengisian formulir langganan, pendaftaran acara, atau kontrak kerja sama).
- Penggunaan basis data kontak hasil gosokan (*scraping*) atau pembelian dari pihak ketiga tanpa izin penerima dilarang keras karena akan memicu pelaporan instan (*report spam*) oleh penerima.

### B. Penanganan Opt-Out Otomatis
- Setiap templat pesan kampanye keluar wajib mencantumkan instruksi berhenti berlangganan yang jelas (misalnya: *\"Balas STOP untuk berhenti menerima pesan ini\"*).
- Sistem secara otomatis akan mendeteksi pesan masuk berupa kata kunci `STOP`, `BERHENTI`, atau `UNSUBSCRIBE` dan langsung memasukkan nomor tersebut ke tabel supresi `opt_out_contacts`.
- Sistem bulk campaign akan melewati (*skip*) nomor mana pun yang terdaftar dalam tabel supresi ini secara absolut.
