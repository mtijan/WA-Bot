import { useMemo, useState, useEffect } from 'react';
import { Network, Plus, Search, Play, Pause, Edit, Trash2, Download, Upload, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { apiRequest } from '../apiClient';
import ChatbotFlowModal from './ChatbotFlowModal';

const ChatbotFlows = () => {
  const [flows, setFlows] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' });

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
    fetchFlows();
    fetchSessions();

    const interval = setInterval(() => {
      fetchFlows();
      fetchSessions();
    }, 5000); // Poll every 5 seconds for real-time updates

    return () => clearInterval(interval);
  }, []);

  const fetchFlows = async () => {
    try {
      const json = await apiRequest('/chatbot-flows');
      setFlows(json.data || []);
    } catch (err) {
      console.error('Failed to fetch flows:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      setSessions(json.data || []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  };

  const handleSaveFlow = async (flowData) => {
    try {
      const isEdit = !!flowData.id;
      const url = isEdit ? `/chatbot-flows/${flowData.id}` : '/chatbot-flows';
      const method = isEdit ? 'PUT' : 'POST';

      await apiRequest(url, {
        method,
        body: JSON.stringify(flowData),
      });

      setIsModalOpen(false);
      setEditingFlow(null);
      fetchFlows();
    } catch (err) {
      alert('Failed to save flow: ' + err.message);
    }
  };

  const handleDeleteFlow = async (id) => {
    triggerConfirm(
      'Hapus Alur Chatbot',
      'Apakah Anda yakin ingin menghapus alur chatbot ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          await apiRequest(`/chatbot-flows/${id}`, { method: 'DELETE' });
          fetchFlows();
        } catch (err) {
          alert('Failed to delete flow: ' + err.message);
        }
      }
    );
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiRequest(`/chatbot-flows/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      fetchFlows();
    } catch (err) {
      console.error('Toggle status error', err);
    }
  };

  const handleExportFlows = async () => {
    try {
      const data = await apiRequest('/chatbot-flows/export');
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'ChatBot-Flow.json');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (err) {
      alert('Gagal mengekspor flow: ' + err.message);
    }
  };

  const handleImportFlows = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const flowData = JSON.parse(event.target.result);

        const json = await apiRequest('/chatbot-flows/import', {
          method: 'POST',
          body: JSON.stringify(flowData)
        });

        alert(json.message);
        fetchFlows();
      } catch (err) {
        alert('Gagal mengimpor: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const openCreateModal = () => {
    setEditingFlow(null);
    setIsModalOpen(true);
  };

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedFlows = useMemo(() => {
    let result = [...flows];

    // 1. Filter by Search Term
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      result = result.filter(flow => 
        flow.flow_name.toLowerCase().includes(term) ||
        (flow.description || '').toLowerCase().includes(term) ||
        flow.keywords.toLowerCase().includes(term)
      );
    }

    // 2. Sort by sorting config
    if (sortConfig.key !== '') {
      result.sort((a, b) => {
        if (sortConfig.key === 'flow_name') {
          const nameA = a.flow_name.toLowerCase();
          const nameB = b.flow_name.toLowerCase();
          if (nameA < nameB) {
            return sortConfig.direction === 'asc' ? -1 : 1;
          }
          if (nameA > nameB) {
            return sortConfig.direction === 'asc' ? 1 : -1;
          }
          return 0;
        } else if (sortConfig.key === 'phone_number') {
          const getPhoneNumber = (flow) => {
            const sessionIds = JSON.parse(flow.session_ids || '[]');
            const assigned = sessions.filter(s => sessionIds.includes(s.session_id));
            return assigned.map(s => s.phone_number || '').join(',');
          };
          const phoneA = getPhoneNumber(a);
          const phoneB = getPhoneNumber(b);
          if (phoneA < phoneB) {
            return sortConfig.direction === 'asc' ? -1 : 1;
          }
          if (phoneA > phoneB) {
            return sortConfig.direction === 'asc' ? 1 : -1;
          }
          return 0;
        }
        return 0;
      });
    }

    return result;
  }, [flows, searchTerm, sortConfig, sessions]);

  const openEditModal = (flow) => {
    setEditingFlow({
      ...flow,
      session_ids: JSON.parse(flow.session_ids || '[]'),
      nodes: JSON.parse(flow.nodes || '[]')
    });
    setIsModalOpen(true);
  };

  const activeFlowsCount = flows.filter(f => f.status === 'ACTIVE').length;
  const totalNodesCount = flows.reduce((acc, f) => acc + JSON.parse(f.nodes || '[]').length, 0);
  const totalConversations = flows.reduce((acc, f) => acc + (f.sent_count || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Chatbot Flows</h2>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>V 0.0.1</span>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Build conversational trees with custom triggers and responses.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label className="btn btn-outline" style={{ cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={16} /> Import Flows
            <input 
              type="file" 
              accept=".json" 
              style={{ display: 'none' }} 
              onChange={handleImportFlows} 
            />
          </label>
          <button className="btn btn-outline" onClick={handleExportFlows} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> Export Flows
          </button>
          <button className="btn btn-primary" onClick={openCreateModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={16} /> Create Chatbot Flow
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="card">
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Flows</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{flows.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Active Flows</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>{activeFlowsCount}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Nodes</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalNodesCount}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Conversations</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalConversations}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '300px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="form-control" 
              placeholder="Search flows..." 
              style={{ paddingLeft: '36px', marginBottom: 0 }} 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        {flows.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Network size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <h3>No flows created</h3>
            <p style={{ marginTop: '8px' }}>Get started by creating your first chatbot flow.</p>
          </div>
        ) : filteredAndSortedFlows.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Search size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <h3>No flows found</h3>
            <p style={{ marginTop: '8px' }}>Try a different search keyword.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ backgroundColor: 'var(--bg-main)' }}>
              <tr>
                <th 
                  onClick={() => requestSort('flow_name')}
                  style={{ 
                    padding: '16px 24px', 
                    textAlign: 'left', 
                    fontWeight: 600, 
                    fontSize: '0.875rem', 
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Flow Name
                    {sortConfig.key === 'flow_name' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                    ) : (
                      <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                    )}
                  </div>
                </th>
                <th 
                  onClick={() => requestSort('phone_number')}
                  style={{ 
                    padding: '16px 24px', 
                    textAlign: 'left', 
                    fontWeight: 600, 
                    fontSize: '0.875rem', 
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    WhatsApp Number
                    {sortConfig.key === 'phone_number' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                    ) : (
                      <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                    )}
                  </div>
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Trigger Keywords</th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Status</th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Nodes</th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Sent</th>
                <th style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedFlows.map(flow => {
                const nodeCount = JSON.parse(flow.nodes || '[]').length;
                const keywords = flow.keywords.split(',').map(k => k.trim()).filter(k => k !== '');
                const sessionIds = JSON.parse(flow.session_ids || '[]');
                const assignedSessions = sessions.filter(s => sessionIds.includes(s.session_id));
                
                return (
                  <tr key={flow.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>{flow.flow_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{flow.description || 'No description'}</div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {assignedSessions.length === 0 ? (
                          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No session assigned</span>
                        ) : (
                          assignedSessions.map((s, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge badge-primary" style={{ fontWeight: 600, padding: '3px 8px', borderRadius: '4px' }}>
                                {s.session_id}
                              </span>
                              {s.phone_number && (
                                <span style={{ fontSize: '0.825rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                  +{s.phone_number}
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', maxWidth: '300px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {keywords.length === 0 ? (
                          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No trigger keywords</span>
                        ) : (
                          <>
                            {keywords.slice(0, 2).map((k, i) => (
                              <span 
                                key={i} 
                                className="badge" 
                                style={{ 
                                  backgroundColor: 'var(--bg-main)', 
                                  border: '1px solid var(--border-color)', 
                                  color: 'var(--text-main)',
                                  padding: '4px 10px',
                                  fontSize: '0.75rem',
                                  borderRadius: '6px',
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: '100px'
                                }}
                                title={k}
                              >
                                {k}
                              </span>
                            ))}
                            {keywords.length > 2 && (
                              <span 
                                className="badge" 
                                title={keywords.slice(2).join(', ')} 
                                style={{ 
                                  backgroundColor: 'var(--bg-main)', 
                                  border: '1px solid var(--border-color)', 
                                  color: 'var(--text-muted)',
                                  padding: '4px 10px',
                                  fontSize: '0.75rem',
                                  borderRadius: '6px',
                                  fontWeight: 500,
                                  cursor: 'help'
                                }}
                              >
                                +{keywords.length - 2} lainnya
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span className={`badge ${flow.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`} style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                        {flow.status}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span className="badge badge-primary" style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
                        {nodeCount} nodes
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span 
                        className="badge" 
                        style={{ 
                          backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                          border: '1px solid rgba(16, 185, 129, 0.2)', 
                          color: '#10b981',
                          padding: '4px 10px', 
                          borderRadius: '6px', 
                          fontSize: '0.75rem', 
                          fontWeight: 600 
                        }}
                      >
                        {flow.sent_count || 0} sent
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn-icon" onClick={() => handleToggleStatus(flow.id, flow.status)} title={flow.status === 'ACTIVE' ? 'Pause' : 'Activate'}>
                          {flow.status === 'ACTIVE' ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <button className="btn-icon" onClick={() => openEditModal(flow)} title="Edit">
                          <Edit size={18} />
                        </button>
                        <button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteFlow(flow.id)} title="Delete">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ChatbotFlowModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSave={handleSaveFlow} 
        flow={editingFlow} 
        sessions={sessions}
        flows={flows}
      />

      {/* Confirm Dialog Modal */}
      {confirmDialog.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
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

export default ChatbotFlows;
