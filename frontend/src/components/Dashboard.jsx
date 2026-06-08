import { useEffect, useState } from 'react';
import { Smartphone, Send, Users, FileText, Bot, Network, Phone, BarChart2 } from 'lucide-react';
import { apiRequest } from '../apiClient';

const Dashboard = () => {
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

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const json = await apiRequest('/dashboard/stats');
      if (json.status === 'success') {
        setStats(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
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

  return (
    <div>
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
                    {err.last_error_at ? new Date(err.last_error_at).toLocaleString() : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Welcome Banner */}
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
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'white', marginBottom: '8px' }}>Welcome back, Admin! 👋</h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem' }}>Here's what's happening with your WhatsApp automation today.</p>
        </div>
      </div>

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
    </div>
  );
};

export default Dashboard;
