import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import { apiRequest } from './apiClient';

// Lazy-loaded page components for code splitting
const Dashboard = lazy(() => import('./components/Dashboard'));
const SessionManager = lazy(() => import('./components/SessionManager'));
const BulkCampaign = lazy(() => import('./components/BulkCampaign'));
const ChatbotFlows = lazy(() => import('./components/ChatbotFlows'));
const ContactGroups = lazy(() => import('./components/ContactGroups'));
const GroupDetail = lazy(() => import('./components/GroupDetail'));
const Warmer = lazy(() => import('./components/Warmer'));
const Templates = lazy(() => import('./components/Templates'));
const SingleMessage = lazy(() => import('./components/SingleMessage'));
const GroupGrabber = lazy(() => import('./components/GroupGrabber'));
const ChatbotAI = lazy(() => import('./components/ChatbotAI'));
const Monitoring = lazy(() => import('./components/Monitoring'));
const QRCodeGenerator = lazy(() => import('./components/QRCodeGenerator'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const PlansManagement = lazy(() => import('./components/PlansManagement'));

function App() {
  const [toasts, setToasts] = useState([]);
  const [authState, setAuthState] = useState({ loading: true, enabled: false, authenticated: false, username: null, role: null });

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthState({ loading: false, enabled: true, authenticated: false, username: null, role: null });
    };
    window.addEventListener('unauthorized-api-call', handleUnauthorized);
    return () => {
      window.removeEventListener('unauthorized-api-call', handleUnauthorized);
    };
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    const cleanMsg = typeof message === 'object' ? JSON.stringify(message) : String(message);
    
    setToasts(prev => [...prev, { id, message: cleanMsg, type }]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    // Override default alert
    window.alert = (msg) => {
      addToast(msg, 'warning');
    };
    
    // Developer helpers for explicit toast triggers
    window.showSuccess = (msg) => addToast(msg, 'success');
    window.showError = (msg) => addToast(msg, 'error');
    window.showWarning = (msg) => addToast(msg, 'warning');
    window.showInfo = (msg) => addToast(msg, 'info');
  }, [addToast]);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const json = await apiRequest('/auth/me');
        if (!cancelled) setAuthState({ loading: false, ...json.data });
      } catch {
        if (!cancelled) setAuthState({ loading: false, enabled: true, authenticated: false, username: null, role: null });
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (e) {}
    setAuthState({ loading: false, enabled: true, authenticated: false, username: null, role: null });
  };

  if (authState.loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e5e7eb' }}>
        Memeriksa sesi admin...
      </div>
    );
  }

  if (authState.enabled && !authState.authenticated) {
    return <Login onLogin={(data) => setAuthState({ loading: false, ...data })} />;
  }

  return (
    <Router>
      <div className="app-container">
        <Sidebar authState={authState} onLogout={handleLogout} />
        <main className="main-content">
          <Suspense fallback={
            <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
              Memuat halaman...
            </div>
          }>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {authState.role === 'admin' && (
              <Route path="/monitoring" element={<Monitoring />} />
            )}
            <Route path="/devices" element={<SessionManager />} />
            <Route path="/bulk" element={<BulkCampaign />} />
            <Route path="/chatbot-flows" element={<ChatbotFlows />} />
            <Route path="/contacts" element={<ContactGroups />} />
            <Route path="/contacts/:groupId" element={<GroupDetail />} />
            
            <Route path="/single-message" element={<SingleMessage />} />
            <Route path="/group-grabber" element={<GroupGrabber />} />
            <Route path="/templates" element={<Templates />} />
            {/* <Route path="/proxies" element={<ProxyManager API_URL={API_URL} />} /> */}

            <Route path="/warmer" element={<Warmer />} />
            <Route path="/opt-out" element={<div className="card"><h2>Opt-Out Management</h2><p>Feature under construction.</p></div>} />
            <Route path="/chatbot-ai" element={<ChatbotAI />} />
            <Route path="/auto-reply" element={<Navigate to="/chatbot-ai" replace />} />
            <Route path="/qrcode-generator" element={<QRCodeGenerator />} />
            {authState.role === 'admin' && (
              <>
                <Route path="/users" element={<UserManagement />} />
                <Route path="/plans" element={<PlansManagement />} />
              </>
            )}
            
            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>

        {/* Floating Custom Glassmorphic Notification Toast Container */}
        {toasts.length > 0 && (
          <div className="toast-container">
            {toasts.map(t => {
              let Icon = Info;
              let iconClass = 'toast-info-icon';
              let title = 'Info';
              if (t.type === 'success') {
                Icon = CheckCircle;
                iconClass = 'toast-success-icon';
                title = 'Sukses';
              } else if (t.type === 'error') {
                Icon = XCircle;
                iconClass = 'toast-error-icon';
                title = 'Error';
              } else if (t.type === 'warning') {
                Icon = AlertCircle;
                iconClass = 'toast-warning-icon';
                title = 'Perhatian';
              }

              return (
                <div key={t.id} className={`toast-card toast-${t.type}`}>
                  <div className={`toast-icon ${iconClass}`}>
                    <Icon size={18} />
                  </div>
                  <div className="toast-content">
                    <div className="toast-title">{title}</div>
                    <div className="toast-message">{t.message}</div>
                  </div>
                  <button 
                    className="toast-close"
                    onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Router>
  );
}

export default App;
