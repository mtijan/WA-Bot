import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Search, 
  RefreshCw, 
  Layers, 
  CheckCircle, 
  Trash2, 
  Eye, 
  Send, 
  X, 
  Smartphone,
  MessageSquare,
  FileText
} from 'lucide-react';
import { apiRequest } from '../apiClient';
import MediaUploadField from './MediaUploadField';

const STANDARD_CONTACT_VARIABLES = ['Nama', 'Phone Number', 'Email', 'Company', 'Position', 'Tags', 'Notes'];

const buildContactVariables = (contact) => ({
  Nama: contact.name || '',
  'Phone Number': contact.phone_number || '',
  Email: contact.email || '',
  Company: contact.company || '',
  Position: contact.position || '',
  Tags: contact.tags || '',
  Notes: contact.notes || '',
  ...(contact.custom_fields || {})
});

const BulkCampaign = () => {
  // Campaign list and search state
  const [campaigns, setCampaigns] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  // Sessions and groups metadata
  const [sessions, setSessions] = useState([]);
  const [contactGroups, setContactGroups] = useState([]);
  const [templates, setTemplates] = useState([]);

  // Non-blocking slide-over drawer states
  const [drawerCampaignId, setDrawerCampaignId] = useState(null);
  const [drawerProgress, setDrawerProgress] = useState(null);

  // --- Create Campaign Form State ---
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [messageType, setMessageType] = useState('text'); // 'text' or 'template'
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [selectionMethod, setSelectionMethod] = useState('groups'); // 'groups', 'all', 'manual', 'paste'
  const [selectedGroupsList, setSelectedGroupsList] = useState([]);
  const [pastedNumbers, setPastedNumbers] = useState('');
  const [delayMin, setDelayMin] = useState(3);
  const [delayMax, setDelayMax] = useState(9);
  const [maxRetries, setMaxRetries] = useState(3);
  const [computedTargets, setComputedTargets] = useState([]);
  const [availableVariables, setAvailableVariables] = useState(STANDARD_CONTACT_VARIABLES);
  const messageInputRef = useRef(null);

  // Campaign Media/Attachment State
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentType, setAttachmentType] = useState('Image');
  const [attachmentName, setAttachmentName] = useState('');

  // Template Modal
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ 
    show: false, 
    title: '', 
    message: '', 
    confirmLabel: 'Ya, Hapus', 
    confirmBtnClass: 'btn-danger', 
    onConfirm: null 
  });

  const triggerConfirm = (title, message, confirmLabel, confirmBtnClass, onConfirm) => {
    setConfirmDialog({
      show: true,
      title,
      message,
      confirmLabel,
      confirmBtnClass,
      onConfirm
    });
  };

  // Fetch initial data
  useEffect(() => {
    fetchCampaigns();
    fetchSessions();
    fetchContactGroups();
    fetchTemplates();
  }, []);

  // Auto-refresh logic
  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(fetchCampaigns, 5000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Monitor progress in real-time when the slide-over drawer is open for a campaign
  useEffect(() => {
    let interval;
    const fetchDrawerProgress = async () => {
      if (!drawerCampaignId) return;
      try {
        const json = await apiRequest(`/campaigns/${drawerCampaignId}`);
        if (json.status === 'success') {
          setDrawerProgress(json.data);
          // If the campaign completes while they are watching, refresh list
          if (json.data.campaign_status === 'COMPLETED') {
            fetchCampaigns();
          }
        }
      } catch (err) {
        console.error('Gagal mengambil progress kampanye untuk laci samping:', err);
      }
    };

    if (drawerCampaignId) {
      fetchDrawerProgress();
      interval = setInterval(fetchDrawerProgress, 2000);
    } else {
      setDrawerProgress(null);
    }

    return () => clearInterval(interval);
  }, [drawerCampaignId]);

  // Dynamically calculate computed targets count
  useEffect(() => {
    const calculateTargets = async () => {
      if (selectionMethod === 'groups') {
        if (selectedGroupsList.length === 0) {
          setComputedTargets([]);
          setAvailableVariables(STANDARD_CONTACT_VARIABLES);
          return;
        }

        try {
          const responses = await Promise.all(
            selectedGroupsList.map((groupId) => apiRequest(`/contacts?groupId=${groupId}`))
          );
          const contactsByPhone = new Map();
          const customVariableNames = new Map();

          for (const json of responses) {
            if (json.status !== 'success') continue;
            for (const contact of (json.data || [])) {
              for (const variableName of Object.keys(contact.custom_fields || {})) {
                const key = variableName.trim().toLocaleLowerCase('id-ID');
                if (key && !customVariableNames.has(key)) customVariableNames.set(key, variableName.trim());
              }
              if (contact.status !== 'VERIFIED') continue;
              const normalizedPhone = String(contact.phone_number || '').replace(/\D/g, '').replace(/^0/, '62');
              if (!normalizedPhone || contactsByPhone.has(normalizedPhone)) continue;
              const variables = buildContactVariables(contact);
              contactsByPhone.set(normalizedPhone, {
                contact_id: contact.id,
                phone_number: normalizedPhone,
                variables
              });
            }
          }

          setComputedTargets([...contactsByPhone.values()]);
          setAvailableVariables([
            ...STANDARD_CONTACT_VARIABLES,
            ...customVariableNames.values()
          ]);
        } catch (err) {
          console.error('Gagal menghitung target grup:', err);
          setComputedTargets([]);
          setAvailableVariables(STANDARD_CONTACT_VARIABLES);
        }
      } else if (selectionMethod === 'paste') {
        const nums = pastedNumbers
          .split('\n')
          .map(num => num.replace(/\D/g, ''))
          .filter(Boolean);
        setComputedTargets([...new Set(nums)]);
        setAvailableVariables(['Phone Number']);
      } else {
        setComputedTargets([]);
        setAvailableVariables(STANDARD_CONTACT_VARIABLES);
      }
    };

    calculateTargets();
  }, [selectedGroupsList, selectionMethod, pastedNumbers]);

  const variableValidation = useMemo(() => {
    const tokenNames = [...new Set(
      [...messageContent.matchAll(/\{\{\s*([^{}|]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter((name) => name.toLocaleLowerCase('id-ID') !== 'random')
    )];
    if (selectionMethod !== 'groups' || tokenNames.length === 0 || computedTargets.length === 0) {
      return { tokenNames, missingContacts: 0 };
    }

    let missingContacts = 0;
    for (const target of computedTargets) {
      const variables = target.variables || {};
      const lookup = new Map(
        Object.entries(variables).map(([name, value]) => [
          name.trim().toLocaleLowerCase('id-ID'),
          String(value ?? '')
        ])
      );
      if (!lookup.has('name')) lookup.set('name', lookup.get('nama') || '');
      if (!lookup.has('nama')) lookup.set('nama', lookup.get('name') || '');
      if (!lookup.has('phone')) lookup.set('phone', lookup.get('phone number') || '');
      if (!lookup.has('no')) lookup.set('no', lookup.get('phone number') || '');

      const isMissing = tokenNames.some((name) => {
        const value = lookup.get(name.toLocaleLowerCase('id-ID'));
        return value === undefined || value === '';
      });
      if (isMissing) missingContacts += 1;
    }

    return { tokenNames, missingContacts };
  }, [messageContent, selectionMethod, computedTargets]);

  const insertMessageToken = (token) => {
    const input = messageInputRef.current;
    const selectionStart = input?.selectionStart ?? messageContent.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    setMessageContent((previous) =>
      `${previous.slice(0, selectionStart)}${token}${previous.slice(selectionEnd)}`
    );
    requestAnimationFrame(() => {
      const cursorPosition = selectionStart + token.length;
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  };

  const fetchCampaigns = async () => {
    try {
      const json = await apiRequest('/campaigns');
      if (json.status === 'success') {
        setCampaigns(json.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil daftar kampanye:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      if (json.status === 'success') {
        const connected = json.data.filter(s => s.status === 'CONNECTED');
        setSessions(connected);
      }
    } catch (err) {
      console.error('Gagal mengambil sesi pengirim:', err);
    }
  };

  const fetchContactGroups = async () => {
    try {
      const json = await apiRequest('/contacts/groups');
      if (json.status === 'success') {
        setContactGroups(json.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil grup kontak:', err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const json = await apiRequest('/templates');
      if (json.status === 'success') {
        setTemplates(json.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil template pesan:', err);
    }
  };

  const handleDeleteCampaign = async (campaignId) => {
    triggerConfirm(
      'Hapus Kampanye',
      'Apakah Anda yakin ingin menghapus riwayat kampanye ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/campaigns/${campaignId}`, {
            method: 'DELETE'
          });
          if (json.status === 'success') {
            fetchCampaigns();
            if (window.showSuccess) {
              window.showSuccess('Kampanye berhasil dihapus');
            }
          }
        } catch (err) {
          console.error('Gagal menghapus kampanye:', err);
        }
      }
    );
  };

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const found = templates.find(t => t.id.toString() === templateId.toString());
    if (found) {
      setMessageContent(found.content);
    }
  };

  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    try {
      const json = await apiRequest('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTemplateName,
          content: messageContent
        })
      });
      if (json.status === 'success') {
        setShowSaveTemplateModal(false);
        setNewTemplateName('');
        fetchTemplates();
        setSelectedTemplateId(json.data.id);
        if (window.showSuccess) {
          window.showSuccess('Template berhasil disimpan');
        }
      }
    } catch (err) {
      console.error('Gagal menyimpan template:', err);
    }
  };

  const handleCreateCampaignSubmit = async (e) => {
    e.preventDefault();
    if (selectedSessions.length === 0) {
      alert('Pilih minimal satu sesi pengirim WhatsApp.');
      return;
    }
    if (!messageContent.trim()) {
      alert('Isi pesan tidak boleh kosong.');
      return;
    }
    if (computedTargets.length === 0) {
      alert('Tidak ada target penerima yang valid/terverifikasi.');
      return;
    }

    setLoading(true);

    // Gunakan sesi pertama yang dipilih untuk saat ini
    const primarySessionId = selectedSessions[0];
    const campaignTargets = selectionMethod === 'groups'
      ? computedTargets.map((target) => ({ contact_id: target.contact_id }))
      : computedTargets;

    try {
      const json = await apiRequest('/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: primarySessionId,
          name: campaignName,
          message: messageContent,
          targets: campaignTargets,
          delay_ms_min: delayMin * 1000,
          delay_ms_max: delayMax * 1000,
          attachment_url: attachmentUrl || null,
          attachment_type: attachmentType || null,
          attachment_name: attachmentType === 'Document' ? (attachmentName || null) : null
        })
      });
      if (json.status === 'success' || json.status === 'queued') {
        setShowCreateModal(false);
        resetForm();
        fetchCampaigns();
        if (window.showSuccess) {
          window.showSuccess('Kampanye berhasil dimasukkan ke antrean!');
        }
      } else {
        alert(json.message || 'Gagal membuat kampanye');
      }
    } catch (err) {
      console.error('Gagal meluncurkan kampanye:', err);
      alert('Terjadi kesalahan koneksi server');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCampaignName('');
    setSelectedSessions([]);
    setMessageType('text');
    setSelectedTemplateId('');
    setMessageContent('');
    setSelectionMethod('groups');
    setSelectedGroupsList([]);
    setPastedNumbers('');
    setDelayMin(3);
    setDelayMax(9);
    setAttachmentUrl('');
    setAttachmentType('Image');
    setAttachmentName('');
    setAvailableVariables(STANDARD_CONTACT_VARIABLES);
  };

  const handleSessionToggle = (sessionId) => {
    setSelectedSessions(prev => 
      prev.includes(sessionId)
        ? prev.filter(id => id !== sessionId)
        : [...prev, sessionId]
    );
  };

  const handleGroupToggle = (groupId) => {
    setSelectedGroupsList(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  // --- Calculations for metrics ---
  const totalCampaigns = campaigns.length;
  const runningCampaigns = campaigns.filter(c => c.status === 'RUNNING' || c.status === 'PENDING').length;
  const completedCampaigns = campaigns.filter(c => c.status === 'COMPLETED').length;
  
  let totalMessages = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  campaigns.forEach(c => {
    totalMessages += c.total_targets || 0;
    totalSuccess += c.sent || 0;
    totalFailed += c.failed || 0;
  });

  const successRate = totalMessages > 0 ? Math.round((totalSuccess / totalMessages) * 100) : 100;
  const failedRate = totalMessages > 0 ? Math.round((totalFailed / totalMessages) * 100) : 0;

  // Filtered campaigns
  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = (c.message || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (c.session_id || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (statusFilter === 'All') return matchesSearch;
    return matchesSearch && c.status === statusFilter.toUpperCase();
  });

  const StatMiniCard = ({ title, value, label, color }) => (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '130px', padding: '16px', borderTop: `4px solid ${color}` }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>{value}</div>
      {label && <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '2px' }}>{label}</div>}
    </div>
  );

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* Title Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Bulk Messages</h1>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>V 0.0.1</span>
          </div>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Send messages to multiple contacts at once</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className="btn btn-outline" 
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '8px 14px', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}
          >
            <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} /> {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
          <div className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '8px 14px', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--border-color)', pointerEvents: 'none' }}>
            <Layers size={14} /> Queue ({runningCampaigns})
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            <Plus size={16} /> Create Campaign
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search campaigns..."
            style={{ width: '100%', padding: '10px 12px 10px 40px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none' }}
          />
        </div>
        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '10px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none', minWidth: '160px' }}
        >
          <option value="All">All Campaigns</option>
          <option value="Running">Running</option>
          <option value="Pending">Pending</option>
          <option value="Completed">Completed</option>
        </select>
      </div>

      {/* Statistics horizontal grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <StatMiniCard title="Total Campaigns" value={totalCampaigns} color="var(--primary-color)" />
        <StatMiniCard title="Running" value={runningCampaigns} color="var(--success)" />
        <StatMiniCard title="Scheduled" value={0} color="var(--secondary-color)" />
        <StatMiniCard title="Completed" value={completedCampaigns} color="var(--primary-color)" />
        <StatMiniCard title="Messages" value={totalMessages} color="var(--info)" />
        <StatMiniCard title="Success Rate" value={`${successRate}%`} label={`${totalSuccess} sent`} color="var(--success)" />
        <StatMiniCard title="Failed Rate" value={`${failedRate}%`} label={`${totalFailed} failed`} color="var(--danger)" />
      </div>

      {/* Campaigns list cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '20px' }}>
        {filteredCampaigns.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <Layers size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
            <div>No campaigns found. Click "Create Campaign" to launch one.</div>
          </div>
        ) : (
          filteredCampaigns.map(c => {
            const total = c.total_targets || 0;
            const progressVal = (c.sent || 0) + (c.failed || 0);
            const percentage = total > 0 ? Math.round((progressVal / total) * 100) : 100;
            const isCompleted = c.status === 'COMPLETED';
            const isRunning = c.status === 'RUNNING';
            
            // Clean lowercase status label
            const statusLabel = c.status ? c.status.toLowerCase() : 'pending';
            
            return (
              <div 
                key={c.id} 
                className="card" 
                style={{ 
                  padding: '16px 20px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  justifyContent: 'center',
                  gap: '12px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--border-radius-sm)',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {c.name || `Campaign #${c.id}`}
                    </span>
                    
                    {/* Clean Status Badge */}
                    <span style={{ 
                      padding: '2px 8px', 
                      borderRadius: '12px', 
                      fontSize: '0.7rem', 
                      fontWeight: 600,
                      backgroundColor: isCompleted ? 'rgba(16,185,129,0.08)' : isRunning ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.08)',
                      color: isCompleted ? 'var(--success)' : isRunning ? 'var(--info)' : 'var(--warning)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: isCompleted ? 'var(--success)' : isRunning ? 'var(--info)' : 'var(--warning)' }} />
                      {statusLabel}
                    </span>

                    {/* Target count badge */}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Smartphone size={11} /> {total}
                    </span>
                  </div>

                  {/* Top-Right Action Buttons */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                      onClick={() => {
                        setDrawerCampaignId(c.id);
                      }}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--text-muted)', 
                        cursor: 'pointer', 
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                      }}
                      className="table-row-hover"
                      title="Lihat Log Detail"
                    >
                      <Eye size={15} />
                    </button>
                    <button 
                      onClick={() => handleDeleteCampaign(c.id)}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--text-muted)', 
                        cursor: 'pointer', 
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                      }}
                      className="table-row-hover"
                      title="Hapus Kampanye"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Progress Bar Container */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${percentage}%`, 
                      height: '100%', 
                      backgroundColor: 'var(--primary-color)', 
                      transition: 'width 0.4s ease',
                      borderRadius: '3px'
                    }} />
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', minWidth: '70px', textAlign: 'right' }}>
                    {progressVal}/{total} · {percentage}%
                  </span>
                </div>

                {/* Meta details row (Custom Message · coba-1 · Date/Time · delay range) */}
                <div style={{ 
                  fontSize: '0.75rem', 
                  color: 'var(--text-muted)', 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis',
                  display: 'block'
                }}>
                  <span style={{ color: 'var(--text-light)' }}>
                    {c.message ? (c.message.length > 35 ? c.message.substring(0, 35) + '...' : c.message) : 'Pesan Kosong'}
                  </span>
                  {' · '}
                  <span>{c.session_id}</span>
                  {' · '}
                  <span>{new Date(c.created_at).toLocaleString()}</span>
                  {' · '}
                  <span>3-9s random</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* CREATE CAMPAIGN FULLSCREEN MODAL (Matching exact high fidelity screenshots) */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(6px)'
        }}>
          <div className="card" style={{ width: '920px', maxWidth: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>Create Bulk Campaign</h2>
              <button 
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body (2 Columns layout exactly like the screenshot) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', flex: 1, overflowY: 'auto' }}>
              
              {/* Left Column: Campaign Settings */}
              <div style={{ padding: '24px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>Campaign Settings</h3>

                {/* Campaign Name */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Campaign Name</label>
                  <input 
                    type="text" 
                    className="form-control"
                    placeholder="e.g., Product Launch Announcement"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </div>

                {/* WhatsApp Sessions selection */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>WhatsApp Sessions * <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>(select for rotation)</span></label>
                    <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>{selectedSessions.length} / {sessions.length} active</span>
                  </div>
                  
                  {/* Active sessions checklist container */}
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', padding: '10px', maxHeight: '120px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.01)' }}>
                    {sessions.length === 0 ? (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>
                        Tidak ada sesi aktif. Hubungkan sesi di Session Manager.
                      </div>
                    ) : (
                      sessions.map(s => (
                        <label key={s.session_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', transition: 'background 0.2s' }} className="table-row-hover">
                          <input 
                            type="checkbox"
                            checked={selectedSessions.includes(s.session_id)}
                            onChange={() => handleSessionToggle(s.session_id)}
                          />
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>{s.session_id} (+{s.phone_number})</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* Message Type Selector Card Tabs */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Message Type</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div 
                      onClick={() => setMessageType('text')}
                      style={{ 
                        border: messageType === 'text' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                        borderRadius: 'var(--border-radius)', padding: '12px', textAlign: 'center', cursor: 'pointer',
                        backgroundColor: messageType === 'text' ? 'rgba(99,102,241,0.03)' : 'transparent',
                        transition: 'all 0.2s'
                      }}
                    >
                      <MessageSquare size={20} style={{ color: messageType === 'text' ? 'var(--primary-color)' : 'var(--text-muted)', marginBottom: '4px' }} />
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Text Message</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Text with optional attachment</div>
                    </div>
                    <div 
                      onClick={() => {
                        if (templates.length === 0) {
                          alert('Anda belum membuat template. Silakan buat template terlebih dahulu.');
                          return;
                        }
                        setMessageType('template');
                      }}
                      style={{ 
                        border: messageType === 'template' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                        borderRadius: 'var(--border-radius)', padding: '12px', textAlign: 'center', cursor: 'pointer',
                        backgroundColor: messageType === 'template' ? 'rgba(99,102,241,0.03)' : 'transparent',
                        transition: 'all 0.2s',
                        opacity: templates.length === 0 ? 0.5 : 1
                      }}
                    >
                      <FileText size={20} style={{ color: messageType === 'template' ? 'var(--primary-color)' : 'var(--text-muted)', marginBottom: '4px' }} />
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Template Message</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Use saved templates</div>
                    </div>
                  </div>
                </div>

                {/* Message Content with spintax/helper buttons */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Message Content *</label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        type="button" 
                        onClick={() => insertMessageToken('{Hi|Hello|Good Morning}')}
                        style={{ padding: '2px 8px', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}
                      >
                        Spintax
                      </button>
                      <button 
                        type="button" 
                        onClick={() => insertMessageToken('{{random}}')}
                        style={{ padding: '2px 8px', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}
                      >
                        Random
                      </button>
                      <button 
                        type="button" 
                        onClick={() => insertMessageToken('\n')}
                        style={{ padding: '2px 8px', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}
                      >
                        Line Break
                      </button>
                    </div>
                  </div>

                  {messageType === 'template' && (
                    <select
                      className="form-control"
                      value={selectedTemplateId}
                      onChange={(e) => handleTemplateSelect(e.target.value)}
                      style={{ marginBottom: '10px' }}
                    >
                      <option value="">-- Select Message Template --</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}

                  <textarea 
                    ref={messageInputRef}
                    className="form-control"
                    placeholder="Enter your message here..."
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    style={{ minHeight: '100px', fontSize: '0.85rem' }}
                  />

                  {/* Template quick save indicator */}
                  {messageType === 'text' && messageContent.trim() !== '' && (
                    <button 
                      type="button"
                      onClick={() => setShowSaveTemplateModal(true)}
                      style={{ display: 'inline-flex', alignSelf: 'flex-end', marginTop: '6px', fontSize: '0.75rem', color: 'var(--primary-color)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                    >
                      Simpan sebagai Template Baru
                    </button>
                  )}

                  {/* Advanced Features Informative Box */}
                  <div style={{ marginTop: '10px', padding: '12px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)', fontSize: '0.75rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--info)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Layers size={12} /> Advanced Features & Contact Variables
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Klik header untuk menambahkan keyword. Variable baru dari Excel/CSV muncul otomatis setelah grup dipilih.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {availableVariables.map((variableName) => (
                        <button
                          key={variableName.toLocaleLowerCase('id-ID')}
                          type="button"
                          onClick={() => insertMessageToken(`{{${variableName}}}`)}
                          style={{
                            padding: '5px 9px', borderRadius: '999px', cursor: 'pointer',
                            border: '1px solid rgba(59,130,246,0.25)', color: 'var(--primary-color)',
                            backgroundColor: 'rgba(59,130,246,0.08)', fontSize: '0.72rem', fontWeight: 600
                          }}
                        >
                          {variableName}
                        </button>
                      ))}
                    </div>
                    {selectionMethod === 'groups' && selectedGroupsList.length === 0 && (
                      <div style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
                        Pilih grup kontak untuk memuat header variable khusus.
                      </div>
                    )}
                    {variableValidation.missingContacts > 0 && (
                      <div style={{ marginTop: '9px', padding: '8px 10px', borderRadius: '6px', backgroundColor: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                        {variableValidation.missingContacts} kontak memiliki nilai kosong atau tidak tersedia untuk keyword yang dipakai.
                      </div>
                    )}
                    <div style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
                      Spintax: <code>{"{Hi|Hello|Good Morning}"}</code>
                    </div>
                  </div>
                </div>

                {/* Attachment settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.01)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.825rem', color: 'var(--text-main)' }}>Attachment Settings (Optional)</div>
                  
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Attachment URL</label>
                    <input 
                      type="text" 
                      className="form-control"
                      placeholder="Enter direct URL or upload media file"
                      value={attachmentUrl}
                      onChange={(e) => setAttachmentUrl(e.target.value)}
                    />
                    {(attachmentType === 'Image' || attachmentType === 'Video' || attachmentType === 'Audio' || attachmentType === 'Document') && (
                      <MediaUploadField
                        mediaType={attachmentType}
                        onUploaded={(media) => {
                          setAttachmentUrl(media.url);
                          if (attachmentType === 'Document' && media.file_name && !attachmentName) {
                            setAttachmentName(media.file_name);
                          }
                        }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Attachment Type</label>
                      <select 
                        className="form-control"
                        value={attachmentType}
                        onChange={(e) => setAttachmentType(e.target.value)}
                      >
                        <option value="Image">Image</option>
                        <option value="Document">Document</option>
                        <option value="Video">Video</option>
                        <option value="Audio">Audio</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Filename (For Document)</label>
                      <input 
                        type="text" 
                        className="form-control"
                        placeholder="e.g. Catalog.pdf"
                        value={attachmentName}
                        disabled={attachmentType !== 'Document'}
                        onChange={(e) => setAttachmentName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Schedule, delay parameters */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Schedule Type</label>
                    <select className="form-control">
                      <option>Send Immediately</option>
                      <option>Schedule for Later</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Delay Range (seconds)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input 
                        type="number" 
                        className="form-control" 
                        value={delayMin} 
                        onChange={(e) => setDelayMin(parseInt(e.target.value) || 2)} 
                        style={{ textAlign: 'center' }} 
                      />
                      <span style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}>to</span>
                      <input 
                        type="number" 
                        className="form-control" 
                        value={delayMax} 
                        onChange={(e) => setDelayMax(parseInt(e.target.value) || delayMin + 1)} 
                        style={{ textAlign: 'center' }} 
                      />
                    </div>
                  </div>
                </div>

                {/* Max retries parameter */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Max Retries for Failed Messages</label>
                  <input 
                    type="number" 
                    className="form-control"
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
                  />
                </div>
              </div>

              {/* Right Column: Contact Selection */}
              <div style={{ padding: '24px', backgroundColor: 'rgba(0,0,0,0.01)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>Contact Selection</h3>

                {/* Selection Method (Radio list exactly like the screenshot) */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Selection Method</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>
                      <input 
                        type="radio" 
                        name="selMethod" 
                        checked={selectionMethod === 'groups'}
                        onChange={() => setSelectionMethod('groups')}
                      />
                      Contact Groups (Recommended)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>
                      <input 
                        type="radio" 
                        name="selMethod" 
                        checked={selectionMethod === 'paste'}
                        onChange={() => setSelectionMethod('paste')}
                      />
                      Paste Phone Numbers
                    </label>
                  </div>
                </div>

                {/* Dynamic Content based on selection method */}
                {selectionMethod === 'groups' ? (
                  <div className="form-group" style={{ marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label className="form-label">Select Contact Groups</label>
                    <div style={{ 
                      border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', 
                      padding: '12px', backgroundColor: 'var(--bg-card)', flex: 1, maxHeight: '280px', overflowY: 'auto',
                      display: 'flex', flexDirection: 'column', gap: '6px'
                    }}>
                      {contactGroups.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                          Belum ada grup kontak. Buat grup di menu Contacts.
                        </div>
                      ) : (
                        contactGroups.map(g => (
                          <label key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer' }} className="table-row-hover">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input 
                                type="checkbox"
                                checked={selectedGroupsList.includes(g.id.toString())}
                                onChange={() => handleGroupToggle(g.id.toString())}
                              />
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: g.color || 'var(--primary-color)' }} />
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>{g.name}</span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {g.verified_contacts || 0} verified / {g.total_contacts || 0} total
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="form-group" style={{ marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label className="form-label">Paste Phone Numbers (one per line)</label>
                    <textarea 
                      className="form-control"
                      placeholder="Contoh:&#13;+6281234567890&#13;082298343466"
                      value={pastedNumbers}
                      onChange={(e) => setPastedNumbers(e.target.value)}
                      style={{ flex: 1, minHeight: '200px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>
                )}

                {/* Target verification card (Blue capsule alert at the bottom) */}
                <div style={{ padding: '14px 18px', borderRadius: '12px', backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', color: 'var(--primary-color)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle size={16} /> <span>{computedTargets.length} verified contacts</span> will receive this message
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-main)' }}>
              <button 
                type="button" 
                onClick={() => setShowCreateModal(false)}
                className="btn btn-outline"
                style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleCreateCampaignSubmit}
                className="btn btn-primary"
                style={{ padding: '10px 24px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                disabled={loading}
              >
                <Send size={16} /> Create & Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAVE TEMPLATE MODAL */}
      {showSaveTemplateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1100, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '400px', padding: '24px', position: 'relative', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '16px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Simpan Template Baru</h3>
            <form onSubmit={handleSaveTemplate}>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Nama Template</label>
                <input
                  type="text"
                  placeholder="Contoh: Template Promo Hari Ini"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" onClick={() => setShowSaveTemplateModal(false)} className="btn btn-outline" style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)' }}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}>
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NON-BLOCKING SLIDE-OVER DETAIL PROGRESS DRAWER */}
      {drawerCampaignId && drawerProgress && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '420px',
          height: '100vh',
          backgroundColor: 'var(--bg-card)', // Match main UI light theme background
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-10px 0 40px rgba(0,0,0,0.08)',
          zIndex: 1050,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
          backdropFilter: 'blur(16px)',
          animation: 'slideInRight 0.25s ease-out forwards',
          color: 'var(--text-main)'
        }}>
          {/* Drawer Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Progress Detail</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Real-time Delivery Log</span>
            </div>
            <button 
              onClick={() => {
                setDrawerCampaignId(null);
                setDrawerProgress(null);
              }}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--text-muted)', 
                cursor: 'pointer', 
                display: 'flex', 
                padding: '4px',
                borderRadius: '50%',
                transition: 'background 0.2s'
              }}
              className="table-row-hover"
            >
              <X size={20} />
            </button>
          </div>

          {/* Metadata Sleek Box */}
          <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Nama Kampanye:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{drawerProgress.name || `Campaign #${drawerProgress.campaign_id}`}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Sesi Pengirim:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{drawerProgress.session_id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status Kampanye:</span>
              <span style={{ 
                padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700,
                backgroundColor: drawerProgress.campaign_status === 'COMPLETED' ? 'rgba(16,185,129,0.1)' : drawerProgress.campaign_status === 'RUNNING' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)',
                color: drawerProgress.campaign_status === 'COMPLETED' ? 'var(--success)' : drawerProgress.campaign_status === 'RUNNING' ? 'var(--info)' : 'var(--warning)',
                textTransform: 'lowercase'
              }}>
                {drawerProgress.campaign_status ? drawerProgress.campaign_status.toLowerCase() : 'pending'}
              </span>
            </div>
          </div>

          {/* Metrics horizontal row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ padding: '10px', backgroundColor: 'rgba(16,185,129,0.04)', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.12)' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>{drawerProgress.metrics.sent}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Terkirim</div>
            </div>
            <div style={{ padding: '10px', backgroundColor: 'rgba(239,68,68,0.04)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.12)' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)' }}>{drawerProgress.metrics.failed}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Gagal</div>
            </div>
            <div style={{ padding: '10px', backgroundColor: 'rgba(59,130,246,0.04)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.12)' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--info)' }}>{drawerProgress.metrics.pending}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Antrean</div>
            </div>
          </div>

          {/* Progress bar percentage indicator */}
          {(() => {
            const total = drawerProgress.metrics.sent + drawerProgress.metrics.failed + drawerProgress.metrics.pending;
            const progressVal = drawerProgress.metrics.sent + drawerProgress.metrics.failed;
            const percentage = total > 0 ? Math.round((progressVal / total) * 100) : 0;
            return (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  <span>Progress Bar</span>
                  <span>{percentage}%</span>
                </div>
                <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: 'var(--primary-color)', transition: 'width 0.3s ease' }} />
                </div>
              </div>
            );
          })()}

          {/* Dynamic Scrollable logs */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Logs</h4>
            <div style={{ 
              flex: 1, 
              overflowY: 'auto', 
              border: '1px solid var(--border-color)', 
              borderRadius: '8px', 
              backgroundColor: 'var(--bg-main)',
              padding: '12px'
            }}>
              {(!drawerProgress.logs || drawerProgress.logs.length === 0) ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  Belum ada log pengiriman.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {drawerProgress.logs.map((log) => {
                    const isLogSent = log.status === 'SENT';
                    const isLogFailed = log.status === 'FAILED';
                    return (
                      <div 
                        key={log.id} 
                        style={{ 
                          padding: '8px 10px', 
                          borderRadius: '6px', 
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', fontFamily: 'monospace' }}>
                            {log.target_number}
                          </span>
                          <span style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: 700, 
                            padding: '1px 6px', 
                            borderRadius: '4px',
                            backgroundColor: isLogSent ? 'rgba(16,185,129,0.1)' : isLogFailed ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)',
                            color: isLogSent ? 'var(--success)' : isLogFailed ? 'var(--danger)' : 'var(--text-muted)'
                          }}>
                            {log.status}
                          </span>
                        </div>
                        {isLogFailed && log.error_message && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--danger)', fontStyle: 'italic' }}>
                            {log.error_message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <button 
            onClick={() => {
              setDrawerCampaignId(null);
              setDrawerProgress(null);
            }}
            className="btn btn-outline"
            style={{ width: '100%', marginTop: '20px', padding: '10px 16px', borderRadius: 'var(--border-radius-sm)' }}
          >
            Tutup Monitor
          </button>
        </div>
      )}

      {/* Confirm Dialog Modal */}
      {confirmDialog.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="modal-content" style={{
            maxWidth: '440px',
            width: '90%',
            borderRadius: '16px',
            padding: '24px',
            backgroundColor: 'var(--card-bg, #ffffff)',
            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
            border: '1px solid var(--border-color)',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div className="modal-header" style={{
              marginBottom: '16px',
              borderBottom: 'none',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>
                {confirmDialog.title}
              </h2>
            </div>
            <div className="modal-body" style={{ marginBottom: '24px', padding: 0 }}>
              <p style={{ color: 'var(--text-color-muted, #6b7280)', fontSize: '0.95rem', lineHeight: '1.5', margin: 0 }}>
                {confirmDialog.message}
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: 'none', padding: 0 }}>
              <button
                className="btn btn-outline"
                onClick={() => setConfirmDialog({ show: false, title: '', message: '', confirmLabel: '', confirmBtnClass: '', onConfirm: null })}
                style={{ padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
              >
                Batal
              </button>
              <button
                className={`btn ${confirmDialog.confirmBtnClass === 'btn-danger' ? '' : 'btn-primary'}`}
                onClick={() => {
                  if (confirmDialog.onConfirm) confirmDialog.onConfirm();
                  setConfirmDialog({ show: false, title: '', message: '', confirmLabel: '', confirmBtnClass: '', onConfirm: null });
                }}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  backgroundColor: confirmDialog.confirmBtnClass === 'btn-danger' ? '#ef4444' : 'var(--primary-color, #3b82f6)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkCampaign;
