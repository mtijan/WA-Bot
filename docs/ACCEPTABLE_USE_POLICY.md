# Kebijakan Penggunaan yang Diterima (Acceptable Use Policy - AUP) - WA-Bot Pro

**Versi:** 1.0.0  
**Tanggal Berlaku:** 28 Juni 2026  
**Status:** Dokumen Hukum Publik  

Kebijakan Penggunaan yang Diterima (AUP) ini menetapkan aturan penggunaan Layanan WA-Bot Pro. Kebijakan ini dirancang untuk melindungi reputasi infrastruktur pengiriman pesan kami, memastikan kepatuhan terhadap hukum setempat, dan mencegah penyalahgunaan platform WhatsApp.

Setiap pelanggan wajib mematuhi kebijakan ini. Pelanggaran terhadap AUP ini dapat menyebabkan penangguhan akun secara instan tanpa hak pengembalian dana (refund).

---

## 1. Aktivitas yang Dilarang
Anda dilarang keras menggunakan Layanan untuk mengirimkan pesan atau melakukan aktivitas yang mengandung:
* **Spam dan Pesan Tanpa Persetujuan (Unsolicited Messages)**: Mengirimkan pesan pemasaran massal kepada penerima yang tidak memberikan persetujuan eksplisit (opt-in) sebelumnya untuk menerima pesan dari Anda.
* **Daftar Kontak Hasil Scraped/Beli**: Mengimpor, memverifikasi, atau mengirim pesan ke daftar nomor telepon yang diperoleh dari hasil scraping publik, pembelian database pihak ketiga, atau cara non-konsensus lainnya.
* **Konten Ilegal**: Mempromosikan judi online, narkoba, pornografi, prostitusi, perdagangan manusia, senjata ilegal, atau barang/jasa lain yang melanggar hukum Republik Indonesia.
* **Penipuan & Phishing**: Mengirimkan pesan yang berpura-pura menjadi lembaga keuangan, instansi pemerintah, atau entitas lain untuk mencuri informasi pribadi, kredensial akun, atau menipu penerima secara finansial.
* **Ujaran Kebencian & Pelecehan**: Mengirimkan konten yang mempromosikan diskriminasi, kebencian, kekerasan terhadap individu atau kelompok berdasarkan ras, agama, suku, gender, atau orientasi seksual.

## 2. Kewajiban Pengelolaan Opt-Out
Setiap pesan pemasaran atau broadcast massal yang dikirim melalui Layanan **wajib** menyertakan instruksi penolakan/keluar yang jelas bagi penerima pesan.
* **Keyword Otomatis**: Sistem backend kami secara otomatis mendeteksi kata kunci masuk pribadi seperti `STOP`, `UNSUBSCRIBE`, dan `BERHENTI`. Jika penerima membalas dengan kata kunci ini, nomor mereka akan dimasukkan ke dalam daftar pencegahan (*suppression list*).
* **Kepatuhan Pengiriman**: Kampanye bulk message bulanan secara otomatis akan melewati nomor yang terdaftar di suppression list. Anda dilarang memanipulasi sistem atau mencoba mem-bypass suppression list untuk terus mengirim pesan kepada penerima yang telah melakukan opt-out.

## 3. Praktik Pengiriman Pesan yang Aman (Platform Governance)
Untuk menjaga agar nomor WhatsApp Anda tidak diblokir dan sistem tetap berjalan stabil:
* **Human-like Delays**: Anda wajib menggunakan pengaturan jeda waktu acak (delay) yang menyerupai manusia saat melakukan pengiriman massal. Mengirim pesan terlalu cepat secara beruntun merupakan indikasi kuat spam yang akan memicu pemblokiran otomatis oleh WhatsApp.
* **Ramp-Up**: Untuk nomor telepon/sender baru, lakukan pemanasan (warmup) secara bertahap dengan volume kecil sebelum mengirimkan pesan massal dalam jumlah besar.
* **Tanggapan Keluhan**: Jika nomor Anda menerima laporan spam (spam complaints) berulang kali dari penerima pesan atau diblokir oleh WhatsApp secara konstan, Kami berhak menangguhkan akun Layanan Anda guna melindungi alamat IP proxy dan infrastruktur sistem kami.

## 4. Pemantauan dan Tindakan Pelanggaran
* **Pemantauan Otomatis**: Penyedia menerapkan sistem pemindaian otomatis terhadap pola lalu lintas pesan untuk mendeteksi lonjakan pengiriman mencurigakan atau indikasi spamming massal.
* **Penangguhan Akun**: Jika Anda terbukti melanggar ketentuan AUP ini, admin platform berhak menonaktifkan akun Anda (`is_active=0`), menghentikan semua kampanye aktif, dan memutuskan sesi WhatsApp terhubung segera.
* **Pelaporan Hukum**: Pelanggaran hukum yang berat (seperti penipuan finansial terorganisir atau penyebaran materi ilegal) akan dilaporkan kepada pihak kepolisian Republik Indonesia beserta data log yang relevan.
