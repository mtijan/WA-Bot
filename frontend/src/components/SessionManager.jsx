import { useState, useEffect } from 'react';
import { Plus, Smartphone, Trash2, Link, RefreshCw, Wrench } from 'lucide-react';
import { apiRequest } from '../apiClient';

const SessionManager = () => {
  const [sessions, setSessions] = useState([]);
  const [newSessionId, setNewSessionId] = useState('');
  const [activeQr, setActiveQr] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrSessionId, setQrSessionId] = useState('');

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ 
    show: false, 
    title: '', 
    message: '', 
    confirmLabel: 'Ya, Hapus', 
    confirmBtnClass: 'btn-danger', 
    onConfirm: null 
  });

  const triggerConfirm = (title, message, confirmLabel, confirmBtnClass, onConfirm) => {
    setConfirmDialog({
      show: true,
      title,
      message,
      confirmLabel,
      confirmBtnClass,
      onConfirm
    });
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      if (json.status === 'success') {
        setSessions(json.data);
        if (qrSessionId) {
          const current = json.data.find(s => s.session_id === qrSessionId);
          if (current) {
            if (current.status === 'CONNECTED') {
              setActiveQr(null);
              setQrSessionId('');
            } else if (current.qr_code) {
              setActiveQr(current.qr_code);
            }
          }
        }
      }
    } catch (err) {
      console.error('Gagal memuat daftar sesi:', err);
    }
  };

  const handleCreateSession = async (e) => {
    e.preventDefault();
    if (!newSessionId.trim()) return;

    setLoadingQr(true);
    setActiveQr(null);
    setQrSessionId(newSessionId);

    try {
      const json = await apiRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({ session_id: newSessionId }),
      });
      
      if (json.status === 'success') {
        if (json.data && json.data.qr_code) {
          setActiveQr(json.data.qr_code);
        }
        setNewSessionId('');
      } else {
        alert('Gagal membuat sesi baru: ' + json.message);
        setQrSessionId('');
      }
    } catch {
      alert('Gagal menghubungi server API.');
      setQrSessionId('');
    } finally {
      setLoadingQr(false);
      fetchSessions();
    }
  };

  const handleDeleteSession = async (sessionId) => {
    triggerConfirm(
      'Hapus Sesi',
      `Apakah Anda yakin ingin menghapus & keluar dari sesi ${sessionId}?`,
      'Ya, Hapus Sesi',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/sessions/${sessionId}`, {
            method: 'DELETE',
          });
          if (json.status === 'success') {
            if (qrSessionId === sessionId) {
              setActiveQr(null);
              setQrSessionId('');
            }
            fetchSessions();
          } else {
            alert('Gagal menghapus sesi: ' + (json.message || 'Unknown error'));
          }
        } catch (err) {
          const detail = err?.payload?.message || err?.message || String(err);
          alert(`Gagal menghapus sesi: ${detail}`);
          console.error('handleDeleteSession error:', err);
        }
      }
    );
  };

  const handleRepairSession = async (sessionId) => {
    triggerConfirm(
      'Perbaiki Sesi',
      `Apakah Anda yakin ingin memperbaiki sesi ${sessionId}? Ini akan membersihkan cache enkripsi Signal tanpa menghapus koneksi Anda.`,
      'Ya, Perbaiki',
      'btn-primary',
      async () => {
        try {
          const json = await apiRequest(`/sessions/${sessionId}/repair`, {
            method: 'POST',
          });
          if (json.status === 'success') {
            alert('Sesi berhasil diperbaiki dan sedang menghubungkan kembali.');
            fetchSessions();
          } else {
            alert('Gagal memperbaiki sesi: ' + json.message);
          }
        } catch (err) {
          const detail = err?.payload?.message || err?.message || String(err);
          alert(`Gagal memperbaiki sesi: ${detail}`);
          console.error('handleRepairSession error:', err);
        }
      }
    );
  };

  const handleReconnectSession = async (sessionId) => {
    triggerConfirm(
      'Koneksi Ulang Sesi',
      `Apakah Anda yakin ingin menghubungkan ulang sesi ${sessionId}? Ini hanya akan merestart koneksi tanpa menghapus cache data apa pun.`,
      'Ya, Reconnect',
      'btn-primary',
      async () => {
        try {
          const json = await apiRequest(`/sessions/${sessionId}/reconnect`, {
            method: 'POST',
          });
          if (json.status === 'success') {
            alert('Sesi sedang dihubungkan ulang.');
            fetchSessions();
          } else {
            alert('Gagal menghubungkan ulang sesi: ' + json.message);
          }
        } catch (err) {
          const detail = err?.payload?.message || err?.message || String(err);
          alert(`Gagal menghubungkan ulang sesi: ${detail}`);
          console.error('handleReconnectSession error:', err);
        }
      }
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>WhatsApp Devices</h2>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>V 0.0.1</span>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Manage your connected WhatsApp sessions.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeQr ? '1fr 340px' : '1fr', gap: '24px' }}>
        <div>
          <div className="card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Add New Device</h3>
            <form onSubmit={handleCreateSession} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: '250px', marginBottom: 0 }}>
                <label className="form-label">Session ID *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. support-phone-1"
                  value={newSessionId}
                  onChange={(e) => setNewSessionId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  disabled={loadingQr}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loadingQr} style={{ height: '40px' }}>
                <Plus size={16} />
                {loadingQr ? 'Generating QR...' : 'Add Device'}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Connected Devices</h3>
            {sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <Smartphone size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                <p>No devices connected yet.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {sessions.map((session) => (
                  <div key={session.session_id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', backgroundColor: session.status === 'CONNECTED' ? 'var(--success-bg)' : 'var(--danger-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: session.status === 'CONNECTED' ? 'var(--success)' : 'var(--danger)' }}>
                          <Smartphone size={20} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{session.session_id}</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{session.phone_number ? `+${session.phone_number}` : 'Not Linked'}</div>
                          {(session.proxy_name || session.proxy_url) && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)', marginTop: '4px', fontWeight: 500, wordBreak: 'break-all' }} title={session.proxy_url ? session.proxy_url.replace(/:[^:@]+@/, ':***@') : ''}>
                              Proxy: {session.proxy_name || session.proxy_url.replace(/:[^:@]+@/, ':***@')}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className={`badge ${session.status === 'CONNECTED' ? 'badge-success' : 'badge-danger'}`}>
                        {session.status}
                      </span>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                      {session.status !== 'CONNECTED' && session.qr_code && (
                        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setQrSessionId(session.session_id); setActiveQr(session.qr_code); }}>
                          <Link size={16} /> QR
                        </button>
                      )}
                      <button className="btn btn-outline" style={{ flex: 1, color: 'var(--primary-color)' }} onClick={() => handleReconnectSession(session.session_id)} title="Restart koneksi WhatsApp tanpa menghapus cache">
                        <RefreshCw size={16} /> Reconnect
                      </button>
                      <button className="btn btn-outline" style={{ flex: 1, color: 'var(--primary-color)' }} onClick={() => handleRepairSession(session.session_id)} title="Bersihkan cache Signal untuk negosiasi kunci ulang">
                        <Wrench size={16} /> Repair
                      </button>
                      <button className="btn btn-outline" style={{ flex: 1, color: 'var(--danger)' }} onClick={() => handleDeleteSession(session.session_id)}>
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {activeQr && (
          <div className="card" style={{ height: 'fit-content' }}>
            <h3 style={{ fontSize: '1.125rem', marginBottom: '8px', textAlign: 'center' }}>Scan QR Code</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '24px' }}>
              Open WhatsApp on your phone, go to Linked Devices, and scan this code for session <b>{qrSessionId}</b>.
            </p>
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'center' }}>
              <img src={activeQr} alt="QR Code" style={{ maxWidth: '100%', height: 'auto' }} />
            </div>
            <button className="btn btn-outline" style={{ width: '100%', marginTop: '24px' }} onClick={() => { setActiveQr(null); setQrSessionId(''); }}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {/* CONFIRMATION DIALOG MODAL */}
      {confirmDialog.show && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="modal-content" style={{
            maxWidth: '440px',
            width: '90%',
            borderRadius: '16px',
            padding: '24px',
            backgroundColor: 'var(--card-bg, #ffffff)',
            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
            border: '1px solid var(--border-color)',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div className="modal-header" style={{
              marginBottom: '16px',
              borderBottom: 'none',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>
                {confirmDialog.title}
              </h2>
            </div>
            <div className="modal-body" style={{ marginBottom: '24px', padding: 0 }}>
              <p style={{ color: 'var(--text-color-muted, #6b7280)', fontSize: '0.95rem', lineHeight: '1.5', margin: 0 }}>
                {confirmDialog.message}
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: 'none', padding: 0 }}>
              <button
                className="btn btn-outline"
                onClick={() => setConfirmDialog({ show: false, title: '', message: '', confirmLabel: '', confirmBtnClass: '', onConfirm: null })}
                style={{ padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
              >
                Batal
              </button>
              <button
                className={`btn ${confirmDialog.confirmBtnClass === 'btn-danger' ? '' : 'btn-primary'}`}
                onClick={() => {
                  if (confirmDialog.onConfirm) confirmDialog.onConfirm();
                  setConfirmDialog({ show: false, title: '', message: '', confirmLabel: '', confirmBtnClass: '', onConfirm: null });
                }}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  backgroundColor: confirmDialog.confirmBtnClass === 'btn-danger' ? '#ef4444' : 'var(--primary-color, #3b82f6)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionManager;
