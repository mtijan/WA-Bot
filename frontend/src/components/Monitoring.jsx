import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Server,
  Smartphone,
  Send,
  Flame,
  Database,
  Cpu,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Network,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { apiRequest } from '../apiClient';

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

// --- Status Badge ---
const StatusBadge = ({ status }) => {
  let color, bg, label, Icon;
  if (status === 'healthy' || status === 'ready') {
    color = '#059669'; bg = '#d1fae5'; label = 'Sehat'; Icon = CheckCircle;
  } else if (status === 'degraded' || status === 'not-ready') {
    color = '#d97706'; bg = '#fef3c7'; label = 'Terdegradasi'; Icon = AlertTriangle;
  } else {
    color = '#dc2626'; bg = '#fee2e2'; label = 'Error'; Icon = XCircle;
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 999,
      backgroundColor: bg, color, fontWeight: 700, fontSize: '0.78rem',
      border: `1px solid ${color}33`
    }}>
      <Icon size={13} />
      {label}
    </span>
  );
};

// --- Progress Bar (light theme) ---
const ProgressBar = ({ value, max, color = '#6366f1', height = 8 }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  let barColor = color;
  if (pct > 85) barColor = '#ef4444';
  else if (pct > 65) barColor = '#f59e0b';
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        height, borderRadius: 99, backgroundColor: '#f1f5f9',
        overflow: 'hidden', border: '1px solid #e2e8f0'
      }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 99,
          backgroundColor: barColor,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, fontSize: '0.75rem', color: '#64748b' }}>
        {pct}%
      </div>
    </div>
  );
};

// --- Mini Bar Chart ---
const MiniBarChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
        Tidak ada data dalam 12 jam terakhir
      </div>
    );
  }
  const maxVal = Math.max(...data.map(d => (d.sent || 0) + (d.failed || 0)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60, paddingTop: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, height: '100%', justifyContent: 'flex-end' }}
          title={`Jam ${d.hour}:00 - Terkirim: ${d.sent}, Gagal: ${d.failed}`}>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }}>
            {d.failed > 0 && <div style={{ width: '100%', height: `${(d.failed / maxVal) * 100}%`, backgroundColor: '#ef4444', borderRadius: '2px 2px 0 0', minHeight: 2 }} />}
            {d.sent > 0 && <div style={{ width: '100%', height: `${(d.sent / maxVal) * 100}%`, backgroundColor: '#10b981', borderRadius: d.failed > 0 ? 0 : '2px 2px 0 0', minHeight: 2 }} />}
          </div>
          <span style={{ fontSize: '0.6rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{d.hour}</span>
        </div>
      ))}
    </div>
  );
};

// --- Stat Row (light theme) ---
const StatRow = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{label}</span>
    <span style={{ fontWeight: 700, color: color || '#0f172a', fontSize: '0.9rem' }}>{value}</span>
  </div>
);

// --- Card wrapper (light) ---
const Card = ({ children, style }) => (
  <div style={{
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: '20px 22px',
    boxShadow: '0 1px 6px rgba(15,23,42,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    ...style
  }}>
    {children}
  </div>
);

// --- Icon Box (light) ---
const IconBox = ({ color, bg, children }) => (
  <div style={{
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: bg,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, flexShrink: 0
  }}>
    {children}
  </div>
);

// --- Mini stat tile (light) ---
const Tile = ({ label, value, color }) => (
  <div style={{
    textAlign: 'center', padding: '10px 8px', borderRadius: 10,
    backgroundColor: '#f8fafc', border: '1px solid #e2e8f0'
  }}>
    <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>{label}</div>
  </div>
);

// --- Row tile (light) ---
const RowTile = ({ label, value, color }) => (
  <div style={{
    padding: '10px 12px', borderRadius: 10,
    backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  }}>
    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{label}</span>
    <span style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{value}</span>
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================
const Monitoring = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
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

  // Hanya fetch sekali saat pertama mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const sessionConnectedPct = data?.sessions?.total > 0
    ? Math.round((data.sessions.connected / data.sessions.total) * 100)
    : 0;

  // ---- Loading state ----
  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <div style={{ width: 44, height: 44, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: '0.95rem', color: '#64748b' }}>Memuat data monitoring...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ color: '#0f172a' }}>

      {/* ---- HEADER ---- */}
      <div style={{
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        borderRadius: 20,
        padding: '24px 28px',
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 20px rgba(99,102,241,0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46,
            backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)'
          }}>
            <Activity size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'white', margin: 0, lineHeight: 1.2 }}>
              System Monitoring
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.75)', margin: '3px 0 0', fontSize: '0.85rem' }}>
              Status seluruh komponen sistem
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdated && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)' }}>Terakhir diperbarui</div>
              <div style={{ fontSize: '0.82rem', color: 'white', fontWeight: 600 }}>
                {lastUpdated.toLocaleTimeString('id-ID')}
              </div>
            </div>
          )}
          <button
            id="btn-monitoring-refresh"
            onClick={fetchStatus}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px',
              border: '2px solid rgba(255,255,255,0.35)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              fontWeight: 700, fontSize: '0.85rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              backdropFilter: 'blur(4px)',
              transition: 'all 0.2s',
              letterSpacing: '0.02em'
            }}
            title="Refresh data sekarang"
          >
            <RefreshCw size={15} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            {loading ? 'Memuat...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ---- ERROR ---- */}
      {error && (
        <div style={{
          padding: '13px 18px', borderRadius: 12,
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          color: '#dc2626', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center'
        }}>
          <XCircle size={18} />
          <span style={{ fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* ---- ROW 1: API + Sessions + Memory ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>

        {/* API Backend */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconBox color="#6366f1" bg="#ede9fe"><Server size={18} /></IconBox>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>API Backend</h3>
            </div>
            <StatusBadge status={data?.api?.status || 'unknown'} />
          </div>

          <div style={{ padding: '10px 14px', borderRadius: 12, backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Uptime Proses</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
              {data ? formatUptime(data.uptime_seconds) : '-'}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Readiness Detail</div>
            {data?.api?.readiness?.checks && Object.entries(data.api.readiness.checks).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', padding: '4px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ color: '#64748b', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                <span style={{ fontWeight: 700, color: (v === 'ok' || v === true) ? '#059669' : '#dc2626' }}>
                  {typeof v === 'boolean' ? (v ? 'OK' : 'FAIL') : String(v)}
                </span>
              </div>
            ))}
            {!data?.api?.readiness?.checks && (
              <div style={{ fontSize: '0.83rem', color: '#64748b' }}>
                Status: <strong style={{ color: data?.api?.status === 'healthy' ? '#059669' : '#dc2626' }}>
                  {data?.api?.readiness?.status || '-'}
                </strong>
              </div>
            )}
          </div>
        </Card>

        {/* WhatsApp Sessions */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconBox color="#059669" bg="#d1fae5"><Smartphone size={18} /></IconBox>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Sesi WhatsApp</h3>
            </div>
            <span style={{ fontSize: '1.7rem', fontWeight: 700, color: '#0f172a' }}>
              {data?.sessions?.connected || 0}
              <span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 400 }}>/{data?.sessions?.total || 0}</span>
            </span>
          </div>

          <div>
            <div style={{ marginBottom: 6, fontSize: '0.8rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
              <span>Koneksi Aktif</span>
              <span style={{ fontWeight: 700, color: '#059669' }}>{sessionConnectedPct}%</span>
            </div>
            <ProgressBar value={data?.sessions?.connected || 0} max={data?.sessions?.total || 1} color="#10b981" height={10} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Tile label="Connected" value={data?.sessions?.connected || 0} color="#059669" />
            <Tile label="Connecting" value={data?.sessions?.connecting || 0} color="#d97706" />
            <Tile label="Disconnected" value={data?.sessions?.disconnected || 0} color="#dc2626" />
          </div>
        </Card>

        {/* Sumber Daya */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#7c3aed" bg="#ede9fe"><Cpu size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Sumber Daya Sistem</h3>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Heap Memory</div>
            <ProgressBar value={data?.memory?.heap_used_bytes || 0} max={data?.memory?.heap_total_bytes || 1} color="#7c3aed" height={10} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginTop: 6 }}>
              <span>Digunakan: <strong style={{ color: '#0f172a' }}>{formatBytes(data?.memory?.heap_used_bytes || 0)}</strong></span>
              <span>Total: <strong style={{ color: '#0f172a' }}>{formatBytes(data?.memory?.heap_total_bytes || 0)}</strong></span>
            </div>
          </div>

          <div>
            <StatRow label="RSS (Total Proses)" value={formatBytes(data?.memory?.rss_bytes || 0)} />
            <StatRow label="External Binding" value={formatBytes(data?.memory?.external_bytes || 0)} />
            <StatRow label="Ukuran Database" value={`${data?.database?.size_mb || 0} MB`} />
          </div>
        </Card>
      </div>

      {/* ---- ROW 2: Campaign + Warmer + Chatbot ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>

        {/* Campaigns */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#d97706" bg="#fef3c7"><Send size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Bulk Campaign</h3>
            {(data?.campaigns?.running || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: '#fef3c7', color: '#d97706', fontSize: '0.73rem', fontWeight: 700, border: '1px solid #fde68a' }}>
                {data.campaigns.running} Running
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <RowTile label="Total" value={data?.campaigns?.total || 0} color="#0f172a" />
            <RowTile label="Running" value={data?.campaigns?.running || 0} color="#d97706" />
            <RowTile label="Selesai" value={data?.campaigns?.completed || 0} color="#059669" />
            <RowTile label="Gagal" value={data?.campaigns?.failed || 0} color="#dc2626" />
          </div>
        </Card>

        {/* Warmer */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#dc2626" bg="#fee2e2"><Flame size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Warmer Campaign</h3>
            {(data?.warmer?.running || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: '#fee2e2', color: '#dc2626', fontSize: '0.73rem', fontWeight: 700, border: '1px solid #fecaca' }}>
                {data.warmer.running} Aktif
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <RowTile label="Total" value={data?.warmer?.total || 0} color="#0f172a" />
            <RowTile label="Running" value={data?.warmer?.running || 0} color="#dc2626" />
          </div>
        </Card>

        {/* Chatbot */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#6366f1" bg="#ede9fe"><Network size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Chatbot Flows</h3>
            {(data?.chatbot?.active_flows || 0) > 0 && (
              <span style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, backgroundColor: '#ede9fe', color: '#6366f1', fontSize: '0.73rem', fontWeight: 700, border: '1px solid #ddd6fe' }}>
                {data.chatbot.active_flows} Aktif
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <RowTile label="Total Flow" value={data?.chatbot?.total_flows || 0} color="#0f172a" />
            <RowTile label="Aktif" value={data?.chatbot?.active_flows || 0} color="#6366f1" />
            <RowTile label="Total Trigger" value={data?.chatbot?.total_triggers || 0} color="#d97706" />
            <RowTile label="Pesan Terkirim" value={data?.chatbot?.total_sent || 0} color="#059669" />
          </div>
        </Card>
      </div>

      {/* ---- ROW 3: Delivery 24 Jam ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>

        {/* Summary */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#059669" bg="#d1fae5"><TrendingUp size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Pengiriman 24 Jam</h3>
          </div>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 700, color: '#6366f1', lineHeight: 1 }}>
              {data?.delivery_today?.success_rate ?? 100}%
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 5 }}>Tingkat Keberhasilan</div>
          </div>
          <ProgressBar value={data?.delivery_today?.sent || 0} max={data?.delivery_today?.total || 1} color="#10b981" height={10} />
          <div>
            <StatRow label="Total Pengiriman" value={data?.delivery_today?.total || 0} />
            <StatRow label="Terkirim" value={data?.delivery_today?.sent || 0} color="#059669" />
            <StatRow label="Gagal" value={data?.delivery_today?.failed || 0} color="#dc2626" />
          </div>
        </Card>

        {/* Chart per Jam */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox color="#6366f1" bg="#ede9fe"><Database size={18} /></IconBox>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Aktivitas per Jam (12 jam terakhir)</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: '0.75rem', color: '#94a3b8' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#10b981', display: 'inline-block' }} />
                Terkirim
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#ef4444', display: 'inline-block' }} />
                Gagal
              </span>
            </div>
          </div>
          <MiniBarChart data={data?.delivery_by_hour || []} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={16} color="#059669" />
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Puncak Terkirim</div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#059669' }}>
                  {Math.max(...(data?.delivery_by_hour?.map(d => d.sent || 0) || [0]))} pesan
                </div>
              </div>
            </div>
            <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingDown size={16} color="#dc2626" />
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Puncak Gagal</div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#dc2626' }}>
                  {Math.max(...(data?.delivery_by_hour?.map(d => d.failed || 0) || [0]))} pesan
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ---- FOOTER ---- */}
      <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '6px 0 24px' }}>
        Data snapshot: {data?.timestamp ? new Date(data.timestamp).toLocaleString('id-ID') : '-'}
        {' '}&bull;{' '}
        Klik tombol <strong>Refresh</strong> untuk memperbarui data
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default Monitoring;
