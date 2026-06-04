import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  Folder, 
  CheckCircle, 
  AlertCircle, 
  Trash2, 
  Plus, 
  Edit2,
  X,
  RefreshCw
} from 'lucide-react';

const ContactGroups = ({ API_URL }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  
  const navigate = useNavigate();

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/contacts/groups`);
      const json = await res.json();
      if (json.status === 'success') {
        setGroups(json.data || []);
      } else {
        setError(json.message || 'Gagal memuat grup kontak');
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
      setError('Koneksi server gagal');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!name) return;

    try {
      const res = await fetch(`${API_URL}/contacts/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, color })
      });
      const json = await res.json();
      if (json.status === 'success') {
        setShowCreateModal(false);
        resetForm();
        fetchGroups();
      } else {
        alert(json.message || 'Gagal membuat grup');
      }
    } catch (err) {
      console.error('Error creating group:', err);
      alert('Koneksi server gagal');
    }
  };

  const handleUpdateGroup = async (e) => {
    e.preventDefault();
    if (!name || !selectedGroup) return;

    try {
      const res = await fetch(`${API_URL}/contacts/groups/${selectedGroup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, color })
      });
      const json = await res.json();
      if (json.status === 'success') {
        setShowEditModal(false);
        resetForm();
        fetchGroups();
      } else {
        alert(json.message || 'Gagal memperbarui grup');
      }
    } catch (err) {
      console.error('Error updating group:', err);
      alert('Koneksi server gagal');
    }
  };

  const handleDeleteGroup = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Apakah Anda yakin ingin menghapus grup kontak ini beserta semua kontak di dalamnya?')) return;

    try {
      const res = await fetch(`${API_URL}/contacts/groups/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json.status === 'success') {
        fetchGroups();
      } else {
        alert(json.message || 'Gagal menghapus grup');
      }
    } catch (err) {
      console.error('Error deleting group:', err);
      alert('Koneksi server gagal');
    }
  };

  const handleCleanupOrphaned = async () => {
    if (!confirm('Apakah Anda ingin membersihkan dan menghapus data kontak yatim (tidak memiliki grup)?')) return;

    try {
      const res = await fetch(`${API_URL}/contacts/cleanup`, { method: 'POST' });
      const json = await res.json();
      alert(json.message || 'Pembersihan selesai');
      fetchGroups();
    } catch (err) {
      console.error('Error cleanup:', err);
      alert('Koneksi server gagal');
    }
  };

  const openEditModal = (group, e) => {
    e.stopPropagation();
    setSelectedGroup(group);
    setName(group.name);
    setDescription(group.description || '');
    setColor(group.color || '#3b82f6');
    setShowEditModal(true);
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setColor('#3b82f6');
    setSelectedGroup(null);
  };

  // Aggregates
  const totalContacts = groups.reduce((acc, curr) => acc + (curr.total_contacts || 0), 0);
  const totalGroups = groups.length;
  const verifiedContacts = groups.reduce((acc, curr) => acc + (curr.verified_contacts || 0), 0);
  const unverifiedContacts = groups.reduce((acc, curr) => acc + (curr.unverified_contacts || 0), 0);

  const StatCard = ({ title, value, icon, color }) => (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: '200px' }}>
      <div style={{ 
        width: '48px', height: '48px', borderRadius: '12px', 
        backgroundColor: `${color}15`, color: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center' 
      }}>
        {icon}
      </div>
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>{value}</div>
      </div>
    </div>
  );

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Contact Groups</h1>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>V 0.0.1</span>
          </div>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Create and manage groups</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={handleCleanupOrphaned}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)' }}
          >
            <Trash2 size={16} />
            <span>Cleanup Orphaned</span>
          </button>
          <button 
            onClick={() => { resetForm(); setShowCreateModal(true); }}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            <Folder size={16} />
            <span>New Group</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '24px' }}>
        <StatCard title="Total Contacts" value={totalContacts} icon={<Users size={24} />} color="var(--primary-color)" />
        <StatCard title="Contact Groups" value={totalGroups} icon={<Folder size={24} />} color="var(--info)" />
        <StatCard title="Verified" value={verifiedContacts} icon={<CheckCircle size={24} />} color="var(--success)" />
        <StatCard title="Unverified" value={unverifiedContacts} icon={<AlertCircle size={24} />} color="var(--warning)" />
      </div>

      {/* Main Groups Card */}
      <div className="card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Contact Groups</h3>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><RefreshCw className="animate-spin" /></div>
        ) : error ? (
          <div style={{ color: '#ef4444', padding: '12px', border: '1px solid #fee2e2', borderRadius: '8px', backgroundColor: '#fef2f2' }}>{error}</div>
        ) : groups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Belum ada grup kontak. Silakan buat grup baru.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Group</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Total Contacts</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Verified</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Unverified</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const createdDate = new Date(group.created_at).toLocaleDateString('en-US');
                  return (
                    <tr 
                      key={group.id} 
                      onClick={() => navigate(`/contacts/${group.id}`)}
                      style={{ 
                        borderBottom: '1px solid var(--border-color)', 
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ 
                            width: '40px', 
                            height: '40px', 
                            borderRadius: '10px', 
                            backgroundColor: `${group.color}15`,
                            color: group.color,
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center' 
                          }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: group.color }}></div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{group.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Created {createdDate}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 500, 
                          backgroundColor: '#e0e7ff', 
                          color: '#4f46e5' 
                        }}>
                          {group.total_contacts || 0} contacts
                        </span>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 500, 
                          backgroundColor: '#d1fae5', 
                          color: '#059669',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <CheckCircle size={12} /> {group.verified_contacts || 0}
                        </span>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 500, 
                          backgroundColor: '#fef3c7', 
                          color: '#d97706',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <AlertCircle size={12} /> {group.unverified_contacts || 0}
                        </span>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={(e) => openEditModal(group, e)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={(e) => handleDeleteGroup(group.id, e)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '450px', padding: '24px', position: 'relative' }}>
            <button 
              onClick={() => setShowCreateModal(false)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Create Contact Group</h3>
            
            <form onSubmit={handleCreateGroup}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Group Name *</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter group name"
                  required
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Description</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows="3"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Color</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input 
                    type="color" 
                    value={color} 
                    onChange={(e) => setColor(e.target.value)}
                    style={{ width: '48px', height: '40px', padding: '0', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent' }}
                  />
                  <input 
                    type="text" 
                    value={color} 
                    onChange={(e) => setColor(e.target.value)}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '450px', padding: '24px', position: 'relative' }}>
            <button 
              onClick={() => setShowEditModal(false)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Edit Contact Group</h3>
            
            <form onSubmit={handleUpdateGroup}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Group Name *</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter group name"
                  required
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Description</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows="3"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Color</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input 
                    type="color" 
                    value={color} 
                    onChange={(e) => setColor(e.target.value)}
                    style={{ width: '48px', height: '40px', padding: '0', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent' }}
                  />
                  <input 
                    type="text" 
                    value={color} 
                    onChange={(e) => setColor(e.target.value)}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContactGroups;
