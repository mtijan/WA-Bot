import React, { useState, useEffect } from 'react';
import { Plus, Search, RefreshCw, Trash2, X, AlertTriangle, UserMinus, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../apiClient';

const OptOutManagement = () => {
  const [optOuts, setOptOuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  
  // Custom Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({
    show: false,
    phoneNumber: ''
  });

  useEffect(() => {
    fetchOptOuts();
  }, []);

  const fetchOptOuts = async () => {
    try {
      setLoading(true);
      const json = await apiRequest('/opt-outs');
      if (json.status === 'success') {
        setOptOuts(json.data || []);
      }
    } catch (err) {
      console.error('Gagal memuat suppression list:', err);
      window.showError(err.message || 'Gagal memuat suppression list.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddOptOut = async (e) => {
    e.preventDefault();
    const cleanNum = newPhoneNumber.replace(/\D/g, '');
    if (!cleanNum || cleanNum.length < 5) {
      window.showWarning('Nomor telepon tidak valid (minimal 5 digit angka).');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest('/opt-outs', {
        method: 'POST',
        body: JSON.stringify({ phone_number: cleanNum })
      });

      if (json.status === 'success') {
        window.showSuccess('Nomor berhasil ditambahkan ke suppression list.');
        setNewPhoneNumber('');
        setShowAddModal(false);
        fetchOptOuts();
      } else {
        window.showError(json.message || 'Gagal menambahkan nomor.');
        setLoading(false);
      }
    } catch (err) {
      window.showError(err.message || 'Gagal menambahkan nomor.');
      setLoading(false);
    }
  };

  const handleDeleteOptOut = async () => {
    const phone = confirmDialog.phoneNumber;
    if (!phone) return;

    try {
      setLoading(true);
      setConfirmDialog({ show: false, phoneNumber: '' });
      const json = await apiRequest(`/opt-outs/${phone}`, {
        method: 'DELETE'
      });

      if (json.status === 'success') {
        window.showSuccess('Nomor berhasil dihapus dari suppression list.');
        fetchOptOuts();
      } else {
        window.showError(json.message || 'Gagal menghapus nomor.');
        setLoading(false);
      }
    } catch (err) {
      window.showError(err.message || 'Gagal menghapus nomor.');
      setLoading(false);
    }
  };

  const triggerDeleteConfirm = (phone) => {
    setConfirmDialog({
      show: true,
      phoneNumber: phone
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const filteredList = optOuts.filter(item => 
    item.phone_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.source.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Styles definition matching the premium glassmorphic UI of S-BRO
  const modalOverlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalContentStyle = {
    width: '90%',
    maxWidth: '450px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    border: '1px solid rgba(226, 232, 240, 0.8)',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    padding: '24px',
    position: 'relative'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
            Opt-Out Management
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Kelola nomor WhatsApp yang dikecualikan (suppression list) dari pengiriman pesan massal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={fetchOptOuts} 
            className="btn btn-outline" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin-animation' : ''} /> Refresh
          </button>
          <button 
            onClick={() => setShowAddModal(true)} 
            className="btn btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Plus size={16} /> Tambah Nomor
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH */}
      <div className="card" style={{ padding: '16px 24px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
            <input
              type="text"
              placeholder="Cari nomor telepon atau sumber..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{ paddingLeft: '40px' }}
            />
          </div>
        </div>
      </div>

      {/* LIST TABLE */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && !optOuts.length ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
            <div className="spin-animation" style={{ color: 'var(--primary-color)' }}>
              <RefreshCw size={32} />
            </div>
          </div>
        ) : filteredList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#f1f5f9',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-light)'
            }}>
              <UserMinus size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                {searchQuery ? 'Tidak ada hasil pencarian' : 'Suppression list kosong'}
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px', maxWidth: '380px' }}>
                {searchQuery 
                  ? `Tidak ditemukan nomor opt-out yang cocok dengan "${searchQuery}".` 
                  : 'Belum ada nomor WhatsApp yang memblokir atau opt-out dari pengiriman pesan kampanye.'}
              </p>
            </div>
            {!searchQuery && (
              <button onClick={() => setShowAddModal(true)} className="btn btn-outline" style={{ marginTop: '8px' }}>
                Tambah Nomor Pertama
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(248, 250, 252, 0.5)' }}>
                  <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-muted)' }}>Nomor Telepon</th>
                  <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-muted)' }}>Sumber</th>
                  <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-muted)' }}>Tanggal Ditambahkan</th>
                  <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((item, index) => (
                  <tr key={`${item.phone_number}-${index}`} className="table-row-hover" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-main)' }}>
                      +{item.phone_number}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span className={`badge ${item.source === 'MANUAL' ? 'badge-primary' : 'badge-warning'}`}>
                        {item.source}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>
                      {formatDate(item.created_at)}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <button 
                        onClick={() => triggerDeleteConfirm(item.phone_number)} 
                        className="btn-icon" 
                        style={{ color: 'var(--danger)' }}
                        title="Hapus dari daftar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: ADD OPT-OUT NUMBER */}
      {showAddModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <button 
              onClick={() => { setShowAddModal(false); setNewPhoneNumber(''); }} 
              style={{ position: 'absolute', top: '16px', right: '16px', border: 'none', background: 'transparent', color: 'var(--text-light)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary-color)'
              }}>
                <Plus size={20} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Tambah Nomor</h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Kecualikan nomor dari kampanye bulk.</p>
              </div>
            </div>

            <form onSubmit={handleAddOptOut} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nomor Telepon (WhatsApp)</label>
                <input
                  type="text"
                  placeholder="Contoh: 628123456789"
                  value={newPhoneNumber}
                  onChange={(e) => setNewPhoneNumber(e.target.value)}
                  className="form-control"
                  required
                  disabled={loading}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => { setShowAddModal(false); setNewPhoneNumber(''); }} 
                  className="btn btn-outline"
                  disabled={loading}
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Menyimpan...' : 'Tambah Nomor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION DIALOG: DELETE */}
      {confirmDialog.show && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)'
              }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Hapus Nomor?</h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Konfirmasi penghapusan suppression list.</p>
              </div>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-main)', margin: '0 0 20px 0', lineHeight: 1.6 }}>
              Apakah Anda yakin ingin menghapus nomor <strong>+{confirmDialog.phoneNumber}</strong> dari daftar opt-out? Nomor ini akan dapat menerima pesan dari kampanye bulk kembali.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                type="button" 
                onClick={() => setConfirmDialog({ show: false, phoneNumber: '' })} 
                className="btn btn-outline"
                disabled={loading}
              >
                Batal
              </button>
              <button 
                type="button" 
                onClick={handleDeleteOptOut} 
                className="btn btn-danger"
                disabled={loading}
              >
                {loading ? 'Memproses...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OptOutManagement;
