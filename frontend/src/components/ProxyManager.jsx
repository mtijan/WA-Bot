import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ShieldCheck, Activity, RefreshCw, AlertTriangle, Smartphone, Download, FileText, CheckCircle2, ShieldAlert } from 'lucide-react';

const ProxyManager = ({ API_URL }) => {
  const [activeTab, setActiveTab] = useState('pool'); // 'pool' | 'offline-db'
  
  const [proxies, setProxies] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [name, setName] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({}); // { id: { working, latency, error } }
  const [updatingSessionId, setUpdatingSessionId] = useState(null);
  
  // State untuk API Key IPLocate
  const [iplocateApiKey, setIplocateApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  // State untuk Offline Database
  const [offlineDbStatus, setOfflineDbStatus] = useState(null);
  const [loadingOfflineDb, setLoadingOfflineDb] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchProxies();
    fetchSessions();
    fetchApiKey();
    fetchOfflineDbStatus();
  }, []);

  useEffect(() => {
    let timer;
    if (downloading) {
      timer = setInterval(() => {
        fetchOfflineDbStatus();
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [downloading]);

  const fetchProxies = async () => {
    try {
      const res = await fetch(`${API_URL}/proxies`);
      const json = await res.json();
      if (json.status === 'success') {
        setProxies(json.data);
      }
    } catch (err) {
      console.error('Gagal mengambil daftar proxy:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`);
      const json = await res.json();
      if (json.status === 'success') {
        setSessions(json.data);
      }
    } catch (err) {
      console.error('Gagal mengambil daftar sesi:', err);
    }
  };

  const fetchApiKey = async () => {
    try {
      const res = await fetch(`${API_URL}/proxies/settings/iplocate_api_key`);
      const json = await res.json();
      if (json.status === 'success') {
        setIplocateApiKey(json.value || '');
      }
    } catch (err) {
      console.error('Gagal mengambil API Key IPLocate:', err);
    }
  };

  const fetchOfflineDbStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/proxies/offline-db/status`);
      const json = await res.json();
      if (json.status === 'success') {
        setOfflineDbStatus(json.data);
        if (json.data.state.status === 'downloading') {
          setDownloading(true);
        } else {
          setDownloading(false);
        }
      }
    } catch (err) {
      console.error('Gagal mengambil status database offline:', err);
    }
  };

  const handleSaveApiKey = async () => {
    setSavingKey(true);
    try {
      const res = await fetch(`${API_URL}/proxies/settings/iplocate_api_key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: iplocateApiKey.trim() })
      });
      const json = await res.json();
      if (json.status === 'success') {
        alert('API Key IPLocate berhasil disimpan!');
      } else {
        alert('Gagal menyimpan API Key: ' + json.message);
      }
    } catch (err) {
      alert('Terjadi kesalahan koneksi.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleCreateProxy = async (e) => {
    e.preventDefault();
    if (!name.trim() || !proxyUrl.trim()) return;

    try {
      const res = await fetch(`${API_URL}/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, proxy_url: proxyUrl.trim() }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setName('');
        setProxyUrl('');
        fetchProxies();
      } else {
        alert('Gagal menambahkan proxy: ' + json.message);
      }
    } catch (err) {
      alert('Koneksi gagal.');
    }
  };

  const handleDeleteProxy = async (id) => {
    if (!confirm('Apakah Anda yakin ingin menghapus proxy ini? Seluruh perangkat yang terhubung ke proxy ini akan beralih ke koneksi langsung.')) return;

    try {
      const res = await fetch(`${API_URL}/proxies/${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.status === 'success') {
        fetchProxies();
        fetchSessions(); // Sesi akan beralih ke NULL di DB, jadi refresh sesi juga
      } else {
        alert('Gagal menghapus proxy.');
      }
    } catch (err) {
      alert('Koneksi gagal.');
    }
  };

  const handleTestProxy = async (id) => {
    setTestingId(id);
    try {
      const res = await fetch(`${API_URL}/proxies/${id}/test`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.status === 'success') {
        setTestResults(prev => ({
          ...prev,
          [id]: {
            working: json.working,
            latency: json.latency || 0,
            error: json.error || null
          }
        }));
        fetchProxies(); // Refresh status & lokasi di database (ACTIVE/INACTIVE, country, city, dll)
      } else {
        alert('Gagal menguji proxy: ' + json.message);
      }
    } catch (err) {
      alert('Kesalahan koneksi saat menguji proxy.');
    } finally {
      setTestingId(null);
    }
  };

  const handleAssignProxy = async (sessionId, proxyId) => {
    setUpdatingSessionId(sessionId);
    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}/proxy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy_id: proxyId ? parseInt(proxyId) : null }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        await fetchSessions(); // Refresh data sesi
      } else {
        alert('Gagal memperbarui proxy sesi: ' + json.message);
      }
    } catch (err) {
      alert('Gagal memperbarui proxy sesi akibat masalah koneksi.');
    } finally {
      setUpdatingSessionId(null);
    }
  };

  const handleDownloadOfflineDb = async () => {
    setLoadingOfflineDb(true);
    try {
      const res = await fetch(`${API_URL}/proxies/offline-db/download`, {
        method: 'POST'
      });
      const json = await res.json();
      if (json.status === 'success') {
        setDownloading(true);
        alert('Proses pengunduhan database offline telah dimulai di latar belakang.');
        fetchOfflineDbStatus();
      } else {
        alert('Gagal memulai unduhan: ' + json.message);
      }
    } catch (err) {
      alert('Terjadi kesalahan koneksi.');
    } finally {
      setLoadingOfflineDb(false);
    }
  };

  const maskProxyUrl = (url) => {
    return url.replace(/:[^:@]+@/, ':***@');
  };

  const getLatencyColor = (ms) => {
    if (ms === 0) return 'var(--text-muted)';
    if (ms < 300) return 'var(--success)';
    if (ms < 800) return 'var(--warning)';
    return 'var(--danger)';
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getMaskedApiKey = (key) => {
    if (!key) return '';
    return key.length > 8 ? `${key.substring(0, 4)}***${key.substring(key.length - 4)}` : '***';
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Proxy Pool Manager</h2>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>V 0.0.4</span>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Manage and test proxy servers to assign them to WhatsApp devices.</p>
        </div>
      </div>

      {/* Navigasi Tab Modern */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '1px' }}>
        <button
          onClick={() => setActiveTab('pool')}
          style={{
            padding: '10px 20px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'pool' ? '2px solid var(--primary-color)' : '2px solid transparent',
            color: activeTab === 'pool' ? 'var(--text-main)' : 'var(--text-muted)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
            transition: 'all 0.2s ease',
            outline: 'none'
          }}
        >
          Proxy Pool & Routing
        </button>
        <button
          onClick={() => setActiveTab('offline-db')}
          style={{
            padding: '10px 20px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'offline-db' ? '2px solid var(--primary-color)' : '2px solid transparent',
            color: activeTab === 'offline-db' ? 'var(--text-main)' : 'var(--text-muted)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
            transition: 'all 0.2s ease',
            outline: 'none'
          }}
        >
          Offline Database & Documentation
        </button>
      </div>

      {activeTab === 'pool' ? (
        <div>
          {/* IPLocate API Configuration Card */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.125rem', marginBottom: '4px', fontWeight: 600 }}>IPLocate API Configuration</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
              Configure your personal IPLocate API key to get dedicated geolocation limits and speed.
            </p>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: '300px', marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block' }}>API Key</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Enter your IPLocate API key"
                  value={iplocateApiKey}
                  onChange={(e) => setIplocateApiKey(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Get your API key from <a href="https://www.iplocate.io/account" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>iplocate.io account settings</a>
                </div>
              </div>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ height: '40px' }}
                onClick={handleSaveApiKey}
                disabled={savingKey}
              >
                {savingKey ? 'Saving...' : 'Save API Key'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <div className="card">
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Proxies</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{proxies.length}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Active Proxies</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
                {proxies.filter(p => p.status === 'ACTIVE').length}
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Inactive / Dead</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--danger)' }}>
                {proxies.filter(p => p.status === 'INACTIVE').length}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
            <div className="card">
              <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Add Proxy Server</h3>
              <form onSubmit={handleCreateProxy} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
                  <label className="form-label">Proxy Alias Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Proxy Office Telkomsel"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 2, minWidth: '350px', marginBottom: 0 }}>
                  <label className="form-label">Proxy URL *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. http://username:password@ip:port"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: '40px' }}>
                  <Plus size={16} />
                  Add Proxy
                </button>
              </form>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Proxy Servers</h3>
              {proxies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                  <ShieldCheck size={40} style={{ opacity: 0.2, marginBottom: '12px', display: 'inline-block' }} />
                  <p>No proxy servers added yet. Add your first proxy above.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                  {proxies.map((proxy) => {
                    const testResult = testResults[proxy.id];
                    const isTesting = testingId === proxy.id;

                    return (
                      <div key={proxy.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '180px' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div style={{ fontWeight: 600, fontSize: '1rem' }}>{proxy.name}</div>
                            <span className={`badge ${proxy.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                              {proxy.status}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', wordBreak: 'break-all', fontFamily: 'monospace', backgroundColor: 'var(--bg-main)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '12px' }}>
                            {maskProxyUrl(proxy.proxy_url)}
                          </div>

                          {(proxy.ip || proxy.country || proxy.city || proxy.isp) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(99,102,241,0.03)', padding: '8px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)' }}>
                              {proxy.ip && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>Public IP:</span>
                                  <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{proxy.ip}</span>
                                </div>
                              )}
                              {(proxy.country || proxy.city) && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>Location:</span>
                                  <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                                    {proxy.city ? `${proxy.city}, ` : ''}{proxy.country}
                                  </span>
                                </div>
                              )}
                              {proxy.isp && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>ISP:</span>
                                  <span style={{ fontWeight: 500, color: 'var(--text-main)', textAlign: 'right', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={proxy.isp}>
                                    {proxy.isp}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.825rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                              <Activity size={14} /> Latency:
                            </div>
                            <span style={{ fontWeight: 600, color: testResult?.working ? getLatencyColor(testResult.latency) : getLatencyColor(0) }}>
                              {isTesting ? (
                                'Testing...'
                              ) : testResult ? (
                                testResult.working ? `${testResult.latency}ms` : 'Dead'
                              ) : (
                                'Not Tested'
                              )}
                            </span>
                          </div>

                          {testResult && !testResult.working && testResult.error && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.05)', padding: '6px 8px', borderRadius: '4px' }}>
                              <AlertTriangle size={12} />
                              <span>Error: {testResult.error}</span>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '4px' }}>
                            <button 
                              className="btn btn-outline" 
                              style={{ flex: 1, padding: '6px 12px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                              onClick={() => handleTestProxy(proxy.id)}
                              disabled={testingId !== null}
                            >
                              <RefreshCw size={14} className={isTesting ? 'spin-animation' : ''} />
                              {isTesting ? 'Testing...' : 'Test Connection'}
                            </button>
                            <button 
                              className="btn btn-outline" 
                              style={{ color: 'var(--danger)', padding: '6px' }} 
                              onClick={() => handleDeleteProxy(proxy.id)}
                              disabled={testingId !== null}
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Device Proxy Routing</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '20px' }}>
                Assign specific proxies to your WhatsApp devices. Changing a proxy will automatically reconnect the device using the new configuration.
              </p>
              {sessions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                  <Smartphone size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
                  <p>No WhatsApp devices registered yet. Go to WhatsApp Devices to add one.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                        <th style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-muted)' }}>Session ID</th>
                        <th style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-muted)' }}>Phone Number</th>
                        <th style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-muted)' }}>Status</th>
                        <th style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-muted)' }}>Active Routing (Proxy)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => {
                        const isUpdating = updatingSessionId === session.session_id;
                        return (
                          <tr key={session.session_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 8px', fontWeight: 600 }}>{session.session_id}</td>
                            <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                              {session.phone_number ? `+${session.phone_number}` : 'Not Linked'}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <span className={`badge ${session.status === 'CONNECTED' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                                {session.status}
                              </span>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <select
                                  className="form-control"
                                  style={{ 
                                    padding: '6px 12px', 
                                    fontSize: '0.875rem', 
                                    minWidth: '220px', 
                                    opacity: isUpdating ? 0.6 : 1,
                                    cursor: isUpdating ? 'not-allowed' : 'pointer'
                                  }}
                                  value={session.proxy_id || ''}
                                  onChange={(e) => handleAssignProxy(session.session_id, e.target.value)}
                                  disabled={isUpdating}
                                >
                                  <option value="">Direct Connection (No Proxy)</option>
                                  {proxies.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.status === 'ACTIVE' ? 'Active' : 'Inactive'})</option>
                                  ))}
                                </select>
                                {isUpdating && (
                                  <RefreshCw size={14} className="spin-animation" style={{ color: 'var(--primary-color)' }} />
                                )}
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
          </div>
        </div>
      ) : (
        /* Tab Offline Database & Docs */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
          
          {/* Kolom Kiri: Control & File list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="card">
              <h3 style={{ fontSize: '1.125rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Download size={20} style={{ color: 'var(--primary-color)' }} />
                Offline Database Manager
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '20px' }}>
                Download IP database files locally to your server. This offline database format allows query systems to map IP addresses without live API dependencies.
              </p>

              {/* Progress State */}
              {offlineDbStatus && (
                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>Status Unduhan:</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', color: 
                      offlineDbStatus.state.status === 'downloading' ? 'var(--primary-color)' :
                      offlineDbStatus.state.status === 'completed' ? 'var(--success)' :
                      offlineDbStatus.state.status === 'error' ? 'var(--danger)' : 'var(--text-muted)'
                    }}>
                      {offlineDbStatus.state.status === 'downloading' && <RefreshCw size={12} className="spin-animation" />}
                      {offlineDbStatus.state.status === 'completed' && <CheckCircle2 size={12} />}
                      {offlineDbStatus.state.status === 'error' && <ShieldAlert size={12} />}
                      {offlineDbStatus.state.status}
                    </span>
                  </div>

                  {offlineDbStatus.state.status === 'downloading' && (
                    <div>
                      <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        Mengunduh: <strong style={{ color: 'var(--text-main)' }}>{offlineDbStatus.state.currentFile}</strong>
                      </div>
                      
                      {/* Progress Bar */}
                      <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                        <div style={{ width: `${offlineDbStatus.state.percent}%`, height: '100%', backgroundColor: 'var(--primary-color)', borderRadius: '4px', transition: 'width 0.3s ease' }}></div>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>{formatBytes(offlineDbStatus.state.bytesDownloaded)} / {formatBytes(offlineDbStatus.state.totalBytes)}</span>
                        <span>{offlineDbStatus.state.percent}%</span>
                      </div>
                    </div>
                  )}

                  {offlineDbStatus.state.status === 'completed' && (
                    <div style={{ fontSize: '0.825rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={14} />
                      <span>Semua database offline berhasil diunduh ke disk lokal!</span>
                    </div>
                  )}

                  {offlineDbStatus.state.status === 'error' && (
                    <div style={{ fontSize: '0.825rem', color: 'var(--danger)', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>Gagal mengunduh: {offlineDbStatus.state.error}</span>
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleDownloadOfflineDb}
                disabled={loadingOfflineDb || downloading}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <RefreshCw size={16} className={downloading ? 'spin-animation' : ''} />
                {downloading ? 'Downloading...' : 'Download / Update Offline Databases'}
              </button>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '1.125rem', marginBottom: '16px' }}>Local Database Files</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {offlineDbStatus?.files.map((file, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', backgroundColor: 'rgba(99,102,241,0.01)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={14} style={{ color: 'var(--text-muted)' }} />
                        {file.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Last Updated: {file.exists ? formatDate(file.lastModified) : 'Not downloaded'}
                      </div>
                    </div>
                    <div>
                      <span className={`badge ${file.exists ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.75rem' }}>
                        {file.exists ? formatBytes(file.sizeBytes) : 'Missing'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Kolom Kanan: Documentation & CC BY-SA 4.0 Info */}
          <div className="card">
            <h3 style={{ fontSize: '1.125rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileText size={20} style={{ color: 'var(--primary-color)' }} />
              License & Documentation
            </h3>
            
            <div style={{ fontSize: '0.875rem', lineHeight: '1.6', color: 'var(--text-main)' }}>
              <p style={{ marginTop: 0 }}>
                Aplikasi ini menyediakan modul opsional untuk mengintegrasikan basis data IP global dari <strong>IPLocate.io</strong>. Dengan menggunakan database offline, server dapat melakukan analisis geolokasi secara lokal tanpa bergantung sepenuhnya pada panggilan API internet eksternal.
              </p>

              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '16px 0 8px 0', color: 'var(--primary-color)' }}>
                Ketentuan Lisensi Database
              </h4>
              <p style={{ margin: '0 0 12px 0' }}>
                Seluruh database IP yang diunduh dilisensikan di bawah lisensi resmi <strong>Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)</strong>.
              </p>

              <ul style={{ paddingLeft: '20px', margin: '0 0 16px 0', color: 'var(--text-muted)' }}>
                <li style={{ marginBottom: '6px' }}><strong>Share (Bagi):</strong> Anda diperbolehkan menyalin dan menyebarluaskan materi ini dalam format atau media apa pun.</li>
                <li style={{ marginBottom: '6px' }}><strong>Adapt (Adaptasi):</strong> Anda boleh merombak, mengubah, dan membuat turunan dari materi ini untuk kepentingan apa pun, termasuk komersial.</li>
                <li style={{ marginBottom: '6px' }}><strong>Attribution (Atribusi):</strong> Anda wajib memberikan kredit/penghargaan yang sesuai kepada IPLocate.io pada produk atau aplikasi Anda.</li>
              </ul>

              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '16px 0 8px 0', color: 'var(--primary-color)' }}>
                Direct Download Links
              </h4>
              <p style={{ margin: '0 0 12px 0', color: 'var(--text-muted)' }}>
                Jika Anda ingin mengunduh berkas secara manual, tautan berikut dapat digunakan langsung dengan API Key Anda:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                <a 
                  href={`https://www.iplocate.io/download/ip-to-country.csv?apikey=${iplocateApiKey || 'YOUR_API_KEY'}&variant=daily`}
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ color: 'var(--primary-color)', textDecoration: 'underline', wordBreak: 'break-all', fontSize: '0.8rem' }}
                >
                  ip-to-country.csv
                </a>
                <a 
                  href={`https://www.iplocate.io/download/ip-to-country-geolite2.csv?apikey=${iplocateApiKey || 'YOUR_API_KEY'}&variant=daily`}
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ color: 'var(--primary-color)', textDecoration: 'underline', wordBreak: 'break-all', fontSize: '0.8rem' }}
                >
                  ip-to-country-geolite2.csv
                </a>
                <a 
                  href={`https://www.iplocate.io/download/ip-to-asn.csv?apikey=${iplocateApiKey || 'YOUR_API_KEY'}&variant=daily`}
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ color: 'var(--primary-color)', textDecoration: 'underline', wordBreak: 'break-all', fontSize: '0.8rem' }}
                >
                  ip-to-asn.csv
                </a>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '16px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 8px 0' }}>Atribusi Wajib (Lisensi CC)</h4>
                <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  &lt;p&gt;IP address data powered by &lt;a href="https://iplocate.io"&gt;IPLocate.io&lt;/a&gt;&lt;/p&gt;
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Dipersembahkan sebagai bentuk kepatuhan lisensi CC BY-SA 4.0:</span>
                  <a href="https://iplocate.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', fontWeight: 600, textDecoration: 'underline' }}>
                    IPLocate.io
                  </a>
                </div>
              </div>

            </div>
          </div>

        </div>
      )}
      
      {/* CSS Animation for Spinner in JS */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin-animation {
          animation: spin 1s linear infinite;
        }
      `}} />
    </div>
  );
};

export default ProxyManager;
