import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  RefreshCw,
  Layers,
  CheckCircle,
  AlertCircle,
  Clock,
  Flame,
  FileText,
  Smartphone,
  Eye,
  Trash2,
  X,
  Play,
  Pause
} from 'lucide-react';
import { apiRequest } from '../apiClient';

const Warmer = ({ API_URL }) => {
  // Tabs and general lists
  const [activeTab, setActiveTab] = useState('campaigns'); // 'campaigns' or 'templates'
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Modal visibility
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

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

  // Drawer (Logs detail) visibility
  const [drawerCampaignId, setDrawerCampaignId] = useState(null);
  const [drawerProgress, setDrawerProgress] = useState(null);

  // Campaign Form State
  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [minDelay, setMinDelay] = useState(30);
  const [maxDelay, setMaxDelay] = useState(120);
  const [duration, setDuration] = useState(60);

  // Template Form State
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateMessages, setTemplateMessages] = useState('');

  // Initial load
  useEffect(() => {
    fetchCampaigns();
    fetchTemplates();
    fetchSessions();
  }, []);

  // Polling for the main campaign list
  useEffect(() => {
    let interval;
    if (autoRefresh && activeTab === 'campaigns') {
      interval = setInterval(fetchCampaigns, 5000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab]);

  // Polling for the active drawer logs
  useEffect(() => {
    let interval;
    const fetchDrawerLogs = async () => {
      if (!drawerCampaignId) return;
      try {
        const json = await apiRequest(`/warmer/campaigns/${drawerCampaignId}/logs`);
        if (json.status === 'success') {
          setDrawerProgress(json.data);
          // If the campaign finishes while open, refresh the background list
          if (json.data.status === 'COMPLETED') {
            fetchCampaigns();
          }
        }
      } catch (err) {
        console.error('Gagal mengambil log laci samping warmer:', err);
      }
    };

    if (drawerCampaignId) {
      fetchDrawerLogs();
      interval = setInterval(fetchDrawerLogs, 2000);
    } else {
      setDrawerProgress(null);
    }

    return () => clearInterval(interval);
  }, [drawerCampaignId]);

  // Fetch API helpers
  const fetchCampaigns = async () => {
    try {
      const json = await apiRequest('/warmer/campaigns');
      if (json.status === 'success') {
        setCampaigns(json.data);
      }
    } catch (err) {
      console.error('Gagal memuat kampanye warmer:', err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const json = await apiRequest('/warmer/templates');
      if (json.status === 'success') {
        setTemplates(json.data);
      }
    } catch (err) {
      console.error('Gagal memuat template warmer:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      if (json.status === 'success') {
        setSessions(json.data || []);
      }
    } catch (err) {
      console.error('Gagal memuat sesi perangkat:', err);
    }
  };

  // Device checkbox toggle
  const toggleDevice = (devId) => {
    setSelectedDevices(prev => 
      prev.includes(devId) 
        ? prev.filter(id => id !== devId) 
        : [...prev, devId]
    );
  };

  // Preset Template loader in form
  const handleTemplateSelection = (e) => {
    const tId = e.target.value;
    setSelectedTemplateId(tId);
    if (tId) {
      const selected = templates.find(t => String(t.id) === String(tId));
      if (selected) {
        setMessageContent(selected.messages);
      }
    } else {
      setMessageContent('');
    }
  };

  // Actions: CREATE TEMPLATE
  const handleCreateTemplateSubmit = async (e) => {
    e.preventDefault();
    if (!templateName || !templateMessages) {
      window.showWarning('Nama template dan daftar kalimat pesan wajib diisi.');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest('/warmer/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName,
          description: templateDescription,
          messages: templateMessages
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Template percakapan warmer berhasil disimpan.');
        setTemplateName('');
        setTemplateDescription('');
        setTemplateMessages('');
        setShowTemplateModal(false);
        fetchTemplates();
      } else {
        window.showError(json.message || 'Gagal menyimpan template.');
      }
    } catch (err) {
      window.showError('Kesalahan jaringan saat menyimpan template.');
    } finally {
      setLoading(false);
    }
  };

  // Actions: DELETE TEMPLATE
  const handleDeleteTemplate = async (id) => {
    triggerConfirm(
      'Hapus Template',
      'Apakah Anda yakin ingin menghapus template ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/warmer/templates/${id}`, { method: 'DELETE' });
          if (json.status === 'success') {
            window.showSuccess('Template berhasil dihapus.');
            fetchTemplates();
          } else {
            window.showError(json.message || 'Gagal menghapus template.');
          }
        } catch (err) {
          window.showError('Kesalahan jaringan saat menghapus template.');
        }
      }
    );
  };

  // Actions: CREATE CAMPAIGN
  const handleCreateCampaignSubmit = async (e) => {
    e.preventDefault();
    if (!campaignName || selectedDevices.length < 2 || !messageContent) {
      window.showWarning('Nama kampanye, minimal 2 perangkat, and kalimat pesan wajib diisi.');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest('/warmer/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName,
          description,
          device_ids: selectedDevices.join(','),
          template_id: selectedTemplateId || null,
          messages: messageContent,
          min_delay: parseInt(minDelay),
          max_delay: parseInt(maxDelay),
          duration: parseInt(duration)
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Kampanye warmer berhasil diluncurkan di background.');
        // Reset states
        setCampaignName('');
        setDescription('');
        setSelectedDevices([]);
        setSelectedTemplateId('');
        setMessageContent('');
        setMinDelay(30);
        setMaxDelay(120);
        setDuration(60);
        setShowCampaignModal(false);
        fetchCampaigns();
      } else {
        window.showError(json.message || 'Gagal memulai kampanye.');
      }
    } catch (err) {
      window.showError('Kesalahan jaringan saat meluncurkan kampanye.');
    } finally {
      setLoading(false);
    }
  };

  // Actions: STOP CAMPAIGN
  const handleStopCampaign = async (id) => {
    triggerConfirm(
      'Hentikan Kampanye',
      'Apakah Anda yakin ingin menghentikan kampanye warmer ini?',
      'Ya, Hentikan',
      'btn-primary',
      async () => {
        try {
          const json = await apiRequest(`/warmer/campaigns/${id}/stop`, { method: 'POST' });
          if (json.status === 'success') {
            window.showSuccess('Kampanye warmer dihentikan.');
            fetchCampaigns();
            if (drawerCampaignId === id) {
              setDrawerCampaignId(null);
            }
          } else {
            window.showError(json.message || 'Gagal menghentikan kampanye.');
          }
        } catch (err) {
          window.showError('Kesalahan jaringan saat menghentikan kampanye.');
        }
      }
    );
  };

  // Actions: DELETE CAMPAIGN
  const handleDeleteCampaign = async (id) => {
    triggerConfirm(
      'Hapus Kampanye',
      'Apakah Anda yakin ingin menghapus kampanye warmer ini beserta seluruh log pengirimannya?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/warmer/campaigns/${id}`, { method: 'DELETE' });
          if (json.status === 'success') {
            window.showSuccess('Kampanye warmer berhasil dihapus.');
            fetchCampaigns();
            if (drawerCampaignId === id) {
              setDrawerCampaignId(null);
            }
          } else {
            window.showError(json.message || 'Gagal menghapus kampanye.');
          }
        } catch (err) {
          window.showError('Kesalahan jaringan saat menghapus kampanye.');
        }
      }
    );
  };

  // Filter lists based on search
  const filteredCampaigns = campaigns.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Helper date formatting
  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Header Halaman */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Number Warmer</h1>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--primary-color)',
              padding: '2px 8px',
              borderRadius: '9999px',
              border: '1px solid rgba(99, 102, 241, 0.2)'
            }}>
              V 0.0.1
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Warm up your WhatsApp numbers with automated, interactive background conversations to avoid spam bans
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          {activeTab === 'campaigns' ? (
            <button 
              className="btn btn-primary"
              onClick={() => setShowCampaignModal(true)}
              style={{
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '0.875rem',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
                background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                border: 'none'
              }}
            >
              <Plus size={18} /> New Campaign
            </button>
          ) : (
            <button 
              className="btn btn-primary"
              onClick={() => setShowTemplateModal(true)}
              style={{
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '0.875rem',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
                background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                border: 'none'
              }}
            >
              <Plus size={18} /> Create Template
            </button>
          )}
        </div>
      </div>

      {/* Tabs Menu & Search */}
      <div className="card" style={{
        padding: '16px 24px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        background: 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('campaigns')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
              transition: 'all 0.2s',
              backgroundColor: activeTab === 'campaigns' ? 'var(--primary-color)' : 'transparent',
              color: activeTab === 'campaigns' ? 'white' : 'var(--text-muted)'
            }}
          >
            Campaigns ({campaigns.length})
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
              transition: 'all 0.2s',
              backgroundColor: activeTab === 'templates' ? 'var(--primary-color)' : 'transparent',
              color: activeTab === 'templates' ? 'white' : 'var(--text-muted)'
            }}
          >
            Templates ({templates.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeTab === 'campaigns' && (
            <button
              onClick={fetchCampaigns}
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
              <RefreshCw size={16} />
            </button>
          )}

          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
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

      {/* Main Grid Area */}
      {activeTab === 'campaigns' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredCampaigns.length === 0 ? (
            <div className="card text-center" style={{ padding: '60px 40px', borderStyle: 'dashed' }}>
              <Flame size={48} style={{ color: 'var(--text-light)', margin: '0 auto 16px' }} />
              <h3>No campaigns</h3>
              <p style={{ maxWidth: '400px', margin: '8px auto 24px' }}>
                Get started by creating a new warmer campaign.
              </p>
              <button 
                className="btn btn-primary"
                onClick={() => setShowCampaignModal(true)}
                style={{ borderRadius: '8px', padding: '10px 20px', fontWeight: 600 }}
              >
                <Plus size={18} /> New Campaign
              </button>
            </div>
          ) : (
            filteredCampaigns.map(c => {
              const devicesCount = c.device_ids.split(',').filter(Boolean).length;
              
              // Define dynamic statuses styles
              let badgeColor = 'var(--text-muted)';
              let badgeBg = '#f3f4f6';
              if (c.status === 'RUNNING') {
                badgeColor = '#4f46e5';
                badgeBg = 'rgba(99, 102, 241, 0.1)';
              } else if (c.status === 'COMPLETED') {
                badgeColor = 'var(--success)';
                badgeBg = 'var(--success-bg)';
              } else if (c.status === 'PAUSED') {
                badgeColor = 'var(--warning)';
                badgeBg = 'var(--warning-bg)';
              }

              return (
                <div key={c.id} className="card" style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '18px 24px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  background: 'white',
                  transition: 'transform 0.2s',
                  cursor: 'default'
                }}>
                  {/* Left section: Name and metadata */}
                  <div style={{ flex: 1, minWidth: '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(249, 115, 22, 0.1)',
                        color: '#f97316',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Flame size={20} />
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{c.name}</h4>
                        <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Smartphone size={12} /> {devicesCount} Devices
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} /> {c.duration} mins
                          </span>
                          <span>
                            Started: {formatDate(c.started_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Middle section: Progress stats */}
                  <div style={{ flex: 1, padding: '0 32px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span className="font-medium">Warming Messages</span>
                      <span className="font-bold">{c.sent_count} sent</span>
                    </div>
                    {/* Visual Progress Bar (running animation if RUNNING) */}
                    <div style={{
                      width: '100%',
                      height: '6px',
                      backgroundColor: '#e5e7eb',
                      borderRadius: '9999px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        width: c.status === 'COMPLETED' ? '100%' : '35%', // Simulated visual
                        height: '100%',
                        backgroundColor: c.status === 'COMPLETED' ? 'var(--success)' : 'var(--primary-color)',
                        borderRadius: '9999px',
                        transition: 'width 0.5s ease-in-out'
                      }} />
                    </div>
                  </div>

                  {/* Right section: Status & Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: badgeColor,
                      backgroundColor: badgeBg,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      textTransform: 'lowercase'
                    }}>
                      {c.status}
                    </span>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        title="Lihat Log Real-Time"
                        onClick={() => setDrawerCampaignId(c.id)}
                        className="btn-icon"
                        style={{
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          width: '36px',
                          height: '36px'
                        }}
                      >
                        <Eye size={16} />
                      </button>

                      {c.status === 'RUNNING' && (
                        <button
                          title="Hentikan Kampanye"
                          onClick={() => handleStopCampaign(c.id)}
                          className="btn-icon"
                          style={{
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            width: '36px',
                            height: '36px',
                            color: 'var(--danger)'
                          }}
                        >
                          <Pause size={16} />
                        </button>
                      )}

                      <button
                        title="Hapus Kampanye"
                        onClick={() => handleDeleteCampaign(c.id)}
                        className="btn-icon"
                        style={{
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          width: '36px',
                          height: '36px',
                          color: 'var(--text-light)'
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filteredTemplates.length === 0 ? (
            <div className="card text-center" style={{ gridColumn: '1 / -1', padding: '60px 40px', borderStyle: 'dashed' }}>
              <FileText size={48} style={{ color: 'var(--text-light)', margin: '0 auto 16px' }} />
              <h3>No templates</h3>
              <p style={{ maxWidth: '400px', margin: '8px auto 24px' }}>
                Create conversation templates to reuse across multiple warmer campaigns.
              </p>
              <button 
                className="btn btn-primary"
                onClick={() => setShowTemplateModal(true)}
                style={{ borderRadius: '8px', padding: '10px 20px', fontWeight: 600 }}
              >
                <Plus size={18} /> Create Template
              </button>
            </div>
          ) : (
            filteredTemplates.map(t => {
              const lines = t.messages.split('\n').filter(Boolean).length;
              return (
                <div key={t.id} className="card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderRadius: '12px',
                  background: 'white'
                }}>
                  <div>
                    <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: 'var(--primary-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <FileText size={16} />
                        </div>
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{t.name}</h4>
                      </div>
                      
                      <button
                        title="Hapus Template"
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="btn-icon"
                        style={{ color: 'var(--text-light)', padding: '4px', marginLeft: 'auto' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <p style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '8px',
                      minHeight: '36px',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}>
                      {t.description || 'No description provided.'}
                    </p>
                  </div>

                  <div style={{
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '12px',
                    marginTop: '16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.75rem'
                  }}>
                    <span style={{
                      fontWeight: 600,
                      color: 'var(--primary-color)',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      padding: '2px 8px',
                      borderRadius: '4px'
                    }}>
                      {lines} message lines
                    </span>
                    <span style={{ color: 'var(--text-light)' }}>
                      {formatDate(t.created_at).split(' ')[0]}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: NEW CAMPAIGN                         */}
      {/* ========================================== */}
      {showCampaignModal && (
        <div style={{
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
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '560px',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: 'white',
            borderRadius: '16px',
            padding: '28px',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowCampaignModal(false)}
              className="btn-icon"
              style={{
                position: 'absolute',
                right: '20px',
                top: '20px',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '32px',
                height: '32px'
              }}
            >
              <X size={16} />
            </button>

            <h3 style={{ marginBottom: '4px' }}>Create Campaign</h3>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Configure automated warming dialogue flows between registered devices.
            </p>

            <form onSubmit={handleCreateCampaignSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Enter campaign name (e.g. Warmer 1)"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Enter campaign description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-control"
                />
              </div>

              {/* Select Devices */}
              <div className="form-group">
                <label className="form-label">Select Devices * (minimum 2)</label>
                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '12px',
                  maxHeight: '140px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: '#f9fafb'
                }}>
                  {sessions.filter(s => s.status === 'CONNECTED').length === 0 ? (
                    <div style={{ fontSize: '0.825rem', color: 'var(--danger)', padding: '4px' }}>
                      Tidak ada sesi WhatsApp aktif terhubung. Silakan hubungkan sesi di menu Devices dahulu.
                    </div>
                  ) : (
                    sessions.filter(s => s.status === 'CONNECTED').map(s => (
                      <label key={s.session_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.875rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedDevices.includes(s.session_id)}
                          onChange={() => toggleDevice(s.session_id)}
                          style={{ width: '16px', height: '16px', accentColor: 'var(--primary-color)' }}
                        />
                        <span style={{ fontWeight: 500 }}>{s.session_id}</span>
                        <span style={{ color: 'var(--text-muted)' }}>({s.phone_number || 'no phone'})</span>
                      </label>
                    ))
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Selected: {selectedDevices.length} device(s)
                </div>
              </div>

              {/* Use Template Selector */}
              <div className="form-group">
                <label className="form-label">Use Template (Optional)</label>
                <select
                  value={selectedTemplateId}
                  onChange={handleTemplateSelection}
                  className="form-control"
                >
                  <option value="">No template (use custom messages below)</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Messages Content */}
              <div className="form-group">
                <label className="form-label">Messages * (one per line)</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Hello, how are you?&#10;I am good, how about you?&#10;Let's talk later."
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  className="form-control"
                  style={{ resize: 'vertical' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Enter one message per line. These messages will be sent in sequence between selected devices.
                </span>
              </div>

              {/* Delays and Duration */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Min Delay (seconds) *</label>
                  <input
                    type="number"
                    required
                    min={5}
                    value={minDelay}
                    onChange={(e) => setMinDelay(Math.max(5, parseInt(e.target.value) || 30))}
                    className="form-control"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Max Delay (seconds) *</label>
                  <input
                    type="number"
                    required
                    min={5}
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(Math.max(5, parseInt(e.target.value) || 120))}
                    className="form-control"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Campaign Duration (minutes) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 60))}
                  className="form-control"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  How long the campaign should run: {Math.round(duration / 60 * 10) / 10}h
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCampaignModal(false)}
                  className="btn btn-outline"
                  style={{ borderRadius: '8px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                    border: 'none',
                    padding: '10px 24px',
                    fontWeight: 600
                  }}
                >
                  {loading ? 'Starting...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: NEW TEMPLATE                         */}
      {/* ========================================== */}
      {showTemplateModal && (
        <div style={{
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
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '520px',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: 'white',
            borderRadius: '16px',
            padding: '28px',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowTemplateModal(false)}
              className="btn-icon"
              style={{
                position: 'absolute',
                right: '20px',
                top: '20px',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '32px',
                height: '32px'
              }}
            >
              <X size={16} />
            </button>

            <h3 style={{ marginBottom: '4px' }}>Create Template</h3>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Define conversation sentences to be sent in sequence between devices.
            </p>

            <form onSubmit={handleCreateTemplateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Template Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Enter template name (e.g. Casual Dialog 1)"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  placeholder="Optional description"
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Messages * (one per line)</label>
                <textarea
                  required
                  rows={6}
                  placeholder="Halo apa kabar?&#10;Kabar baik, bagaimana dengan kamu?&#10;Saya juga baik, terima kasih!&#10;Bagus kalau begitu, nanti kita ngobrol lagi."
                  value={templateMessages}
                  onChange={(e) => setTemplateMessages(e.target.value)}
                  className="form-control"
                  style={{ resize: 'vertical' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Enter one message per line. These messages will be sent in sequence between selected devices.
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="btn btn-outline"
                  style={{ borderRadius: '8px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                    border: 'none',
                    padding: '10px 24px',
                    fontWeight: 600
                  }}
                >
                  {loading ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* DRAWER: REAL-TIME WARMER LOGS (SLIDE-OVER) */}
      {/* ========================================== */}
      {drawerCampaignId && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '420px',
          height: '100vh',
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.1)',
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          {/* Inject SlideIn CSS Keyframe locally to ensure smooth animation */}
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes slideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}} />

          {/* Drawer Header */}
          <div style={{
            padding: '24px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                  {drawerProgress ? drawerProgress.name : 'Loading Campaign...'}
                </h3>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                ID Kampanye: #{drawerCampaignId}
              </p>
            </div>
            <button
              onClick={() => setDrawerCampaignId(null)}
              className="btn-icon"
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '32px',
                height: '32px'
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Drawer Body Progress Details */}
          {drawerProgress ? (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              
              {/* Campaign Stats Card */}
              <div style={{
                margin: '20px 24px 10px',
                padding: '16px',
                borderRadius: '12px',
                backgroundColor: 'rgba(99, 102, 241, 0.05)',
                border: '1px solid rgba(99, 102, 241, 0.1)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>Status</span>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'lowercase',
                    color: drawerProgress.status === 'RUNNING' ? 'var(--primary-color)' : drawerProgress.status === 'COMPLETED' ? 'var(--success)' : 'var(--warning)',
                    backgroundColor: drawerProgress.status === 'RUNNING' ? 'rgba(99, 102, 241, 0.1)' : drawerProgress.status === 'COMPLETED' ? 'var(--success-bg)' : 'var(--warning-bg)',
                    padding: '2px 8px',
                    borderRadius: '4px'
                  }}>
                    {drawerProgress.status}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'center', fontSize: '0.825rem', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Warming Messages Sent</span>
                  <span className="font-bold">{drawerProgress.sent_count} pesan</span>
                </div>

                <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'center', fontSize: '0.825rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Duration Limit</span>
                  <span className="font-medium">{drawerProgress.duration} menit</span>
                </div>
              </div>

              {/* Logs Section Header */}
              <div style={{
                padding: '12px 24px 4px',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '0.825rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                backgroundColor: '#f9fafb'
              }}>
                Live Warming Delivery Logs
              </div>

              {/* Logs List Container */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(!drawerProgress.logs || drawerProgress.logs.length === 0) ? (
                  <div style={{
                    fontSize: '0.825rem',
                    color: 'var(--text-light)',
                    textAlign: 'center',
                    paddingTop: '40px'
                  }}>
                    Belum ada aktivitas pesan dikirimkan.
                  </div>
                ) : (
                  drawerProgress.logs.map(log => {
                    const isSystem = log.sender_session === 'SYSTEM';
                    return (
                      <div key={log.id} style={{
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: isSystem ? 'rgba(239, 68, 68, 0.05)' : 'white',
                        border: `1px solid ${log.status === 'FAILED' ? 'var(--danger-bg)' : 'var(--border-color)'}`,
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--primary-color)' }}>
                            {isSystem ? 'SYSTEM MESSAGE' : `${log.sender_session} ➔ ${log.receiver_session}`}
                          </span>
                          <span style={{ fontSize: '0.675rem', color: 'var(--text-light)' }}>
                            {formatDate(log.created_at).split(' ')[1]} {/* Just show HH:MM:SS */}
                          </span>
                        </div>

                        <p style={{
                          fontSize: '0.825rem',
                          color: isSystem ? 'var(--text-muted)' : 'var(--text-main)',
                          margin: 0,
                          lineHeight: '1.4',
                          fontWeight: isSystem ? 500 : 400
                        }}>
                          {log.message}
                        </p>

                        {log.status === 'FAILED' && log.error_message && (
                          <div style={{
                            marginTop: '6px',
                            padding: '4px 8px',
                            backgroundColor: 'var(--danger-bg)',
                            color: 'var(--danger)',
                            borderRadius: '4px',
                            fontSize: '0.675rem',
                            fontWeight: 500,
                            wordBreak: 'break-word'
                          }}>
                            Error: {log.error_message}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.875rem'
            }}>
              Loading campaign logs...
            </div>
          )}

          {/* Drawer Footer */}
          <div style={{
            padding: '18px 24px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: '#f9fafb',
            display: 'flex',
            justifyContent: 'flex-end'
          }}>
            <button
              onClick={() => setDrawerCampaignId(null)}
              className="btn btn-outline"
              style={{ borderRadius: '8px', padding: '8px 18px' }}
            >
              Tutup
            </button>
          </div>
        </div>
      )}

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

export default Warmer;
