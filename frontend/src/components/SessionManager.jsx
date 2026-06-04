import React, { useState, useEffect } from 'react';
import { Plus, Smartphone, Trash2, Link, LogOut } from 'lucide-react';

const SessionManager = ({ API_URL }) => {
  const [sessions, setSessions] = useState([]);
  const [newSessionId, setNewSessionId] = useState('');
  const [activeQr, setActiveQr] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrSessionId, setQrSessionId] = useState('');

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`);
      const json = await res.json();
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
      const res = await fetch(`${API_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: newSessionId }),
      });
      const json = await res.json();
      
      if (json.status === 'success') {
        if (json.data && json.data.qr_code) {
          setActiveQr(json.data.qr_code);
        }
        setNewSessionId('');
      } else {
        alert('Gagal membuat sesi baru: ' + json.message);
        setQrSessionId('');
      }
    } catch (err) {
      alert('Gagal menghubungi server API.');
      setQrSessionId('');
    } finally {
      setLoadingQr(false);
      fetchSessions();
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus & keluar dari sesi ${sessionId}?`)) return;

    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.status === 'success') {
        if (qrSessionId === sessionId) {
          setActiveQr(null);
          setQrSessionId('');
        }
        fetchSessions();
      } else {
        alert('Gagal menghapus sesi.');
      }
    } catch (err) {
      alert('Terjadi kesalahan koneksi.');
    }
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
    </div>
  );
};

export default SessionManager;
