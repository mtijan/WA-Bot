import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity,
  Server,
  Smartphone,
  Send,
  Flame,
  Database,
  Cpu,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Network,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { apiRequest } from '../apiClient';

const REFRESH_INTERVAL = 10; // seconds

// --- Helper: format bytes ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// --- Helper: format uptime ---
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m ${s}d`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

// --- Helper: status badge ---
const StatusBadge = ({ status }) => {
  let color, bg, label, Icon;
  if (status === 'healthy' || status === 'ready') {
    color = '#10b981'; bg = 'rgba(16,185,129,0.12)'; label = 'Sehat'; Icon = CheckCircle;
  } else if (status === 'degraded' || status === 'not-ready') {
    color = '#f59e0b'; bg = 'rgba(245,158,11,0.12)'; label = 'Terdegradasi'; Icon = AlertTriangle;
  } else {
    color = '#ef4444'; bg = 'rgba(239,68,68,0.12)'; label = 'Error'; Icon = XCircle;
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '4px 10px', borderRadius: '999px',
      backgroundColor: bg, color, fontWeight: 700, fontSize: '0.78rem'
    }}>
      <Icon size={13} />
      {label}
    </span>
  );
};

// --- Progress Bar ---
const ProgressBar = ({ value, max, color = 'var(--primary-color)', height = 8 }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  let barColor = color;
  if (pct > 85) barColor = '#ef4444';
  else if (pct > 65) barColor = '#f59e0b';
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        height, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.07)',
        overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 99,
          backgroundColor: barColor,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
          backgroundImage: `linear-gradient(90deg, ${barColor}cc, ${barColor})`
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {pct}%
      </div>
    </div>
  );
};

// --- Mini Bar Chart (Delivery by Hour) ---
const MiniBarChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        Tidak ada data dalam 12 jam terakhir
      </div>
    );
  }
  const maxVal = Math.max(...data.map(d => (d.sent || 0) + (d.failed || 0)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60, paddingTop: 8 }}>
      {data.map((d, i) => {
        const total = (d.sent || 0) + (d.failed || 0);
        const heightPct = total / maxVal;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, height: '100%', justifyContent: 'flex-end' }} title={`Jam ${d.hour}:00 - Terkirim: ${d.sent}, Gagal: ${d.failed}`}>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }}>
              {d.failed > 0 && <div style={{ width: '100%', height: `${(d.failed / maxVal) * 100}%`, backgroundColor: '#ef4444', borderRadius: '2px 2px 0 0', minHeight: 2 }} />}
              {d.sent > 0 && <div style={{ width: '100%', height: `${(d.sent / maxVal) * 100}%`, backgroundColor: '#10b981', borderRadius: d.failed > 0 ? 0 : '2px 2px 0 0', minHeight: 2 }} />}
            </div>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{d.hour}</span>
          </div>
        );
      })}
    </div>
  );
};

// --- Stat Row ---
const StatRow = ({ label, value, sub, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontWeight: 700, color: color || 'var(--text-main)', fontSize: '0.9rem' }}>
      {value}
      {sub && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: 4 }}>{sub}</span>}
    </span>
  </div>
);

// --- Main Component ---
const Monitoring = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const countdownRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const json = await apiRequest('/monitoring/status');
      if (json.status === 'success') {
        setData(json.data);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError('Gagal memuat data monitoring.');
      }
    } catch (err) {
      setError(err.message || 'Tidak dapat terhubung ke backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  const resetCountdown = useCallback(() => {
    setCountdown(REFRESH_INTERVAL);
  }, []);

  useEffect(() => {
    fetchStatus();

    // Auto-refresh
    const interval = setInterval(() => {
      fetchStatus();
      resetCountdown();
    }, REFRESH_INTERVAL * 1000);

    return () => clearInterval(interval);
  }, [fetchStatus, resetCountdown]);

  // Countdown tick
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  const handleManualRefresh = () => {
    setLoading(true);
    fetchStatus();
    resetCountdown();
  };

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16, color: 'var(--text-muted)' }}>
        <div style={{ width: 48, height: 48, border: '3px solid rgba(99,102,241,0.3)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: '0.95rem' }}>Memuat data monitoring...</p>
      </div>
    );
  }

  const apiHealthy = data?.api?.status === 'healthy';
  const sessionConnectedPct = data?.sessions?.total > 0
    ? Math.round((data.sessions.connected / data.sessions.total) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '28px 32px',
        marginBottom: 24,
        border: '1px solid rgba(99,102,241,0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(99,102,241,0.4)'
          }}>
            <Activity size={24} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              System Monitoring
            </h1>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: '0.875rem' }}>
              Status real-time seluruh komponen sistem
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdated && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Terakhir diperbarui</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
                {lastUpdated.toLocaleTimeString('id-ID')}
              </div>
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            backgroundColor: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.25)',
            color: 'var(--primary-color)', fontSize: '0.78rem', fontWeight: 600
          }}>
            <Clock size={13} />
            Refresh dalam {countdown}d
          </div>
          <button
            id="btn-monitoring-refresh"
            onClick={handleManualRefresh}
            style={{
              width: 38, height: 38,
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 10,
              background: 'rgba(99,102,241,0.08)',
              color: 'var(--primary-color)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            title="Refresh sekarang"
          >
            <RefreshCw size={16} style={{ animation: loading ? 'spin 0.6s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '14px 18px', borderRadius: 12,
          backgroundColor: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center'
        }}>
          <XCircle size={18} />
          <span style={{ fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* Row 1: API Health + Sessions + System */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>

        {/* API Health */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
                <Server size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>API Backend</h3>
            </div>
            <StatusBadge status={data?.api?.status || 'unknown'} />
          </div>
          <div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uptime Proses</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {data ? formatUptime(data.uptime_seconds) : '-'}
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Readiness Detail</div>
              {data?.api?.readiness?.checks && Object.entries(data.api.readiness.checks).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)', padding: '3px 0' }}>
                  <span style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ fontWeight: 700, color: v === 'ok' || v === true ? '#10b981' : '#ef4444' }}>
                    {typeof v === 'boolean' ? (v ? 'OK' : 'FAIL') : String(v)}
                  </span>
                </div>
              ))}
              {!data?.api?.readiness?.checks && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Status: <strong style={{ color: apiHealthy ? '#10b981' : '#ef4444' }}>{data?.api?.readiness?.status || '-'}</strong>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* WhatsApp Sessions */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                <Smartphone size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Sesi WhatsApp</h3>
            </div>
            <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {data?.sessions?.connected || 0}
              <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 400 }}>/{data?.sessions?.total || 0}</span>
            </span>
          </div>
          <div>
            <div style={{ marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Koneksi Aktif</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>{sessionConnectedPct}%</span>
            </div>
            <ProgressBar value={data?.sessions?.connected || 0} max={data?.sessions?.total || 1} color="#10b981" height={10} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Connected', value: data?.sessions?.connected || 0, color: '#10b981' },
              { label: 'Connecting', value: data?.sessions?.connecting || 0, color: '#f59e0b' },
              { label: 'Disconnected', value: data?.sessions?.disconnected || 0, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '8px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Memory & System */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <Cpu size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Sumber Daya Sistem</h3>
          </div>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>Heap Memory</div>
            <ProgressBar
              value={data?.memory?.heap_used_bytes || 0}
              max={data?.memory?.heap_total_bytes || 1}
              color="#8b5cf6"
              height={10}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
              <span>Digunakan: <strong style={{ color: 'var(--text-main)' }}>{formatBytes(data?.memory?.heap_used_bytes || 0)}</strong></span>
              <span>Total: <strong style={{ color: 'var(--text-main)' }}>{formatBytes(data?.memory?.heap_total_bytes || 0)}</strong></span>
            </div>
          </div>
          <div>
            <StatRow label="RSS (Total Proses)" value={formatBytes(data?.memory?.rss_bytes || 0)} />
            <StatRow label="External Binding" value={formatBytes(data?.memory?.external_bytes || 0)} />
            <StatRow label="Ukuran Database" value={`${data?.database?.size_mb || 0} MB`} />
          </div>
        </div>
      </div>

      {/* Row 2: Campaign + Warmer + Chatbot */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 20 }}>

        {/* Campaigns */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <Send size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Bulk Campaign</h3>
            {(data?.campaigns?.running || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: '0.75rem', fontWeight: 700 }}>
                {data.campaigns.running} Running
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total', value: data?.campaigns?.total || 0, color: 'var(--text-main)' },
              { label: 'Running', value: data?.campaigns?.running || 0, color: '#f59e0b' },
              { label: 'Selesai', value: data?.campaigns?.completed || 0, color: '#10b981' },
              { label: 'Gagal', value: data?.campaigns?.failed || 0, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Warmer */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
              <Flame size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Warmer Campaign</h3>
            {(data?.warmer?.running || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '0.75rem', fontWeight: 700 }}>
                {data.warmer.running} Aktif
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total', value: data?.warmer?.total || 0, color: 'var(--text-main)' },
              { label: 'Running', value: data?.warmer?.running || 0, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{ padding: '14px 12px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chatbot */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
              <Network size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Chatbot Flows</h3>
            {(data?.chatbot?.active_flows || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: '0.75rem', fontWeight: 700 }}>
                {data.chatbot.active_flows} Aktif
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total Flow', value: data?.chatbot?.total_flows || 0, color: 'var(--text-main)' },
              { label: 'Aktif', value: data?.chatbot?.active_flows || 0, color: '#6366f1' },
              { label: 'Total Trigger', value: data?.chatbot?.total_triggers || 0, color: '#f59e0b' },
              { label: 'Pesan Terkirim', value: data?.chatbot?.total_sent || 0, color: '#10b981' },
            ].map(s => (
              <div key={s.label} style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Delivery Logs 24 Jam */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 20 }}>

        {/* Summary */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
              <TrendingUp size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Pengiriman 24 Jam</h3>
          </div>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary-color)', lineHeight: 1 }}>
              {data?.delivery_today?.success_rate ?? 100}%
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Tingkat Keberhasilan</div>
          </div>
          <ProgressBar
            value={data?.delivery_today?.sent || 0}
            max={data?.delivery_today?.total || 1}
            color="#10b981"
            height={10}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            <StatRow label="Total Pengiriman" value={data?.delivery_today?.total || 0} />
            <StatRow label="Terkirim" value={data?.delivery_today?.sent || 0} color="#10b981" />
            <StatRow label="Gagal" value={data?.delivery_today?.failed || 0} color="#ef4444" />
          </div>
        </div>

        {/* Chart per Jam */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
              <Database size={18} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Aktivitas per Jam (12 jam terakhir)</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#10b981', display: 'inline-block' }} />Terkirim</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#ef4444', display: 'inline-block' }} />Gagal</span>
            </div>
          </div>
          <MiniBarChart data={data?.delivery_by_hour || []} />
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={16} color="#10b981" />
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Puncak Terkirim</div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#10b981' }}>
                  {Math.max(...(data?.delivery_by_hour?.map(d => d.sent || 0) || [0]))} pesan
                </div>
              </div>
            </div>
            <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingDown size={16} color="#ef4444" />
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Puncak Gagal</div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#ef4444' }}>
                  {Math.max(...(data?.delivery_by_hour?.map(d => d.failed || 0) || [0]))} pesan
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timestamp footer */}
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '8px 0 20px' }}>
        Data snapshot: {data?.timestamp ? new Date(data.timestamp).toLocaleString('id-ID') : '-'}
        {' '} &bull; {' '}
        Refresh otomatis setiap {REFRESH_INTERVAL} detik
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Monitoring;
