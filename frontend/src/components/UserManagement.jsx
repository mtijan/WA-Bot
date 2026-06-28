import { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  RefreshCw, 
  User, 
  Key, 
  Edit, 
  Trash2, 
  X, 
  Check, 
  AlertTriangle,
  ShieldAlert,
  UserCheck,
  UserX
} from 'lucide-react';
import { apiRequest } from '../apiClient';

const UserManagement = ({ authState }) => {
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals visibility
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Active user data for modals
  const [selectedUser, setSelectedUser] = useState(null);

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('user');
  const [isActive, setIsActive] = useState(1);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [planId, setPlanId] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState('');
  const [newPassword, setNewPassword] = useState('');

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
    fetchUsers();
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const json = await apiRequest('/plans');
      setPlans(json.data || []);
    } catch (err) {
      console.error('Gagal memuat paket langganan:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const json = await apiRequest('/users');
      if (json.status === 'success') {
        setUsers(json.data || []);
      }
    } catch (err) {
      console.error('Gagal memuat user:', err);
      window.showError('Gagal memuat daftar pengguna.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanChange = (selectedPlanId) => {
    setPlanId(selectedPlanId);
    if (selectedPlanId) {
      const selectedPlan = plans.find(p => String(p.id) === String(selectedPlanId));
      if (selectedPlan) {
        setDeviceLimit(selectedPlan.max_sessions);
      }
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      window.showWarning('Username dan Password wajib diisi.');
      return;
    }
    if (password.length < 12) {
      window.showWarning('Password minimal 12 karakter.');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          password,
          display_name: displayName.trim() || null,
          role,
          device_limit: Number(deviceLimit),
          plan_id: planId || null,
          subscription_status: subscriptionStatus,
          subscription_expires_at: subscriptionExpiresAt || null
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Pengguna berhasil dibuat.');
        // Reset states
        setUsername('');
        setPassword('');
        setDisplayName('');
        setRole('user');
        setDeviceLimit(1);
        setPlanId('');
        setSubscriptionStatus('active');
        setSubscriptionExpiresAt('');
        setShowCreateModal(false);
        fetchUsers();
      } else {
        window.showError(json.message || 'Gagal membuat pengguna.');
      }
    } catch (err) {
      window.showError(err.message || 'Kesalahan jaringan saat membuat pengguna.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setLoading(true);
      const json = await apiRequest(`/users/${selectedUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          role,
          is_active: isActive,
          device_limit: Number(deviceLimit),
          plan_id: planId || null,
          subscription_status: subscriptionStatus,
          subscription_expires_at: subscriptionExpiresAt || null
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Profil pengguna berhasil diperbarui.');
        setShowEditModal(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        window.showError(json.message || 'Gagal memperbarui pengguna.');
      }
    } catch (err) {
      window.showError(err.message || 'Kesalahan jaringan saat memperbarui pengguna.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (!newPassword || newPassword.length < 12) {
      window.showWarning('Password baru minimal 12 karakter.');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest(`/users/${selectedUser.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({
          new_password: newPassword
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Password pengguna berhasil diubah.');
        setShowPasswordModal(false);
        setNewPassword('');
        setSelectedUser(null);
      } else {
        window.showError(json.message || 'Gagal mengubah password.');
      }
    } catch (err) {
      window.showError(err.message || 'Kesalahan jaringan saat mengubah password.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (user) => {
    triggerConfirm(
      'Hapus/Nonaktifkan Pengguna',
      `Apakah Anda yakin ingin menonaktifkan pengguna "${user.username}"? Akun ini tidak akan bisa login kembali.`,
      'Ya, Nonaktifkan',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/users/${user.id}`, { method: 'DELETE' });
          if (json.status === 'success') {
            window.showSuccess('Pengguna berhasil dinonaktifkan.');
            fetchUsers();
          } else {
            window.showError(json.message || 'Gagal menonaktifkan pengguna.');
          }
        } catch (err) {
          window.showError(err.message || 'Kesalahan jaringan saat menghapus pengguna.');
        }
      }
    );
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setDisplayName(user.display_name || '');
    setRole(user.role);
    setIsActive(user.is_active);
    setDeviceLimit(Number(user.device_limit ?? 1));
    setPlanId(user.plan_id || '');
    setSubscriptionStatus(user.subscription_status || 'active');
    setSubscriptionExpiresAt(user.subscription_expires_at ? new Date(user.subscription_expires_at).toISOString().split('T')[0] : '');
    setShowEditModal(true);
  };

  const openPasswordModal = (user) => {
    setSelectedUser(user);
    setNewPassword('');
    setShowPasswordModal(true);
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.display_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div style={{ position: 'relative', width: '100%', fontFamily: '"Outfit", "Inter", sans-serif' }}>
      {/* Header Halaman */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>User Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Kelola pengguna dashboard, role, dan kredensial login mereka
          </p>
        </div>

        <button 
          className="btn btn-primary"
          onClick={() => {
            setUsername('');
            setPassword('');
            setDisplayName('');
            setRole('user');
            setDeviceLimit(1);
            setPlanId('');
            setSubscriptionStatus('active');
            setSubscriptionExpiresAt('');
            setShowCreateModal(true);
          }}
          style={{
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
            background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Plus size={18} /> Tambah User
        </button>
      </div>

      {/* Control Area: Search & Refresh */}
      <div className="card" style={{
        padding: '16px 24px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          Total User: {users.length}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchUsers}
            className="btn-icon"
            style={{
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'white'
            }}
          >
            <RefreshCw size={16} className={loading ? 'spin-animation' : ''} />
          </button>

          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Cari user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{
                paddingLeft: '36px',
                width: '260px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                height: '38px'
              }}
            />
          </div>
        </div>
      </div>

      {/* Users List Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(325px, 1fr))',
        gap: '20px'
      }}>
        {filteredUsers.length === 0 ? (
          <div className="card text-center" style={{ gridColumn: '1 / -1', padding: '60px 40px', borderStyle: 'dashed' }}>
            <User size={48} style={{ color: 'var(--text-light)', margin: '0 auto 16px' }} />
            <h3>Tidak ada pengguna ditemukan</h3>
            <p style={{ maxWidth: '400px', margin: '8px auto 24px' }}>
              Tambahkan pengguna baru dengan mengklik tombol "Tambah User" di atas.
            </p>
          </div>
        ) : (
          filteredUsers.map(u => (
            <div key={u.id} className="card" style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRadius: '12px',
              background: 'white',
              position: 'relative',
              opacity: u.is_active ? 1 : 0.65,
              border: u.role === 'admin' ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid var(--border-color)'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: u.role === 'admin' 
                        ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' 
                        : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '1.1rem'
                    }}>
                      {(u.display_name || u.username).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {u.display_name || 'Tanpa Nama'}
                      </h4>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>@{u.username}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(u.id !== 1 || authState?.userId === 1) && (
                      <button
                        title="Ubah Password"
                        onClick={() => openPasswordModal(u)}
                        className="btn-icon"
                        style={{ padding: '6px', color: 'var(--text-muted)' }}
                      >
                        <Key size={15} />
                      </button>
                    )}
                    {(u.id !== 1 || authState?.userId === 1) && (
                      <button
                        title="Edit User"
                        onClick={() => openEditModal(u)}
                        className="btn-icon"
                        style={{ padding: '6px', color: 'var(--primary-color)' }}
                      >
                        <Edit size={15} />
                      </button>
                    )}
                    {u.is_active === 1 && u.id !== 1 && (
                      <button
                        title="Nonaktifkan User"
                        onClick={() => handleDeleteUser(u)}
                        className="btn-icon"
                        style={{ padding: '6px', color: 'var(--danger)' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: u.role === 'admin' ? '#7c3aed' : '#2563eb',
                    backgroundColor: u.role === 'admin' ? '#f5f3ff' : '#eff6ff',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {u.role === 'admin' ? <ShieldAlert size={10} /> : <User size={10} />}
                    {u.role}
                  </span>

                  {u.plan_name && (
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: u.subscription_status === 'active' ? '#1d4ed8' : '#b91c1c',
                      backgroundColor: u.subscription_status === 'active' ? '#dbeafe' : '#fee2e2',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      textTransform: 'uppercase'
                    }}>
                      Paket: {u.plan_name}
                    </span>
                  )}

                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: u.is_active ? '#16a34a' : '#dc2626',
                    backgroundColor: u.is_active ? '#f0fdf4' : '#fef2f2',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {u.is_active ? <UserCheck size={10} /> : <UserX size={10} />}
                    {u.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>

                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: '#0f766e',
                    backgroundColor: '#f0fdfa',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    textTransform: 'uppercase'
                  }}>
                    Devices: {u.device_limit ?? 1}
                  </span>
                </div>
              </div>

              <div style={{
                borderTop: '1px solid var(--border-color)',
                paddingTop: '12px',
                marginTop: '16px',
                fontSize: '0.75rem',
                color: 'var(--text-light)',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span>Terdaftar: {formatDate(u.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL: CREATE USER */}
      {showCreateModal && (
        <div style={modalOverlayStyle}>
          <div className="card" style={modalContentStyle}>
            <button onClick={() => setShowCreateModal(false)} className="btn-icon" style={modalCloseBtnStyle}>
              <X size={16} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={modalHeaderIconStyle}>
                <Plus size={20} />
              </div>
              <h3 style={{ margin: 0 }}>Tambah User Baru</h3>
            </div>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
                <div className="form-group">
                <label className="form-label">Username *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. joko_susilo (hanya huruf, angka, titik, strip, garis bawah)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password *</label>
                <input
                  type="password"
                  required
                  placeholder="Minimal 12 karakter"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Nama Tampilan (Opsional)</label>
                <input
                  type="text"
                  placeholder="e.g. Joko Susilo"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role Akses</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="form-control"
                >
                  <option value="user">User (Akses Standar SaaS)</option>
                  <option value="admin">Admin (Akses Penuh + User Management)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Limit Devices WhatsApp</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={deviceLimit}
                  onChange={(e) => setDeviceLimit(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Paket Langganan</label>
                <select
                  value={planId}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="form-control"
                >
                  <option value="">Pilih Paket...</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Status Langganan</label>
                <select
                  value={subscriptionStatus}
                  onChange={(e) => setSubscriptionStatus(e.target.value)}
                  className="form-control"
                >
                  <option value="active">Aktif</option>
                  <option value="expired">Kedaluwarsa (Expired)</option>
                  <option value="suspended">Ditangguhkan (Suspended)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Tanggal Kedaluwarsa Paket</label>
                <input
                  type="date"
                  value={subscriptionExpiresAt}
                  onChange={(e) => setSubscriptionExpiresAt(e.target.value)}
                  className="form-control"
                />
              </div>

              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)} style={{ flex: 1 }}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER */}
      {showEditModal && selectedUser && (
        <div style={modalOverlayStyle}>
          <div className="card" style={modalContentStyle}>
            <button onClick={() => setShowEditModal(false)} className="btn-icon" style={modalCloseBtnStyle}>
              <X size={16} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={modalHeaderIconStyle}>
                <Edit size={20} />
              </div>
              <h3 style={{ margin: 0 }}>Ubah Profil User</h3>
            </div>

            <form onSubmit={handleEditUser} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
                <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  disabled
                  value={selectedUser.username}
                  className="form-control"
                  style={{ backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Nama Tampilan</label>
                <input
                  type="text"
                  placeholder="e.g. Joko Susilo"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role Akses</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                >
                  <option value="user">User (Akses Standar SaaS)</option>
                  <option value="admin">Admin (Akses Penuh + User Management)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Status Akun</label>
                <select
                  value={isActive}
                  onChange={(e) => setIsActive(Number(e.target.value))}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                >
                  <option value={1}>Aktif (Bisa Login)</option>
                  <option value={0}>Nonaktif / Blokir (Tidak Bisa Login)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Limit Devices WhatsApp</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={deviceLimit}
                  onChange={(e) => setDeviceLimit(e.target.value)}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Paket Langganan</label>
                <select
                  value={planId}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                >
                  <option value="">Pilih Paket...</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Status Langganan</label>
                <select
                  value={subscriptionStatus}
                  onChange={(e) => setSubscriptionStatus(e.target.value)}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                >
                  <option value="active">Aktif</option>
                  <option value="expired">Kedaluwarsa (Expired)</option>
                  <option value="suspended">Ditangguhkan (Suspended)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Tanggal Kedaluwarsa Paket</label>
                <input
                  type="date"
                  value={subscriptionExpiresAt}
                  onChange={(e) => setSubscriptionExpiresAt(e.target.value)}
                  className="form-control"
                  disabled={selectedUser?.id === 1}
                  style={selectedUser?.id === 1 ? { backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : {}}
                />
              </div>

              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)} style={{ flex: 1 }}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Menyimpan...' : 'Perbarui'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD */}
      {showPasswordModal && selectedUser && (
        <div style={modalOverlayStyle}>
          <div className="card" style={modalContentStyle}>
            <button onClick={() => setShowPasswordModal(false)} className="btn-icon" style={modalCloseBtnStyle}>
              <X size={16} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={modalHeaderIconStyle}>
                <Key size={20} />
              </div>
              <h3 style={{ margin: 0 }}>Reset Password User</h3>
            </div>

            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Ubah password untuk user <strong>@{selectedUser.username}</strong>. Tindakan ini tidak membutuhkan verifikasi password lama pengguna tersebut.
            </p>

            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Password Baru *</label>
                <input
                  type="password"
                  required
                  placeholder="Minimal 12 karakter"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-control"
                />
              </div>

              <div style={{ display: 'flex', justifySelf: 'flex-end', gap: '12px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)} style={{ flex: 1 }}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Menyimpan...' : 'Ubah Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* CONFIRM DIALOG POPUP                       */}
      {/* ========================================== */}
      {confirmDialog.show && (
        <div style={modalOverlayStyle}>
          <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '24px', position: 'relative', background: '#fff', borderRadius: '12px' }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyCenter: 'center', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                <AlertTriangle size={20} style={{ alignSelf: 'center' }} />
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 700 }}>{confirmDialog.title}</h4>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}
                style={{ padding: '8px 16px', fontSize: '0.825rem' }}
              >
                Batal
              </button>
              <button 
                className={`btn ${confirmDialog.confirmBtnClass}`}
                onClick={() => {
                  setConfirmDialog(prev => ({ ...prev, show: false }));
                  confirmDialog.onConfirm?.();
                }}
                style={{ padding: '8px 16px', fontSize: '0.825rem' }}
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

const modalOverlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000
};

const modalContentStyle = {
  width: '100%',
  maxWidth: '460px',
  maxHeight: '90vh',
  background: 'white',
  borderRadius: '16px',
  padding: '28px',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column'
};

const modalCloseBtnStyle = {
  position: 'absolute',
  right: '20px',
  top: '20px',
  border: '1px solid var(--border-color)',
  borderRadius: '50%',
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  background: 'none'
};

const modalHeaderIconStyle = {
  width: '36px', 
  height: '36px', 
  borderRadius: '8px', 
  backgroundColor: 'rgba(99, 102, 241, 0.1)', 
  color: 'var(--primary-color)',
  display: 'flex', 
  alignItems: 'center', 
  justifyContent: 'center'
};

export default UserManagement;
