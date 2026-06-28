import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Shield, X, Smartphone, Send, Layers, RefreshCw } from 'lucide-react';
import { apiRequest } from '../apiClient';


const PlansManagement = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    max_sessions: 1,
    max_campaigns_per_month: 1,
    max_flows: 1,
    is_default: 0
  });

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const json = await apiRequest('/plans');
      setPlans(json.data || []);
    } catch (err) {
      window.showError(err.message || 'Gagal memuat paket langganan.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (checked ? 1 : 0) : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const payload = {
      ...formData,
      max_sessions: Number(formData.max_sessions),
      max_campaigns_per_month: Number(formData.max_campaigns_per_month),
      max_flows: Number(formData.max_flows)
    };

    try {
      if (editingPlan) {
        await apiRequest(`/plans/${editingPlan.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest('/plans', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      
      setShowModal(false);
      setEditingPlan(null);
      window.showSuccess(editingPlan ? 'Paket langganan berhasil diperbarui.' : 'Paket langganan berhasil ditambahkan.');
      await fetchPlans();
    } catch (err) {
      window.showError(err.message || 'Gagal menyimpan paket langganan.');
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus paket langganan ini?')) return;
    
    setLoading(true);
    try {
      await apiRequest(`/plans/${id}`, { method: 'DELETE' });
      window.showSuccess('Paket langganan berhasil dihapus.');
      await fetchPlans();
    } catch (err) {
      window.showError(err.message || 'Gagal menghapus paket. Pastikan tidak ada user yang menggunakan paket ini.');
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingPlan(null);
    setFormData({
      name: '',
      max_sessions: 1,
      max_campaigns_per_month: 1,
      max_flows: 1,
      is_default: 0
    });
    setShowModal(true);
  };

  const openEditModal = (plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      max_sessions: plan.max_sessions,
      max_campaigns_per_month: plan.max_campaigns_per_month,
      max_flows: plan.max_flows,
      is_default: plan.is_default
    });
    setShowModal(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
            Subscription Plans
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Kelola paket langganan dan batas kuota pengguna SaaS.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Plus size={18} /> Tambah Paket
        </button>
      </div>

      {loading && !plans.length ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <div className="spin-animation" style={{ color: 'var(--primary-color)' }}>
            <RefreshCw size={24} />
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '24px'
        }}>
          {plans.length === 0 ? (
            <div className="card text-center" style={{ gridColumn: '1 / -1', padding: '60px 40px', borderStyle: 'dashed' }}>
              <Shield size={48} style={{ color: 'var(--text-light)', margin: '0 auto 16px' }} />
              <h3>Belum ada paket langganan</h3>
              <p style={{ maxWidth: '400px', margin: '8px auto 24px' }}>
                Tambahkan paket baru untuk menetapkan kuota bagi para pengguna.
              </p>
            </div>
          ) : (
            plans.map(plan => (
              <div key={plan.id} className="card" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                borderRadius: '12px',
                background: 'white',
                border: plan.is_default === 1 ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                position: 'relative',
                boxShadow: plan.is_default === 1 ? 'var(--shadow-md)' : 'var(--shadow-sm)'
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: plan.is_default === 1 
                          ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' 
                          : 'rgba(99, 102, 241, 0.1)',
                        color: plan.is_default === 1 ? 'white' : 'var(--primary-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Shield size={20} />
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {plan.name}
                        </h4>
                      </div>
                    </div>
                    {plan.is_default === 1 && (
                      <span className="badge badge-primary" style={{ fontWeight: 700 }}>
                        Default
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0 20px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                      <Smartphone size={16} style={{ color: 'var(--text-muted)' }} />
                      <span>Batas Devices: <strong style={{ fontWeight: 600 }}>{plan.max_sessions}</strong></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                      <Send size={16} style={{ color: 'var(--text-muted)' }} />
                      <span>Batas Bulk Messages / Bulan: <strong style={{ fontWeight: 600 }}>{plan.max_campaigns_per_month}</strong></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                      <Layers size={16} style={{ color: 'var(--text-muted)' }} />
                      <span>Batas Chatbot Flows: <strong style={{ fontWeight: 600 }}>{plan.max_flows}</strong></span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px', marginTop: 'auto' }}>
                  <button
                    onClick={() => openEditModal(plan)}
                    className="btn btn-outline"
                    style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Edit2 size={14} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(plan.id)}
                    className="btn btn-danger"
                    style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Trash2 size={14} /> Hapus
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2>{editingPlan ? 'Edit Paket Langganan' : 'Tambah Paket Baru'}</h2>
              <button className="btn-icon" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Nama Paket</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="form-control"
                    placeholder="Starter, Pro, Enterprise..."
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Batas Devices</label>
                  <input
                    type="number"
                    name="max_sessions"
                    min="1"
                    value={formData.max_sessions}
                    onChange={handleInputChange}
                    required
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Batas Bulk Messages / Bulan</label>
                  <input
                    type="number"
                    name="max_campaigns_per_month"
                    min="1"
                    value={formData.max_campaigns_per_month}
                    onChange={handleInputChange}
                    required
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Batas Chatbot Flows</label>
                  <input
                    type="number"
                    name="max_flows"
                    min="1"
                    value={formData.max_flows}
                    onChange={handleInputChange}
                    required
                    className="form-control"
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    id="is_default"
                    name="is_default"
                    checked={formData.is_default === 1}
                    onChange={handleInputChange}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="is_default" style={{ fontSize: '0.875rem', cursor: 'pointer', color: 'var(--text-main)' }}>
                    Jadikan Paket Default untuk Pendaftaran Baru
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-outline"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                >
                  {loading ? 'Menyimpan...' : 'Simpan Paket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlansManagement;
