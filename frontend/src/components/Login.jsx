import { useState } from 'react';
import { Bot, Lock, User, AlertCircle } from 'lucide-react';
import { apiRequest } from '../apiClient';

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);

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
      background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.15) 0%, rgba(15, 23, 42, 0) 70%), linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e1b4b 100%)',
      fontFamily: '"Outfit", "Inter", sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative background glow blobs */}
      <div style={{
        position: 'absolute',
        width: '300px',
        height: '300px',
        borderRadius: '50%',
        background: 'rgba(99, 102, 241, 0.12)',
        filter: 'blur(80px)',
        top: '20%',
        left: '30%',
        zIndex: 0,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute',
        width: '350px',
        height: '350px',
        borderRadius: '50%',
        background: 'rgba(168, 85, 247, 0.08)',
        filter: 'blur(100px)',
        bottom: '20%',
        right: '30%',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <form onSubmit={handleSubmit} style={{
        position: 'relative',
        width: '100%',
        maxWidth: 420,
        padding: '2.5rem',
        borderRadius: 24,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
        color: '#f1f5f9',
        zIndex: 1
      }}>
        {/* Logo / Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            borderRadius: '16px', 
            background: 'linear-gradient(135deg, #4f46e5, #9333ea)', 
            boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            marginBottom: '1rem'
          }}>
            <Bot size={32} color="white" />
          </div>
          <div style={{ 
            color: '#818cf8', 
            fontSize: '0.75rem', 
            fontWeight: 700, 
            letterSpacing: '0.15em', 
            textTransform: 'uppercase',
            marginBottom: '4px'
          }}>
            WA-Bot Pro Admin
          </div>
          <h1 style={{ 
            margin: '4px 0 8px', 
            fontSize: '1.75rem', 
            fontWeight: 800, 
            color: '#ffffff', 
            letterSpacing: '-0.02em' 
          }}>
            Masuk Dashboard
          </h1>
          <p style={{ 
            margin: 0, 
            color: '#94a3b8', 
            fontSize: '0.875rem', 
            lineHeight: 1.5,
            padding: '0 8px'
          }}>
            Gunakan kredensial admin dari konfigurasi backend Anda. Kredensial tidak disimpan di frontend.
          </p>
        </div>

        {/* Username field */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '0.5rem', 
            color: '#cbd5e1', 
            fontSize: '0.875rem', 
            fontWeight: 600 
          }}>
            Username
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ 
              position: 'absolute', 
              left: '12px', 
              top: '50%', 
              transform: 'translateY(-50%)', 
              color: '#64748b',
              display: 'flex',
              alignItems: 'center'
            }}>
              <User size={18} />
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              onFocus={() => setFocusedInput('username')}
              onBlur={() => setFocusedInput(null)}
              style={{
                ...inputStyle,
                border: focusedInput === 'username' ? '1px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.16)',
                boxShadow: focusedInput === 'username' ? '0 0 0 3px rgba(99, 102, 241, 0.15)' : 'none',
              }}
            />
          </div>
        </div>

        {/* Password field */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '0.5rem', 
            color: '#cbd5e1', 
            fontSize: '0.875rem', 
            fontWeight: 600 
          }}>
            Password
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ 
              position: 'absolute', 
              left: '12px', 
              top: '50%', 
              transform: 'translateY(-50%)', 
              color: '#64748b',
              display: 'flex',
              alignItems: 'center'
            }}>
              <Lock size={18} />
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              onFocus={() => setFocusedInput('password')}
              onBlur={() => setFocusedInput(null)}
              placeholder="Masukkan password..."
              style={{
                ...inputStyle,
                border: focusedInput === 'password' ? '1px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.16)',
                boxShadow: focusedInput === 'password' ? '0 0 0 3px rgba(99, 102, 241, 0.15)' : 'none',
              }}
            />
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            margin: '1.25rem 0',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#fca5a5',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.9rem 1rem',
            border: 0,
            borderRadius: 12,
            background: loading ? '#475569' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            color: 'white',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 12px rgba(79, 70, 229, 0.25)',
            transition: 'all 0.2s ease',
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
  padding: '0.85rem 1rem 0.85rem 2.5rem',
  borderRadius: 12,
  background: 'rgba(15, 23, 42, 0.6)',
  color: '#f8fafc',
  fontSize: '0.95rem',
  outline: 'none',
  transition: 'all 0.2s ease'
};

export default Login;
