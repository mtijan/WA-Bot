import { useEffect, useState } from 'react';
import { Smartphone, Send, Users, FileText, Bot, Network, Phone, BarChart2, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../apiClient';

const formatDateTime = (dateStr) => {
  if (!dateStr) return '';
  const normalized = dateStr.includes('T') || dateStr.endsWith('Z') 
    ? dateStr 
    : dateStr.replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? dateStr : parsed.toLocaleString();
};

const Dashboard = ({ authState }) => {
  const getRemainingDays = (expiresAt) => {
    if (!expiresAt) return null;
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const [stats, setStats] = useState({
    activeSessions: 0,
    totalSessions: 0,
    messagesSent: 0,
    totalContacts: 0,
    totalTemplates: 0,
    activeCampaigns: 0,
    chatbotInteractions: 0,
    totalNodes: 0,
    successRate: 100,
    chatbotAiErrors: []
  });

  const [repairLogs, setRepairLogs] = useState([]);
  const [failedReplies, setFailedReplies] = useState([]);
  const [monitoringUser, setMonitoringUser] = useState(null);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (authState?.role === 'admin') {
      fetchUsers();
    }
  }, [authState]);

  const fetchUsers = async () => {
    try {
      const json = await apiRequest('/users');
      if (json.status === 'success') {
        setUsers(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch users list:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchRepairLogs();
    fetchFailedReplies();
    const interval = setInterval(() => {
      fetchStats();
      fetchRepairLogs();
      fetchFailedReplies();
    }, 10000);
    return () => clearInterval(interval);
  }, [monitoringUser]);

  const fetchStats = async () => {
    try {
      const url = monitoringUser 
        ? `/dashboard/stats?target_user_id=${monitoringUser.id}`
        : '/dashboard/stats';
      const json = await apiRequest(url);
      if (json.status === 'success') {
        setStats(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchRepairLogs = async () => {
    try {
      const url = monitoringUser 
        ? `/monitoring/repair-logs?target_user_id=${monitoringUser.id}`
        : '/monitoring/repair-logs';
      const json = await apiRequest(url);
      if (json.status === 'success') {
        setRepairLogs(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch repair logs:', err);
    }
  };

  const fetchFailedReplies = async () => {
    try {
      const url = monitoringUser 
        ? `/monitoring/failed-replies?target_user_id=${monitoringUser.id}`
        : '/monitoring/failed-replies';
      const json = await apiRequest(url);
      if (json.status === 'success') {
        setFailedReplies(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch failed replies:', err);
    }
  };

  const markReplyAsResolved = async (id) => {
    try {
      const json = await apiRequest(`/monitoring/failed-replies/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED' })
      });
      if (json.status === 'success') {
        setFailedReplies(prev => prev.map(item => item.id === id ? { ...item, status: 'RESOLVED' } : item));
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const StatCard = ({ title, value, icon, color, extra }) => (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ 
          width: '48px', height: '48px', borderRadius: '12px', 
          backgroundColor: `${color}15`, color: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0
        }}>
          {icon}
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>{title}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: '1.2' }}>{value}</div>
        </div>
      </div>
      {extra && <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', marginTop: '4px' }}>{extra}</div>}
    </div>
  );

  const flowFailedReplies = failedReplies.filter(
    reply => reply.triggered_keyword && reply.triggered_keyword.startsWith('Flow: ')
  );

  const aiFailedReplies = failedReplies.filter(
    reply => reply.triggered_keyword === 'Chatbot AI' || !reply.triggered_keyword || !reply.triggered_keyword.startsWith('Flow: ')
  );

  const renderFailedRepliesList = (list, emptyMessage) => {
    if (list.length === 0) {
      return (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          {emptyMessage}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {list.map((reply) => (
          <div key={reply.id} style={{
            padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px',
            display: 'flex', flexDirection: 'column', gap: '6px',
            backgroundColor: reply.status === 'RESOLVED' ? 'rgba(16, 185, 129, 0.02)' : 'rgba(239, 68, 68, 0.02)',
            borderLeft: reply.status === 'RESOLVED' ? '4px solid #10b981' : '4px solid #ef4444'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>No. HP: {reply.phone_number}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {formatDateTime(reply.created_at)}
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Pesan:</span> "{reply.message_content || '(kosong)'}"
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Pemicu:</span> <span style={{ fontWeight: 500 }}>{reply.triggered_keyword}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#991b1b', backgroundColor: '#fee2e2', padding: '6px 10px', borderRadius: '6px', wordBreak: 'break-all' }}>
              <span style={{ fontWeight: 600 }}>Error:</span> {reply.error_message}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sesi: {reply.session_id}</span>
              {reply.status === 'UNRESOLVED' ? (
                <button
                  onClick={() => markReplyAsResolved(reply.id)}
                  style={{
                    padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', border: 'none',
                    backgroundColor: '#10b981', color: 'white', cursor: 'pointer', fontWeight: 600
                  }}
                >
                  Tandai Selesai
                </button>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>Telah Ditandai</span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      {/* Expiration warning banner */}
      {(() => {
        const remainingDays = getRemainingDays(authState?.subscriptionExpiresAt);
        if (remainingDays !== null && remainingDays <= 3) {
          const isExpired = remainingDays <= 0;
          return (
            <div style={{
              backgroundColor: isExpired ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
              borderLeft: isExpired ? '4px solid #ef4444' : '4px solid #f59e0b',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: isExpired ? '#b91c1c' : '#d97706'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} />
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {isExpired 
                    ? 'Masa aktif akun Anda telah kedaluwarsa. Silakan hubungi Administrator untuk memperpanjang paket Anda.'
                    : `Masa aktif akun Anda tinggal ${remainingDays} hari lagi. Silakan hubungi Administrator untuk memperpanjang paket Anda.`
                  }
                </span>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Chatbot AI Alerts */}
      {stats.chatbotAiErrors && stats.chatbotAiErrors.length > 0 && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderLeft: '4px solid #ef4444',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center' }}>
              <Bot size={20} />
            </div>
            <h4 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#b91c1c' }}>
              Chatbot AI Alerts
            </h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stats.chatbotAiErrors.map((err) => {
              const isQuota = (err.last_error || '').toLowerCase().includes('quota') || 
                              (err.last_error || '').toLowerCase().includes('balance') || 
                              (err.last_error || '').toLowerCase().includes('insufficient');
              const isAuth = (err.last_error || '').toLowerCase().includes('auth') || 
                             (err.last_error || '').toLowerCase().includes('api key') ||
                             (err.last_error || '').toLowerCase().includes('key invalid') ||
                             (err.last_error || '').toLowerCase().includes('401');
              
              let badgeText = 'API Error';
              let badgeColor = '#991b1b';
              let badgeBg = '#fee2e2';

              if (isQuota) {
                badgeText = 'Quota / Balance Empty';
                badgeColor = '#92400e';
                badgeBg = '#fef3c7';
              } else if (isAuth) {
                badgeText = 'Invalid API Key';
                badgeColor = '#1e3a8a';
                badgeBg = '#dbeafe';
              } else if ((err.last_error || '').toLowerCase().includes('fetch') || (err.last_error || '').toLowerCase().includes('network') || (err.last_error || '').toLowerCase().includes('timeout')) {
                badgeText = 'Connection Timeout';
                badgeColor = '#374151';
                badgeBg = '#e5e7eb';
              }

              return (
                <div key={err.session_id} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '10px 14px',
                  backgroundColor: 'var(--card-bg, #ffffff)',
                  border: '1px solid var(--border-color, #e5e7eb)',
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                        Device: {err.session_id}
                      </span>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 600, 
                        padding: '2px 8px', 
                        borderRadius: '20px', 
                        color: badgeColor, 
                        backgroundColor: badgeBg 
                      }}>
                        {badgeText}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', wordBreak: 'break-all' }}>
                      {err.last_error}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {formatDateTime(err.last_error_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Welcome Banner */}
      {monitoringUser ? (
        <div style={{
          background: 'linear-gradient(135deg, var(--warning), var(--primary-color))',
          borderRadius: 'var(--border-radius-lg)',
          padding: '32px',
          color: 'white',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'white', marginBottom: '8px' }}>
              Monitoring: {monitoringUser.display_name || monitoringUser.username} 👋
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem' }}>
              Menampilkan data statistik dashboard untuk user ini.
            </p>
          </div>
          <button 
            onClick={() => setMonitoringUser(null)}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.2s'
            }}
          >
            Kembali ke Dashboard Saya
          </button>
        </div>
      ) : (
        <div style={{
          background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
          borderRadius: 'var(--border-radius-lg)',
          padding: '32px',
          color: 'white',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'white', marginBottom: '8px' }}>
              Welcome back, {authState?.username || 'User'}! 👋
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem' }}>
              Here's what's happening with your WhatsApp automation today.
            </p>
          </div>
        </div>
      )}

      {/* User Dashboard Monitor Section for Admins */}
      {authState?.role === 'admin' && !monitoringUser && (
        <div className="card" style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={20} color="var(--primary-color)" />
            Pemantauan Dashboard User
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            Klik pada salah satu user di bawah ini untuk melihat data dashboard mereka secara terpisah.
          </p>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', 
            gap: '16px', 
            marginTop: '8px' 
          }}>
            {users.map(u => {
              const activeSess = u.active_sessions || 0;
              const maxSess = u.max_sessions || 0;
              const isMainAdmin = u.id === 1;

              return (
                <div 
                  key={u.id}
                  onClick={() => setMonitoringUser(u)}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary-color)';
                    e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                        {u.display_name || u.username}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        @{u.username}
                      </div>
                    </div>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      backgroundColor: isMainAdmin ? 'rgba(99, 102, 241, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                      color: isMainAdmin ? 'var(--primary-color)' : 'var(--warning)'
                    }}>
                      {u.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Device Quota:</span>
                      <span style={{ fontWeight: 600 }}>{activeSess} / {maxSess}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                      <span style={{ 
                        fontWeight: 600,
                        color: u.status === 'active' ? 'var(--success)' : 'var(--text-muted)'
                      }}>
                        {u.status === 'active' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <StatCard title="Messages Sent" value={stats.messagesSent} icon={<Send size={24} />} color="var(--primary-color)" />
        <StatCard title="Active Devices" value={`${stats.activeSessions}/${stats.totalSessions}`} icon={<Smartphone size={24} />} color="var(--success)" />
        <StatCard title="Total Contacts" value={stats.totalContacts} icon={<Users size={24} />} color="var(--warning)" />
        <StatCard title="Templates" value={stats.totalTemplates} icon={<FileText size={24} />} color="var(--info)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Secondary Stats */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart2 size={20} color="var(--primary-color)" />
            System Status
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', backgroundColor: '#fef3c7', color: '#f59e0b', borderRadius: '8px' }}><Bot size={20} /></div>
                <div style={{ fontWeight: 600 }}>Auto Reply</div>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>0 <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>responses</span></div>
            </div>
            <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', backgroundColor: '#e0e7ff', color: '#6366f1', borderRadius: '8px' }}><Network size={20} /></div>
                <div style={{ fontWeight: 600 }}>Chatbot</div>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{stats.chatbotInteractions || 0} <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>interactions</span></div>
            </div>
            <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', backgroundColor: '#fee2e2', color: '#ef4444', borderRadius: '8px' }}><Phone size={20} /></div>
                <div style={{ fontWeight: 600 }}>Call Responder</div>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>0 <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>calls handled</span></div>
            </div>
            <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', backgroundColor: '#d1fae5', color: '#10b981', borderRadius: '8px' }}><Send size={20} /></div>
                <div style={{ fontWeight: 600 }}>Bulk Campaigns</div>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{stats.activeCampaigns || 0} <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>active</span></div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '4px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Send size={16} color="var(--primary-color)" />
              Sent Messages Breakdown
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Bulk Messages</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-color)' }}>{stats.bulkSent || 0}</span>
              </div>
              <div style={{ padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Chatbot Flows</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>{stats.chatbotSent || 0}</span>
              </div>
              <div style={{ padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Single Messages</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--warning)' }}>{stats.singleSent || 0}</span>
              </div>
              <div style={{ padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Auto Reply (AI)</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--info)' }}>{stats.autoReplySent || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Overview Dummy */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '20px' }}>Performance Overview</h3>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
              <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                {/* Gray background track */}
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="#f3f4f6"
                  strokeWidth="10"
                  fill="transparent"
                />
                {/* Blue progress track */}
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="var(--primary-color)"
                  strokeWidth="10"
                  fill="transparent"
                  strokeDasharray={2 * Math.PI * 50}
                  strokeDashoffset={2 * Math.PI * 50 * (1 - (stats.successRate ?? 100) / 100)}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                />
              </svg>
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)'
              }}>
                {stats.successRate ?? 100}%
              </div>
            </div>
            <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Message Success Rate</p>
          </div>
        </div>
      </div>

      {/* Section Pemantauan (Monitoring) */}
      <div style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px' }}>
        {/* Repair Logs Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Network size={20} color="var(--primary-color)" />
            Log Perbaikan Sesi (Auto-Repair)
          </h3>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {repairLogs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Belum ada riwayat perbaikan otomatis.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px' }}>Sesi</th>
                    <th style={{ padding: '8px' }}>Status</th>
                    <th style={{ padding: '8px' }}>Pemicu</th>
                    <th style={{ padding: '8px' }}>Downtime</th>
                    <th style={{ padding: '8px' }}>Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {repairLogs.map((log) => {
                    const dt = log.downtime_seconds;
                    let displayDowntime = '-';
                    if (dt !== null && dt !== undefined) {
                      if (dt < 60) displayDowntime = `${dt} Detik`;
                      else if (dt < 3600) displayDowntime = `${Math.floor(dt / 60)} Menit`;
                      else displayDowntime = `${Math.floor(dt / 3600)} Jam ${Math.floor((dt % 3600) / 60)} Menit`;
                    }
                    
                    let displayTrigger = 'Reconnect';
                    let triggerColor = 'var(--text-muted)';
                    if (log.trigger_type === 'AUTO') {
                      displayTrigger = 'Auto';
                      triggerColor = 'var(--primary-color)';
                    } else if (log.trigger_type === 'MANUAL') {
                      displayTrigger = 'Manual';
                      triggerColor = 'var(--warning)';
                    }
                    
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{log.session_id}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                            backgroundColor: log.status === 'SUCCESS' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: log.status === 'SUCCESS' ? '#065f46' : '#991b1b'
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px', fontWeight: 500, color: triggerColor }}>{displayTrigger}</td>
                        <td style={{ padding: '8px' }}>{displayDowntime}</td>
                        <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{formatDateTime(log.triggered_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Failed Replies - Chatbot Flow Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Network size={20} color="var(--warning)" />
            Pesan Gagal Balas (Chatbot Flow)
          </h3>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {renderFailedRepliesList(flowFailedReplies, 'Tidak ada riwayat pesan gagal terbalas (Chatbot Flow).')}
          </div>
        </div>

        {/* Failed Replies - Chatbot AI Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={20} color="var(--warning)" />
            Pesan Gagal Balas (Chatbot AI)
          </h3>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {renderFailedRepliesList(aiFailedReplies, 'Tidak ada riwayat pesan gagal terbalas (Chatbot AI).')}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
