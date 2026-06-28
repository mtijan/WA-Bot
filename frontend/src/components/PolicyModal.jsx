import { X } from 'lucide-react';

function PolicyModal({ isOpen, onClose, policyType }) {
  if (!isOpen) return null;

  const getPolicyContent = () => {
    switch (policyType) {
      case 'tos':
        return {
          title: 'Ketentuan Layanan (Terms of Service)',
          sections: [
            {
              heading: '1. Pendaftaran dan Akun',
              content: 'Pelanggan harus berusia minimal 18 tahun untuk menggunakan Layanan ini. Anda bertanggung jawab penuh atas keamanan akun Anda, termasuk kerahasiaan kata sandi Anda. Anda wajib memberikan informasi yang akurat selama proses pendaftaran.'
            },
            {
              heading: '2. Penggunaan Layanan dan Batasan Quota',
              content: 'Penggunaan Anda terhadap Layanan tunduk pada batas kuota paket langganan Anda (termasuk batas jumlah device/sesi WhatsApp, kampanye bulk message bulanan, dan jumlah alur chatbot). Upaya untuk melewati batasan ini melalui modifikasi teknis yang tidak sah dianggap sebagai pelanggaran ketentuan.'
            },
            {
              heading: '3. Penafian Risiko Platform Pihak Ketiga (WhatsApp & Baileys)',
              content: 'Layanan kami menggunakan pustaka integrasi WhatsApp tidak resmi (Baileys). WhatsApp/Meta sewaktu-waktu dapat memperbarui protokol mereka yang dapat mengganggu, membatasi, atau menonaktifkan fungsi Layanan ini secara permanen. Penggunaan otomatisasi membawa risiko pemblokiran akun oleh WhatsApp/Meta yang ditanggung sepenuhnya oleh Pelanggan.'
            },
            {
              heading: '4. Biaya, Pembayaran, dan Refund',
              content: 'Layanan ini disediakan berdasarkan paket langganan berbayar bulanan atau tahunan. Seluruh biaya harus dibayar di muka. Seluruh pembayaran yang telah dilakukan bersifat final dan tidak dapat dikembalikan (non-refundable).'
            },
            {
              heading: '5. Kepemilikan Data dan Isolasi Data',
              content: 'Pelanggan memegang hak penuh atas seluruh data kontak, konten pesan, dan template yang diunggah ke Layanan. Penyedia menjamin bahwa data Anda diisolasi secara ketat berdasarkan user_id di tingkat database dan tidak akan dapat diakses oleh tenant lain.'
            },
            {
              heading: '6. Penghentian Layanan (Termination)',
              content: 'Anda dapat menghentikan akun Anda kapan saja. Kami berhak menghentikan atau menangguhkan akun Anda segera tanpa pemberitahuan sebelumnya jika Anda melanggar ketentuan hukum atau Acceptable Use Policy kami.'
            }
          ]
        };
      case 'aup':
        return {
          title: 'Kebijakan Penggunaan Diterima (Acceptable Use Policy)',
          sections: [
            {
              heading: '1. Aktivitas yang Dilarang',
              content: 'Dilarang menggunakan Layanan untuk mengirimkan pesan spam, pesan pemasaran massal kepada penerima yang tidak memberikan persetujuan eksplisit, kontak hasil scraped/beli, judi online, narkoba, pornografi, penipuan (phishing), ujaran kebencian, dan pelecehan.'
            },
            {
              heading: '2. Kewajiban Pengelolaan Opt-Out',
              content: 'Setiap pesan pemasaran atau broadcast massal wajib menyertakan instruksi penolakan/keluar yang jelas bagi penerima. Sistem backend secara otomatis mendeteksi kata kunci STOP, UNSUBSCRIBE, dan BERHENTI untuk memindahkan nomor penerima ke suppression list.'
            },
            {
              heading: '3. Praktik Pengiriman Pesan yang Aman',
              content: 'Anda wajib menggunakan jeda waktu acak (delay) yang menyerupai manusia saat melakukan pengiriman massal. Untuk nomor pengirim baru, lakukan warmup secara bertahap. Laporan keluhan spam berulang dapat memicu penangguhan akun.'
            },
            {
              heading: '4. Pemantauan dan Sanksi',
              content: 'Penyedia menerapkan pemindaian otomatis terhadap lalu lintas pesan untuk mendeteksi spamming massal. Pelanggaran AUP akan memicu penonaktifan akun (is_active=0), penghentian kampanye, pemutusan sesi WhatsApp, tanpa pengembalian dana.'
            }
          ]
        };
      case 'privacy':
        return {
          title: 'Kebijakan Privasi (Privacy Policy)',
          sections: [
            {
              heading: '1. Data yang Kami Kumpulkan',
              content: 'Kami menyimpan informasi akun (username, nama tampilan, hash kata sandi bcrypt), kredensial sesi WhatsApp Baileys (di folder terisolasi /backend/sessions/), data kontak & grup, konten & template, log pengiriman (delivery logs), serta API Key Chatbot AI.'
            },
            {
              heading: '2. Pemrosesan Data dan Isolasi Multi-Tenant',
              content: 'Sistem menerapkan pembatasan user_id pada setiap kueri database. Data Anda sepenuhnya terisolasi dan tidak dapat diakses oleh tenant lain. Data diproses hanya untuk operasional dan tidak dijual kepada pihak ketiga.'
            },
            {
              heading: '3. Keamanan Data',
              content: 'Dashboard menggunakan dual-JWT yang aman melalui cookie HTTP-Only Secure. Berkas cadangan database dan sesi dienkripsi dengan algoritma AES-256-GCM. Informasi sensitif seperti API Key AI dan kredensial proxy disamarkan pada respons API.'
            },
            {
              heading: '4. Akses Admin & Audit',
              content: 'Admin memiliki hak akses administratif global terbatas untuk tujuan pemeliharaan. Seluruh tindakan sensitif admin dicatat secara append-only di tabel audit_logs untuk mencegah penyalahgunaan wewenang.'
            }
          ]
        };
      case 'deletion':
        return {
          title: 'Kebijakan Penangguhan & Penghapusan Data',
          sections: [
            {
              heading: '1. Retensi dan Pembersihan Log Otomatis',
              content: 'Log pengiriman pesan (delivery_logs dan warmer_logs) disimpan selama jumlah hari yang ditentukan oleh WA_BOT_LOG_RETENTION_DAYS (default: 30 hari) lalu dihapus otomatis. File media terunggah dihapus jika tidak ditautkan aktif ke template/flow.'
            },
            {
              heading: '2. Kebijakan Penangguhan Akun (Grace Period)',
              content: 'Akun ditangguhkan dengan menonaktifkan is_active=0 dan membatalkan cookie token. Seluruh data tetap disimpan dengan aman selama minimal 30 hari masa tenggang sebelum dihapus permanen.'
            },
            {
              heading: '3. Kebijakan Penghentian Akun',
              content: 'Setelah akun dihentikan atau masa tenggang berakhir, folder sesi WhatsApp Baileys dan seluruh data database terkait user_id Pelanggan akan dibersihkan secara permanen dalam jangka waktu 7 hari kerja.'
            },
            {
              heading: '4. Hak untuk Dihapus (Right to be Forgotten)',
              content: 'Pelanggan dapat mengajukan permohonan penghapusan seluruh data pribadi secara instan. Setelah dikonfirmasi, data terkait user_id akan dihapus seketika dari database operasional dan sistem file server.'
            }
          ]
        };
      default:
        return { title: '', sections: [] };
    }
  };

  const { title, sections } = getPolicyContent();

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(9, 13, 22, 0.65)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '1.5rem',
      fontFamily: '"Outfit", "Inter", sans-serif'
    }}>
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '650px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        color: '#f1f5f9',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#818cf8' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '1.5rem',
          overflowY: 'auto',
          flex: 1,
          lineHeight: 1.6,
          fontSize: '0.9rem'
        }}>
          {sections.map((sec, idx) => (
            <div key={idx} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.02rem', fontWeight: 700, color: '#f8fafc' }}>
                {sec.heading}
              </h3>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.88rem' }}>
                {sec.content}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(255, 255, 255, 0.01)'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.5rem',
              border: 0,
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            Selesai Membaca
          </button>
        </div>
      </div>
    </div>
  );
}

export default PolicyModal;
