import { useState } from 'react';
import { apiRequest } from '../apiClient';

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const json = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      onLogin(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      background: 'radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 32%), #0f172a'
    }}>
      <form onSubmit={handleSubmit} style={{
        width: '100%',
        maxWidth: 420,
        padding: '2rem',
        borderRadius: 24,
        border: '1px solid rgba(148,163,184,0.22)',
        background: 'rgba(15,23,42,0.88)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        color: '#e5e7eb'
      }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ color: '#60a5fa', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>WA-Bot Admin</div>
          <h1 style={{ margin: '0.4rem 0 0.5rem', fontSize: '1.8rem' }}>Masuk Dashboard</h1>
          <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.6 }}>Gunakan credential admin dari environment backend. Secret tidak disimpan di frontend.</p>
        </div>

        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontWeight: 600 }}>Username</label>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          style={inputStyle}
        />

        <label style={{ display: 'block', margin: '1rem 0 0.5rem', color: '#cbd5e1', fontWeight: 600 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        {error && (
          <div style={{
            marginTop: '1rem',
            padding: '0.85rem 1rem',
            borderRadius: 12,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: '#fecaca'
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: '1.5rem',
            padding: '0.95rem 1rem',
            border: 0,
            borderRadius: 14,
            background: loading ? '#64748b' : 'linear-gradient(135deg, #2563eb, #7c3aed)',
            color: 'white',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Memeriksa...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.9rem 1rem',
  borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.28)',
  background: 'rgba(15,23,42,0.9)',
  color: '#f8fafc',
  outline: 'none'
};

export default Login;
