import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  UserPlus, 
  Clipboard, 
  FileSpreadsheet, 
  ShieldCheck, 
  Download, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  XCircle,
  X,
  Search,
  RefreshCw,
  Users
} from 'lucide-react';
import { apiRequest } from '../apiClient';

const GroupDetail = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [groupInfo, setGroupInfo] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);

  // Filters state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');

  // Modals state
  const [showManualModal, setShowManualModal] = useState(false);
  const [showCopyPasteModal, setShowCopyPasteModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState('update');

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

  // Manual contact form state
  const [contactName, setContactName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [vars, setVars] = useState({
    var1: '', var2: '', var3: '', var4: '', var5: '',
    var6: '', var7: '', var8: '', var9: '', var10: ''
  });

  // Copy paste form state
  const [rawNumbers, setRawNumbers] = useState('');

  useEffect(() => {
    fetchGroupInfo();
    fetchActiveSessions();
  }, [groupId]);

  useEffect(() => {
    fetchContacts();
  }, [groupId, search, statusFilter]);

  const fetchGroupInfo = async () => {
    try {
      const json = await apiRequest('/contacts/groups');
      if (json.status === 'success') {
        const found = (json.data || []).find(g => g.id.toString() === groupId.toString());
        if (found) {
          setGroupInfo(found);
        }
      }
    } catch (err) {
      console.error('Error fetching group metadata:', err);
    }
  };

  const fetchActiveSessions = async () => {
    try {
      const json = await apiRequest('/sessions');
      if (json.status === 'success') {
        const connected = (json.data || []).filter(s => s.status === 'CONNECTED');
        setActiveSessions(connected);
        if (connected.length > 0) {
          setSelectedSessionId(connected[0].session_id);
        }
      }
    } catch (err) {
      console.error('Error fetching active sessions:', err);
    }
  };

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        groupId,
        search,
        status: statusFilter
      });
      const json = await apiRequest(`/contacts?${queryParams.toString()}`);
      if (json.status === 'success') {
        setContacts(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  // Add Manual Contact
  const handleAddManual = async (e) => {
    e.preventDefault();
    if (!phoneNumber) return;

    try {
      const payload = {
        group_id: groupId,
        name: contactName,
        phone_number: phoneNumber,
        email,
        company,
        position,
        tags,
        notes,
        ...vars
      };

      const json = await apiRequest('/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (json.status === 'success') {
        setShowManualModal(false);
        resetManualForm();
        fetchContacts();
        fetchGroupInfo();
      } else {
        alert(json.message || 'Gagal menambahkan kontak');
      }
    } catch (err) {
      console.error('Error adding contact:', err);
      alert('Koneksi server gagal');
    }
  };

  // Add Copy/Paste Numbers
  const handleAddCopyPaste = async (e) => {
    e.preventDefault();
    if (!rawNumbers.trim()) return;

    const numbers = rawNumbers
      .split('\n')
      .map(n => n.trim())
      .filter(n => n !== '');

    if (numbers.length === 0) return;

    const parsedContacts = numbers.map(line => {
      const parts = line.split(/[;,]/);
      if (parts.length >= 2) {
        let first = parts[0].trim();
        let second = parts[1].trim();
        
        // Auto-detect which is phone and which is name
        const firstHasDigits = /\d/.test(first) && first.replace(/\D/g, '').length >= 5;
        const secondHasDigits = /\d/.test(second) && second.replace(/\D/g, '').length >= 5;
        
        if (firstHasDigits && !secondHasDigits) {
          let cleanPhone = first.replace(/\D/g, '');
          return {
            name: second || `Contact-${cleanPhone}`,
            phone_number: cleanPhone || first
          };
        } else {
          let cleanPhone = second.replace(/\D/g, '');
          return {
            name: first || `Contact-${cleanPhone}`,
            phone_number: cleanPhone || second
          };
        }
      } else {
        const singleVal = parts[0].trim();
        const hasDigits = /\d/.test(singleVal) && singleVal.replace(/\D/g, '').length >= 5;
        if (hasDigits) {
          let cleanPhone = singleVal.replace(/\D/g, '');
          return {
            name: `Contact-${cleanPhone}`,
            phone_number: cleanPhone || singleVal
          };
        } else {
          return {
            name: singleVal,
            phone_number: ''
          };
        }
      }
    }).filter(c => c.phone_number !== '');

    try {
      const json = await apiRequest('/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, contacts: parsedContacts })
      });
      if (json.status === 'success') {
        setShowCopyPasteModal(false);
        setRawNumbers('');
        fetchContacts();
        fetchGroupInfo();
      } else {
        alert(json.message || 'Gagal menyimpan kontak');
      }
    } catch (err) {
      console.error('Error bulk import:', err);
      alert('Koneksi server gagal');
    }
  };

  // Excel/CSV import: parsing and validation are handled by the backend.
  const handleContactFileSelected = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('group_id', groupId);
      const json = await apiRequest('/contacts/import/preview', {
        method: 'POST',
        body: formData
      });
      setImportFile(file);
      setImportPreview(json.data);
      setDuplicateMode('update');
      setShowImportModal(true);
    } catch (err) {
      console.error('Error previewing contact import:', err);
      alert(err.message || 'Gagal membaca file Excel/CSV.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleConfirmContactImport = async () => {
    if (!importFile || !importPreview || importPreview.counts.valid_rows === 0) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('group_id', groupId);
      formData.append('duplicate_mode', duplicateMode);
      const json = await apiRequest('/contacts/import', {
        method: 'POST',
        body: formData
      });
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview(null);
      await Promise.all([fetchContacts(), fetchGroupInfo()]);
      if (window.showSuccess) window.showSuccess(json.message);
      else alert(json.message);
    } catch (err) {
      console.error('Error importing contacts:', err);
      alert(err.message || 'Gagal mengimpor kontak.');
    } finally {
      setImportLoading(false);
    }
  };

  // WhatsApp Verification
  const handleVerifyContacts = async () => {
    if (!selectedSessionId) {
      alert('Silakan hubungkan minimal satu perangkat WhatsApp aktif terlebih dahulu.');
      return;
    }

    try {
      setIsVerifying(true);
      setShowVerifyModal(false);
      const json = await apiRequest(`/contacts/groups/${groupId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: selectedSessionId })
      });
      alert(json.message || 'Verifikasi selesai');
      fetchContacts();
      fetchGroupInfo();
    } catch (err) {
      console.error('Error verification:', err);
      alert('Koneksi server gagal');
    } finally {
      setIsVerifying(false);
    }
  };

  // CSV Exporter
  const handleExportContacts = () => {
    if (contacts.length === 0) return;
    const customHeadersByKey = new Map();
    for (const contact of contacts) {
      for (const header of Object.keys(contact.custom_fields || {})) {
        const key = header.trim().toLocaleLowerCase('id-ID');
        if (key && !customHeadersByKey.has(key)) customHeadersByKey.set(key, header.trim());
      }
    }
    const customHeaders = [...customHeadersByKey.values()];
    const headers = ['Name', 'Phone', 'Email', 'Company', 'Position', 'Notes', 'Tags', ...customHeaders];
    const escapeCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = contacts.map(c => [
      c.name,
      c.phone_number,
      c.email,
      c.company,
      c.position,
      c.notes,
      c.tags,
      ...customHeaders.map((header) => c.custom_fields?.[header] || '')
    ]);
    const csvContent = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => row.map(escapeCsvCell).join(','))
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", objectUrl);
    link.setAttribute("download", `${groupInfo?.name || 'contacts'}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  // Delete Invalid Contacts
  const handleDeleteInvalid = async () => {
    triggerConfirm(
      'Hapus Nomor Tidak Valid',
      'Apakah Anda ingin menghapus semua nomor yang tidak valid (INVALID) dari grup ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/contacts/groups/${groupId}/invalid`, {
            method: 'DELETE'
          });
          if (json.status === 'success') {
            fetchContacts();
            fetchGroupInfo();
          }
        } catch (err) {
          console.error('Error delete invalid:', err);
        }
      }
    );
  };

  const handleDeleteContact = async (contactId) => {
    triggerConfirm(
      'Hapus Kontak',
      'Apakah Anda yakin ingin menghapus kontak ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/contacts/${contactId}`, { method: 'DELETE' });
          if (json.status === 'success') {
            fetchContacts();
            fetchGroupInfo();
          }
        } catch (err) {
          console.error('Error delete single contact:', err);
        }
      }
    );
  };

  const resetManualForm = () => {
    setContactName('');
    setPhoneNumber('');
    setEmail('');
    setCompany('');
    setPosition('');
    setTags('');
    setNotes('');
    setVars({
      var1: '', var2: '', var3: '', var4: '', var5: '',
      var6: '', var7: '', var8: '', var9: '', var10: ''
    });
  };

  const getImportPreviewValue = (contact, header) => {
    if (header.type === 'custom') return contact.custom_fields?.[header.name] || '';
    return contact[header.field] || '';
  };

  // Calculate dynamic stats
  const total = contacts.length;
  const verified = contacts.filter(c => c.status === 'VERIFIED').length;
  const unverified = contacts.filter(c => c.status === 'UNVERIFIED').length;
  const invalid = contacts.filter(c => c.status === 'INVALID').length;

  const StatMiniCard = ({ title, value, icon, color }) => (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: '180px', padding: '16px' }}>
      <div style={{ 
        width: '40px', height: '40px', borderRadius: '10px', 
        backgroundColor: `${color}15`, color: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center' 
      }}>
        {icon}
      </div>
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>{value}</div>
      </div>
    </div>
  );

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* Header & Back Link */}
      <div style={{ marginBottom: '24px' }}>
        <button 
          onClick={() => navigate('/contacts')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', padding: 0, marginBottom: '12px' }}
        >
          <ArrowLeft size={16} /> Back to Groups
        </button>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>{groupInfo?.name || 'Grup Kontak'}</h1>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0' }}>{groupInfo?.description || 'Manage contacts in this group'}</p>
          </div>
        </div>
      </div>

      {/* Action Buttons Row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
        <button onClick={() => setShowManualModal(true)} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer' }}>
          <UserPlus size={16} /> Manual Add
        </button>
        <button onClick={() => setShowCopyPasteModal(true)} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer' }}>
          <Clipboard size={16} /> Copy/Paste
        </button>
        <label className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer', margin: 0 }}>
          <FileSpreadsheet size={16} /> {importLoading ? 'Reading File...' : 'Excel/CSV Import'}
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={handleContactFileSelected}
            disabled={importLoading}
            style={{ display: 'none' }}
          />
        </label>
        <button 
          onClick={() => {
            if (activeSessions.length === 0) {
              alert('Belum ada perangkat yang aktif. Harap hubungkan sesi WhatsApp di Session Manager terlebih dahulu.');
            } else {
              setShowVerifyModal(true);
            }
          }} 
          className="btn btn-secondary" 
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer' }}
        >
          <ShieldCheck size={16} /> Verify WhatsApp
        </button>
        <button onClick={handleExportContacts} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer' }}>
          <Download size={16} /> Export Contacts
        </button>
        <button 
          onClick={handleDeleteInvalid} 
          className="btn btn-secondary" 
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: 'var(--border-radius)', cursor: 'pointer', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
        >
          <Trash2 size={16} /> Delete Invalid
        </button>
      </div>

      {/* Stats Mini Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '24px' }}>
        <StatMiniCard title="Total Contacts" value={total} icon={<Users size={20} />} color="var(--primary-color)" />
        <StatMiniCard title="Verified" value={verified} icon={<CheckCircle size={20} />} color="var(--success)" />
        <StatMiniCard title="Unverified" value={unverified} icon={<AlertCircle size={20} />} color="var(--warning)" />
        <StatMiniCard title="Invalid" value={invalid} icon={<XCircle size={20} />} color="#ef4444" />
      </div>

      {/* Contacts List Card */}
      <div className="card" style={{ padding: '24px' }}>
        {/* Filters bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
            <input 
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              style={{ width: '100%', padding: '10px 12px 10px 40px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }}
            />
          </div>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '10px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', outline: 'none', minWidth: '150px' }}
          >
            <option value="All Status" style={{ backgroundColor: 'var(--bg-card)' }}>All Status</option>
            <option value="Verified" style={{ backgroundColor: 'var(--bg-card)' }}>Verified</option>
            <option value="Unverified" style={{ backgroundColor: 'var(--bg-card)' }}>Unverified</option>
            <option value="Invalid" style={{ backgroundColor: 'var(--bg-card)' }}>Invalid</option>
          </select>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><RefreshCw className="animate-spin" /></div>
        ) : contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <Users size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
            <div>No contacts found in this group.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Phone Number</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Email / Company</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Tags</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr 
                    key={contact.id} 
                    style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={{ padding: '16px', fontWeight: 600, color: 'var(--text-main)' }}>{contact.name}</td>
                    <td style={{ padding: '16px', fontFamily: 'monospace' }}>{contact.phone_number}</td>
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>{contact.email || '-'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {contact.company ? `${contact.company} (${contact.position || '-'})` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(contact.tags || '').split(',').filter(t => t.trim() !== '').map((tag, idx) => (
                          <span key={idx} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', backgroundColor: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      {contact.status === 'VERIFIED' ? (
                        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500, backgroundColor: '#d1fae5', color: '#059669', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle size={12} /> VERIFIED
                        </span>
                      ) : contact.status === 'INVALID' ? (
                        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500, backgroundColor: '#fee2e2', color: '#b91c1c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <XCircle size={12} /> INVALID
                        </span>
                      ) : (
                        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500, backgroundColor: '#f3f4f6', color: '#4b5563', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={12} /> UNVERIFIED
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <button 
                        onClick={() => handleDeleteContact(contact.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EXCEL/CSV IMPORT PREVIEW MODAL */}
      {showImportModal && importPreview && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.62)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1200, backdropFilter: 'blur(5px)', padding: '20px'
        }}>
          <div className="card" style={{ width: 'min(1050px, 96vw)', maxHeight: '92vh', overflowY: 'auto', padding: '24px', position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                setShowImportModal(false);
                setImportFile(null);
                setImportPreview(null);
              }}
              style={{ position: 'absolute', top: '18px', right: '18px', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={22} />
            </button>

            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.25rem' }}>Preview Import Kontak</h3>
            <p style={{ color: 'var(--text-muted)', margin: '6px 0 18px' }}>
              {importFile?.name} · sumber {importPreview.source_sheet}. File Excel hanya membaca worksheet Sheet1.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: '10px', marginBottom: '18px' }}>
              {[
                ['Total Rows', importPreview.counts.total_rows, 'var(--primary-color)'],
                ['Valid', importPreview.counts.valid_rows, 'var(--success)'],
                ['Invalid', importPreview.counts.invalid_rows, '#ef4444'],
                ['Duplicate', importPreview.counts.duplicate_rows, 'var(--warning)']
              ].map(([label, value, color]) => (
                <div key={label} style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '7px' }}>Header terdeteksi</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {importPreview.headers.map((header) => (
                  <span key={header.name} style={{
                    padding: '5px 9px', borderRadius: '999px', fontSize: '0.72rem',
                    backgroundColor: header.type === 'custom' ? 'rgba(139,92,246,0.12)' : 'rgba(59,130,246,0.12)',
                    color: header.type === 'custom' ? '#a78bfa' : '#60a5fa',
                    border: `1px solid ${header.type === 'custom' ? 'rgba(139,92,246,0.25)' : 'rgba(59,130,246,0.25)'}`
                  }}>
                    {header.name} · {header.type === 'custom' ? 'variable baru' : 'field standar'}
                  </span>
                ))}
              </div>
            </div>

            {importPreview.counts.formula_cells_ignored > 0 && (
              <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '8px', color: '#b45309', backgroundColor: '#fef3c7', fontSize: '0.8rem' }}>
                {importPreview.counts.formula_cells_ignored} sel formula tidak dieksekusi; sistem hanya memakai nilai hasil yang tersimpan di file.
              </div>
            )}

            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '18px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '9px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Row</th>
                    {importPreview.headers.map((header) => (
                      <th key={header.name} style={{ padding: '9px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{header.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.preview.length === 0 ? (
                    <tr>
                      <td colSpan={importPreview.headers.length + 1} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Sheet1 baru berisi header dan belum memiliki baris kontak.
                      </td>
                    </tr>
                  ) : importPreview.preview.map((contact) => (
                    <tr key={`${contact.source_row}-${contact.phone_number}`} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '9px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{contact.source_row}</td>
                      {importPreview.headers.map((header) => (
                        <td key={header.name} style={{ padding: '9px', color: 'var(--text-main)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                          {getImportPreviewValue(contact, header) || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Jika nomor sudah ada:
                <select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value)} className="form-control" style={{ width: 'auto' }}>
                  <option value="update">Perbarui nama dan variabel</option>
                  <option value="skip">Lewati kontak lama</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Batal</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmContactImport}
                  disabled={importLoading || importPreview.counts.valid_rows === 0}
                  style={{ opacity: importLoading || importPreview.counts.valid_rows === 0 ? 0.55 : 1 }}
                >
                  {importLoading ? 'Mengimpor...' : `Import ${importPreview.counts.valid_rows} Kontak`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL CONTACT MODAL */}
      {showManualModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '600px', padding: '24px', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <button 
              onClick={() => setShowManualModal(false)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Add Contact to {groupInfo?.name}</h3>
            
            <form onSubmit={handleAddManual}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Name (Optional)</label>
                  <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Phone Number *</label>
                  <input type="text" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} required placeholder="e.g. +628123456789" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. john@example.com" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Company</label>
                  <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Inc." style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Position</label>
                  <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Job position" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Tags</label>
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. vip, customer (comma separated)" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes" rows="2" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', resize: 'vertical' }} />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '12px', color: 'var(--primary-color)' }}>Custom Variables</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                  {Object.keys(vars).map((varKey, idx) => (
                    <div key={varKey}>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', textTransform: 'capitalize' }}>{`Var ${idx + 1}`}</label>
                      <input 
                        type="text" 
                        value={vars[varKey]} 
                        onChange={(e) => setVars({ ...vars, [varKey]: e.target.value })}
                        placeholder={`Value ${idx + 1}`}
                        style={{ width: '100%', padding: '8px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)' }} 
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setShowManualModal(false)} className="btn btn-secondary" style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}>
                  Add Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COPY PASTE NUMBERS MODAL */}
      {showCopyPasteModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '480px', padding: '24px', position: 'relative' }}>
            <button 
              onClick={() => setShowCopyPasteModal(false)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Add Numbers to {groupInfo?.name}</h3>
            
            <form onSubmit={handleAddCopyPaste}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px' }}>Phone Numbers (one per line)</label>
                <textarea 
                  value={rawNumbers} 
                  onChange={(e) => setRawNumbers(e.target.value)}
                  placeholder="Enter phone numbers, one per line:&#10;+1234567890&#10;+0987654321" 
                  rows="8" 
                  required
                  style={{ width: '100%', padding: '12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', resize: 'vertical', fontFamily: 'monospace' }} 
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setShowCopyPasteModal(false)} className="btn btn-secondary" style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer' }}>
                  Add to Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VERIFY WHATSAPP CHOOSE DEVICE MODAL */}
      {showVerifyModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '400px', padding: '24px', position: 'relative' }}>
            <button 
              onClick={() => setShowVerifyModal(false)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', color: 'var(--text-main)' }}>Verify WhatsApp Numbers</h3>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px' }}>Select Active Device</label>
              <select 
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'transparent', color: 'var(--text-main)', outline: 'none' }}
              >
                {activeSessions.map((session) => (
                  <option key={session.session_id} value={session.session_id} style={{ backgroundColor: 'var(--bg-card)' }}>
                    {`${session.session_id} (${session.phone_number || 'no number'})`}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setShowVerifyModal(false)} className="btn btn-secondary" style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)' }}>
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleVerifyContacts} 
                className="btn btn-primary" 
                style={{ padding: '10px 20px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <ShieldCheck size={16} /> Verify Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN VERIFY LOADING SPINNER */}
      {isVerifying && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          zIndex: 2000, backdropFilter: 'blur(6px)', color: 'white'
        }}>
          <RefreshCw className="animate-spin" size={48} style={{ color: 'var(--primary-color)', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Memverifikasi Nomor WhatsApp...</h3>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', marginTop: '8px' }}>
            Harap tunggu. Sistem sedang menguji keaktifan nomor satu per satu secara asinkron.
          </p>
        </div>
      )}
      {/* CONFIRMATION DIALOG MODAL */}
      {confirmDialog.show && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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

export default GroupDetail;
