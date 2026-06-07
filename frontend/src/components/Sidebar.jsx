import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  FileText,
  Users,
  Send,
  Flame,
  UserMinus,
  Bot,
  Network,
  Layers,
  LogOut,
  MoreVertical
} from 'lucide-react';

const Sidebar = ({ authState, onLogout }) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const navItems = [
    { path: '/', name: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { path: '/devices', name: 'Devices', icon: <Smartphone size={20} /> },
    { path: '/single-message', name: 'Single Message', icon: <MessageSquare size={20} /> },
    { path: '/templates', name: 'Templates', icon: <FileText size={20} /> },
    { path: '/contacts', name: 'Contacts', icon: <Users size={20} /> },
    { path: '/bulk', name: 'Bulk Messages', icon: <Send size={20} /> },
    // { path: '/proxies', name: 'Proxies' },

    { path: '/warmer', name: 'Warmer', icon: <Flame size={20} /> },
    { path: '/opt-out', name: 'Opt-Out Management', icon: <UserMinus size={20} /> },
    { path: '/chatbot-ai', name: 'Chatbot AI', icon: <Bot size={20} /> },
    { path: '/chatbot-flows', name: 'Chatbot Flows', icon: <Network size={20} /> },
    { path: '/group-grabber', name: 'Group Grabber', icon: <Layers size={20} /> },
  ];

  return (
    <div style={{
      width: '260px',
      backgroundColor: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh'
    }}>
      <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold'
        }}>
          T
        </div>
        <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700, color: 'var(--text-main)' }}>T-Wave</h2>
      </div>

      <nav style={{ flex: 1, padding: '0 16px', overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: 'var(--border-radius-sm)',
                  textDecoration: 'none',
                  color: isActive ? 'var(--primary-color)' : 'var(--text-muted)',
                  backgroundColor: isActive ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  fontWeight: isActive ? 600 : 500,
                  transition: 'all 0.2s'
                })}
              >
                {item.icon}
                <span>{item.name}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div style={{ padding: '18px 16px 24px', borderTop: '1px solid var(--border-color)', position: 'relative' }}>
        {profileMenuOpen && authState?.enabled && (
          <div style={{
            position: 'absolute',
            left: '16px',
            right: '16px',
            bottom: '86px',
            padding: '10px',
            border: '1px solid rgba(239, 68, 68, 0.18)',
            borderRadius: '14px',
            background: '#ffffff',
            boxShadow: '0 18px 45px rgba(15, 23, 42, 0.16)',
            zIndex: 20
          }}>
            <button
              onClick={() => {
                setProfileMenuOpen(false);
                onLogout?.();
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 12px',
                border: '1px solid rgba(239, 68, 68, 0.24)',
                borderRadius: '10px',
                background: 'var(--danger-bg)',
                color: '#dc2626',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px',
          borderRadius: '16px',
          background: 'rgba(248, 250, 252, 0.85)',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a', fontWeight: 700 }}>
            A
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
              {authState?.username || 'Admin User'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pro Plan</div>
          </div>
          {authState?.enabled && (
            <button
              aria-label="Buka menu admin"
              onClick={() => setProfileMenuOpen(open => !open)}
              style={{
                width: '34px',
                height: '34px',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: profileMenuOpen ? 'rgba(239, 68, 68, 0.08)' : '#fff',
                color: profileMenuOpen ? '#dc2626' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <MoreVertical size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
