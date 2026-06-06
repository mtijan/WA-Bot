import { useState, useEffect, useRef } from 'react';
import { 
  Layers, 
  Copy, 
  Link, 
  Download, 
  Users, 
  ShieldAlert, 
  UserCheck, 
  Search, 
  RefreshCw,
  FileJson,
  CheckCircle,
  FileText
} from 'lucide-react';
import { apiRequest } from '../apiClient';

const GroupGrabber = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatingLinkGroupId, setGeneratingLinkGroupId] = useState(null);

  // Search, Filter, Sort
  const [viewMode, setViewMode] = useState('groups'); // 'groups', 'communities', 'labels'
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all'); // 'all', 'admin', 'member'
  const [sortBy, setSortBy] = useState('name'); // 'name', 'members'

  const selectedSessionIdRef = useRef(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      grabGroups();
    } else {
      setGroups([]);
      setSelectedGroupIds([]);
    }
  }, [selectedSessionId]);

  const fetchSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      if (json.status === 'success') {
        const connected = (json.data || []).filter(s => s.status === 'CONNECTED');
        const currentSelected = selectedSessionIdRef.current;
        
        setSessions(prev => {
          const wasSelectedActive = prev.some(s => s.session_id === currentSelected);
          const isSelectedActive = connected.some(s => s.session_id === currentSelected);
          
          if (currentSelected && wasSelectedActive && !isSelectedActive) {
            window.showWarning(`Perangkat "${currentSelected}" telah terputus secara otomatis.`);
            setSelectedSessionId(connected.length > 0 ? connected[0].session_id : '');
          } else if (!currentSelected && connected.length > 0) {
            setSelectedSessionId(connected[0].session_id);
          }
          return connected;
        });
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const grabGroups = async () => {
    if (!selectedSessionId) return;
    try {
      setLoading(true);
      const json = await apiRequest(`/group-grabber/groups/${selectedSessionId}?t=${Date.now()}`);
      if (json.status === 'success') {
        setGroups(json.data || []);
        setSelectedGroupIds([]);
      } else {
        window.showError(json.message || 'Gagal mengambil data grup.');
      }
    } catch (err) {
      console.error('Error grabbing WhatsApp groups:', err);
      window.showError('Kesalahan jaringan saat mengambil daftar grup.');
    } finally {
      setLoading(false);
    }
  };

  const getSelectedDeviceName = () => {
    const s = sessions.find(item => item.session_id === selectedSessionId);
    return s ? (s.phone_number ? `${s.session_id} (${s.phone_number})` : s.session_id) : '';
  };

  // Toggle selection
  const handleToggleSelectAll = (filteredList) => {
    const filteredIds = filteredList.map(g => g.id);
    const allSelected = filteredIds.every(id => selectedGroupIds.includes(id));
    
    if (allSelected) {
      // Remove all filtered ids
      setSelectedGroupIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // Add all filtered ids uniquely
      setSelectedGroupIds(prev => [...new Set([...prev, ...filteredIds])]);
    }
  };

  const handleToggleSelectOne = (id) => {
    setSelectedGroupIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // 1. Copy Group IDs to clipboard
  const handleCopyGroupIds = () => {
    if (selectedGroupIds.length === 0) {
      window.showWarning('Pilih minimal satu grup terlebih dahulu.');
      return;
    }
    const idsString = selectedGroupIds.join(', ');
    navigator.clipboard.writeText(idsString);
    window.showSuccess(`Berhasil menyalin ${selectedGroupIds.length} ID grup ke clipboard.`);
  };

  // 2. Generate Invite Links for selected admin groups
  const handleGenerateInviteLinks = async () => {
    if (selectedGroupIds.length === 0) {
      window.showWarning('Pilih minimal satu grup terlebih dahulu.');
      return;
    }

    const selectedGroups = groups.filter(g => selectedGroupIds.includes(g.id));
    const adminGroups = selectedGroups.filter(g => g.isAdmin);

    if (adminGroups.length === 0) {
      window.showWarning('Anda harus menjadi admin di grup terpilih untuk membuat link undangan.');
      return;
    }

    try {
      setLoading(true);
      let results = [];
      let fails = 0;

      for (const g of adminGroups) {
        try {
          const json = await apiRequest('/group-grabber/invite-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: selectedSessionId,
              groupId: g.id
            })
          });
          if (json.status === 'success' && json.data.inviteLink) {
            results.push(`${g.subject}: ${json.data.inviteLink}`);
          } else {
            fails++;
          }
        } catch {
          fails++;
        }
      }

      if (results.length > 0) {
        const linksText = results.join('\n');
        navigator.clipboard.writeText(linksText);
        window.showSuccess(`Tautan untuk ${results.length} grup berhasil dibuat dan disalin ke clipboard.`);
      }
      if (fails > 0) {
        window.showError(`Gagal membuat tautan untuk ${fails} grup.`);
      }
    } catch {
      window.showError('Gagal menjalankan pembuatan tautan undangan.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Export Participants CSV
  const handleExportParticipants = async (explicitGroupIds) => {
    const actualGroupIds = (explicitGroupIds && Array.isArray(explicitGroupIds))
      ? explicitGroupIds
      : selectedGroupIds;

    if (!actualGroupIds || actualGroupIds.length === 0) {
      window.showWarning('Silakan centang minimal satu grup pada tabel di bawah untuk diekspor anggotanya.');
      return;
    }

    try {
      setLoading(true);
      const blob = await apiRequest('/group-grabber/export-participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          groupIds: actualGroupIds
        }),
        responseType: 'blob'
      });

      // Download streaming CSV
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      let filenamePrefix = 'ExportWAContacts';
      if (actualGroupIds.length === 1) {
        const targetGroup = groups.find(g => g.id === actualGroupIds[0]);
        if (targetGroup && targetGroup.subject) {
          const safeSubject = targetGroup.subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
          filenamePrefix = `ExportWAContacts_${safeSubject}`;
        }
      } else {
        filenamePrefix = 'ExportWAContacts_MultipleGroups';
      }

      link.setAttribute('download', `${filenamePrefix}_${timestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.showSuccess(`Ekstraksi sukses! Daftar kontak berhasil diekspor.`);
    } catch (err) {
      console.error(err);
      window.showError('Gagal melakukan ekspor anggota grup.');
    } finally {
      setLoading(false);
    }
  };

  // 5. Export JSON
  const handleExportJson = async () => {
    if (selectedGroupIds.length === 0) {
      window.showWarning('Silakan centang minimal satu grup pada tabel di bawah untuk diekspor anggotanya.');
      return;
    }

    try {
      setLoading(true);
      const blob = await apiRequest('/group-grabber/export-participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          groupIds: selectedGroupIds,
          format: 'json'
        }),
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      let filenamePrefix = 'ExportWAContacts';
      if (selectedGroupIds.length === 1) {
        const targetGroup = groups.find(g => g.id === selectedGroupIds[0]);
        if (targetGroup && targetGroup.subject) {
          const safeSubject = targetGroup.subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
          filenamePrefix = `ExportWAContacts_${safeSubject}`;
        }
      } else {
        filenamePrefix = 'ExportWAContacts_MultipleGroups';
      }

      link.setAttribute('download', `${filenamePrefix}_${timestamp}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.showSuccess(`Ekstraksi sukses! Berkas JSON berhasil diekspor.`);
    } catch (err) {
      console.error(err);
      window.showError('Gagal melakukan ekspor data JSON.');
    } finally {
      setLoading(false);
    }
  };

  // 6. Export TXT (johndoe1,62xxx,)
  const handleExportTxt = async () => {
    if (selectedGroupIds.length === 0) {
      window.showWarning('Silakan centang minimal satu grup pada tabel di bawah untuk diekspor anggotanya.');
      return;
    }

    try {
      setLoading(true);
      const blob = await apiRequest('/group-grabber/export-participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          groupIds: selectedGroupIds,
          format: 'txt'
        }),
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      let filenamePrefix = 'ExportWAContacts';
      if (selectedGroupIds.length === 1) {
        const targetGroup = groups.find(g => g.id === selectedGroupIds[0]);
        if (targetGroup && targetGroup.subject) {
          const safeSubject = targetGroup.subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
          filenamePrefix = `ExportWAContacts_${safeSubject}`;
        }
      } else {
        filenamePrefix = 'ExportWAContacts_MultipleGroups';
      }

      link.setAttribute('download', `${filenamePrefix}_${timestamp}.txt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.showSuccess(`Ekstraksi sukses! Berkas TXT berhasil diekspor.`);
    } catch (err) {
      console.error(err);
      window.showError('Gagal melakukan ekspor data TXT.');
    } finally {
      setLoading(false);
    }
  };

  // Generate Invite Link for one specific group row
  const generateSingleInviteLink = async (groupId, groupName) => {
    try {
      setGeneratingLinkGroupId(groupId);
      const json = await apiRequest('/group-grabber/invite-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          groupId: groupId
        })
      });
      if (json.status === 'success' && json.data.inviteLink) {
        navigator.clipboard.writeText(json.data.inviteLink);
        window.showSuccess(`Tautan undangan untuk ${groupName} berhasil disalin ke clipboard.`);
      } else {
        window.showError(json.message || 'Gagal membuat tautan undangan.');
      }
    } catch {
      window.showError('Gagal membuat tautan undangan.');
    } finally {
      setGeneratingLinkGroupId(null);
    }
  };

  // Filter & Sort Logic
  const filteredGroups = groups.filter(g => {
    // 1. View Mode (Groups, Communities)
    if (viewMode === 'groups' && g.isCommunity) return false;
    if (viewMode === 'communities' && !g.isCommunity) return false;
    
    // 2. Role Filter
    if (roleFilter === 'admin' && !g.isAdmin) return false;
    if (roleFilter === 'member' && g.isAdmin) return false;

    // 3. Search Query
    const searchLower = searchQuery.toLowerCase();
    return g.subject.toLowerCase().includes(searchLower) || g.id.includes(searchLower);
  });

  const sortedGroups = [...filteredGroups].sort((a, b) => {
    if (sortBy === 'name') {
      return a.subject.localeCompare(b.subject);
    } else {
      return b.size - a.size;
    }
  });

  // Calculate statistics
  const totalGroupsCount = groups.filter(g => !g.isCommunity).length;
  const totalCommunitiesCount = groups.filter(g => g.isCommunity).length;
  const adminGroupsCount = groups.filter(g => g.isAdmin).length;
  const memberGroupsCount = groups.filter(g => !g.isAdmin).length;
  const totalParticipantsCount = groups.reduce((acc, g) => acc + g.size, 0);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Header Halaman */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Group Grabber</h1>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--primary-color)',
              padding: '2px 8px',
              borderRadius: '9999px',
              border: '1px solid rgba(99, 102, 241, 0.2)'
            }}>
              V 0.0.1
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Extract and manage WhatsApp groups and communities data from active devices
          </p>
        </div>

        {/* Grabber Toolbar Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            type="button" 
            onClick={handleCopyGroupIds} 
            className="btn btn-outline"
            style={{ borderRadius: '8px', padding: '10px 16px', height: '40px' }}
          >
            <Copy size={16} /> Copy Group IDs
          </button>
          <button 
            type="button" 
            onClick={handleGenerateInviteLinks} 
            className="btn btn-outline"
            style={{ borderRadius: '8px', padding: '10px 16px', height: '40px' }}
          >
            <Link size={16} /> Generate Invite Links
          </button>

          <button 
            type="button" 
            onClick={handleExportParticipants} 
            className="btn btn-primary"
            style={{ 
              borderRadius: '8px', 
              padding: '10px 16px', 
              height: '40px',
              backgroundColor: 'var(--success)',
              border: 'none',
              fontWeight: 600
            }}
          >
            <Users size={16} /> Export Participants
          </button>
          <button 
            type="button" 
            onClick={handleExportJson} 
            className="btn btn-outline"
            style={{ borderRadius: '8px', padding: '10px 16px', height: '40px' }}
          >
            <FileJson size={16} /> Export JSON
          </button>
          <button 
            type="button" 
            onClick={handleExportTxt} 
            className="btn btn-outline"
            style={{ borderRadius: '8px', padding: '10px 16px', height: '40px' }}
          >
            <FileText size={16} /> Export TXT
          </button>
        </div>
      </div>

      {/* Select Device Card */}
      <div className="card" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 24px',
        borderRadius: '12px',
        marginBottom: '24px',
        background: 'white',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ flex: 1, maxHeight: '80px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Select Device</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <select
              className="form-control"
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              style={{ borderRadius: '8px', height: '42px', width: '380px' }}
            >
              {sessions.length === 0 ? (
                <option value="">No connected devices available</option>
              ) : (
                sessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.phone_number ? `${s.session_id} (${s.phone_number})` : s.session_id}
                  </option>
                ))
              )}
            </select>

            {selectedSessionId && (
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <CheckCircle size={14} /> Connected: {getSelectedDeviceName()}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={grabGroups}
          disabled={loading || !selectedSessionId}
          className="btn btn-outline"
          style={{ height: '42px', padding: '0 16px', borderRadius: '8px', alignSelf: 'flex-end' }}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Reload Groups</span>
        </button>
      </div>

      {/* Row of 5 Statistics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderLeft: '4px solid var(--primary-color)' }}>
          <div style={{ padding: '8px', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary-color)', borderRadius: '8px' }}>
            <Layers size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Total Groups</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{totalGroupsCount}</div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderLeft: '4px solid var(--secondary-color)' }}>
          <div style={{ padding: '8px', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: 'var(--secondary-color)', borderRadius: '8px' }}>
            <Layers size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Communities</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{totalCommunitiesCount}</div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderLeft: '4px solid var(--success)' }}>
          <div style={{ padding: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', borderRadius: '8px' }}>
            <Users size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Total Participants</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{totalParticipantsCount}</div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderLeft: '4px solid var(--warning)' }}>
          <div style={{ padding: '8px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', borderRadius: '8px' }}>
            <UserCheck size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Admin Groups</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{adminGroupsCount}</div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderLeft: '4px solid var(--info)' }}>
          <div style={{ padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--info)', borderRadius: '8px' }}>
            <Users size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Member Groups</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{memberGroupsCount}</div>
          </div>
        </div>
      </div>

      {/* Grid Container */}
      <div className="card" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        background: 'white',
        border: '1px solid var(--border-color)',
        padding: '20px 24px'
      }}>
        {/* Table View mode & Filter toolbar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px'
        }}>
          {/* TABS View Mode */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setViewMode('groups')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
                transition: 'all 0.2s',
                backgroundColor: viewMode === 'groups' ? 'var(--primary-color)' : 'transparent',
                color: viewMode === 'groups' ? 'white' : 'var(--text-muted)'
              }}
            >
              Groups ({totalGroupsCount})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('communities')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
                transition: 'all 0.2s',
                backgroundColor: viewMode === 'communities' ? 'var(--primary-color)' : 'transparent',
                color: viewMode === 'communities' ? 'white' : 'var(--text-muted)'
              }}
            >
              Communities ({totalCommunitiesCount})
            </button>
          </div>

          {/* Search, Filter, Sort Inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                <Search size={14} />
              </span>
              <input
                type="text"
                placeholder="Search groups..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-control"
                style={{
                  paddingLeft: '34px',
                  width: '240px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  height: '38px'
                }}
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="form-control"
              style={{ borderRadius: '8px', height: '38px', width: '130px', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All Roles</option>
              <option value="admin">As Admin</option>
              <option value="member">As Member</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="form-control"
              style={{ borderRadius: '8px', height: '38px', width: '140px', border: '1px solid var(--border-color)' }}
            >
              <option value="name">Sort by Name</option>
              <option value="members">Sort by Members</option>
            </select>
          </div>
        </div>

        {/* Table representation */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', maxWidth: '1200px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ padding: '12px 16px', width: '48px' }}>
                  <input
                    type="checkbox"
                    checked={sortedGroups.length > 0 && sortedGroups.every(g => selectedGroupIds.includes(g.id))}
                    onChange={() => handleToggleSelectAll(sortedGroups)}
                    style={{ width: '16px', height: '16px', borderRadius: '4px', cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                  />
                </th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', width: '45%' }}>Group Name</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', width: '140px' }}>Role</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', width: '160px' }}>Members Count</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', width: '160px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ padding: '60px', textCenter: 'center', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Extracting groups and parsing communities, please wait...
                  </td>
                </tr>
              ) : sortedGroups.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ padding: '60px', textCenter: 'center', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                    No groups or communities found. Make sure your WhatsApp device is connected.
                  </td>
                </tr>
              ) : (
                sortedGroups.map(g => (
                  <tr key={g.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(g.id)}
                        onChange={() => handleToggleSelectOne(g.id)}
                        style={{ width: '16px', height: '16px', borderRadius: '4px', cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                      />
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.875rem' }}>
                      {g.subject}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {g.isAdmin ? (
                        <span style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 700, 
                          color: '#f97316', 
                          backgroundColor: 'rgba(249, 115, 22, 0.1)', 
                          padding: '3px 8px', 
                          borderRadius: '4px' 
                        }}>
                          Admin
                        </span>
                      ) : (
                        <span style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 700, 
                          color: 'var(--primary-color)', 
                          backgroundColor: 'rgba(99, 102, 241, 0.08)', 
                          padding: '3px 8px', 
                          borderRadius: '4px' 
                        }}>
                          Member
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 500 }}>
                      {g.size} members
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        {g.isAdmin ? (
                          <button
                            type="button"
                            disabled={generatingLinkGroupId === g.id}
                            onClick={() => generateSingleInviteLink(g.id, g.subject)}
                            className="btn-icon"
                            title="Generate and copy invite link"
                            style={{ 
                              width: '32px', 
                              height: '32px', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '6px',
                              color: 'var(--primary-color)',
                              backgroundColor: 'rgba(99, 102, 241, 0.02)'
                            }}
                          >
                            <Link size={14} className={generatingLinkGroupId === g.id ? 'spin' : ''} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="btn-icon"
                            title="Invite link generation only available for Admin groups"
                            style={{ 
                              width: '32px', 
                              height: '32px', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '6px',
                              color: 'var(--text-light)',
                              cursor: 'not-allowed',
                              opacity: 0.5
                            }}
                          >
                            <ShieldAlert size={14} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            handleExportParticipants([g.id]);
                          }}
                          className="btn-icon"
                          title="Export this group's participants to CSV"
                          style={{ 
                            width: '32px', 
                            height: '32px', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: '6px',
                            color: 'var(--success)',
                            backgroundColor: 'rgba(16, 185, 129, 0.02)'
                          }}
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default GroupGrabber;
