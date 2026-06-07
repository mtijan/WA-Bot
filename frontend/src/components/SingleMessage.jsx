import { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Smartphone, 
  Users, 
  RefreshCw, 
  Search, 
  MessageSquare
} from 'lucide-react';
import { apiRequest } from '../apiClient';
import MediaUploadField from './MediaUploadField';

const SingleMessage = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  
  // Recipient Select State
  const [recipientsType, setRecipientsType] = useState('contacts'); // 'contacts' or 'groups'
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Contacts Sub-options
  const [contactsSubOption, setContactsSubOption] = useState('custom'); // 'custom' or 'group'
  const [customNumbers, setCustomNumbers] = useState('');
  const [contactGroups, setContactGroups] = useState([]);
  const [selectedContactGroupId, setSelectedContactGroupId] = useState('');

  // Message Composer State
  const [messageType, setMessageType] = useState('text'); // 'text', 'template', 'media'
  const [messageText, setMessageText] = useState('');
  
  // Templates state
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedTemplatePreview, setSelectedTemplatePreview] = useState(null);

  // Media state
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentType, setAttachmentType] = useState('Image');
  const [attachmentName, setAttachmentName] = useState('');
  
  // Status and Loading
  const [loading, setLoading] = useState(false);

  const selectedSessionIdRef = useRef(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    fetchSessions();
    fetchTemplates();
    fetchContactGroups();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSessionId && recipientsType === 'groups') {
      fetchGroups();
    }
  }, [selectedSessionId, recipientsType]);

  useEffect(() => {
    if (selectedTemplateId) {
      const found = templates.find(t => String(t.id) === String(selectedTemplateId));
      setSelectedTemplatePreview(found || null);
    } else {
      setSelectedTemplatePreview(null);
    }
  }, [selectedTemplateId, templates]);

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

  const fetchContactGroups = async () => {
    try {
      const json = await apiRequest('/contacts/groups');
      if (json.status === 'success') {
        setContactGroups(json.data || []);
        if (json.data && json.data.length > 0) {
          setSelectedContactGroupId(json.data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching contact groups:', err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const json = await apiRequest('/templates');
      if (json.status === 'success') {
        setTemplates(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const fetchGroups = async () => {
    if (!selectedSessionId) return;
    try {
      setGroupsLoading(true);
      const json = await apiRequest(`/single-message/groups/${selectedSessionId}`);
      if (json.status === 'success') {
        setGroups(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching WhatsApp groups:', err);
      window.showError(err.message || 'Gagal memuat daftar grup.');
    } finally {
      setGroupsLoading(false);
    }
  };

  const toggleGroupSelection = (groupId) => {
    setSelectedGroupIds(prev => 
      prev.includes(groupId) 
        ? prev.filter(id => id !== groupId) 
        : [...prev, groupId]
    );
  };

  const handleQuickAction = (action) => {
    let textToInsert = '';
    if (action === 'random') {
      textToInsert = '{halo|hai|hallo|permisi}';
    } else if (action === 'spintax') {
      textToInsert = '{opsi1|opsi2|opsi3}';
    } else if (action === 'linebreak') {
      textToInsert = '\n';
    }
    
    setMessageText(prev => prev + textToInsert);
  };

  const handleSendSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSessionId) {
      window.showWarning('Pilih perangkat / instansi pengirim terlebih dahulu.');
      return;
    }

    let targets = [];

    if (recipientsType === 'groups') {
      if (selectedGroupIds.length === 0) {
        window.showWarning('Pilih minimal satu grup penerima.');
        return;
      }
      targets = [...selectedGroupIds];
    } else {
      // Send to contacts
      if (contactsSubOption === 'custom') {
        if (!customNumbers.trim()) {
          window.showWarning('Masukkan nomor tujuan WhatsApp.');
          return;
        }
        targets = customNumbers.split(',')
          .map(num => num.trim())
          .filter(Boolean);
      } else if (contactsSubOption === 'group') {
        if (!selectedContactGroupId) {
          window.showWarning('Pilih database group penerima.');
          return;
        }
        
        try {
          setLoading(true);
          const json = await apiRequest(`/contacts?groupId=${selectedContactGroupId}`);
          if (json.status === 'success' && json.data) {
            targets = json.data.map(c => c.phone_number);
          }
          if (targets.length === 0) {
            window.showWarning('Database group terpilih tidak memiliki kontak.');
            setLoading(false);
            return;
          }
        } catch (err) {
          window.showError(err.message || 'Gagal memuat kontak dari database group.');
          setLoading(false);
          return;
        }
      }
    }

    try {
      setLoading(true);
      let successCount = 0;
      let failCount = 0;

      for (const target of targets) {
        const payload = {
          sessionId: selectedSessionId,
          target,
          messageType,
          text: messageText,
          attachmentUrl,
          attachmentType,
          attachmentName,
          templateId: selectedTemplateId || null
        };

        try {
          const json = await apiRequest('/single-message/send', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (json.status === 'success') {
            successCount++;
          } else {
            failCount++;
            console.error(`Gagal mengirim ke ${target}:`, json.message);
          }
        } catch (err) {
          failCount++;
          console.error(`Gagal mengirim ke ${target}:`, err.message);
        }
      }

      if (successCount > 0) {
        window.showSuccess(`${successCount} pesan berhasil dikirim.`);
      }
      if (failCount > 0) {
        window.showError(`${failCount} pesan gagal dikirim.`);
      }

      // Reset form if entirely successful
      if (failCount === 0) {
        setCustomNumbers('');
        setSelectedGroupIds([]);
        setMessageText('');
        setAttachmentUrl('');
        setAttachmentName('');
        setSelectedTemplateId('');
      }

    } catch (err) {
      window.showError('Kesalahan jaringan saat mengirim pesan.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = groups.filter(g => 
    g.subject.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
    g.id.includes(groupSearchQuery)
  );

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Page Header */}
      <div className="card" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        marginBottom: '24px',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05))',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '14px',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          color: 'var(--primary-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Send size={24} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Single Message</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Send messages to contacts or WhatsApp groups with templates and media attachments
          </p>
        </div>
      </div>

      <form onSubmit={handleSendSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        
        {/* LEFT COLUMN: SENDER & RECIPIENTS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 1: Select Device */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Smartphone size={18} color="var(--primary-color)" />
              Select Device / Instance
            </h3>
            
            <div className="form-group" style={{ margin: 0 }}>
              <select
                className="form-control"
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                style={{ borderRadius: '8px', height: '42px' }}
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
            </div>
          </div>

          {/* Card 2: Select Recipients */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Users size={18} color="var(--primary-color)" />
                Select Recipients
              </h3>
              
              {/* Contacts / Groups Toggle Switch */}
              <div style={{ 
                display: 'flex', 
                backgroundColor: 'var(--bg-main)', 
                padding: '4px', 
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}>
                <button
                  type="button"
                  onClick={() => setRecipientsType('contacts')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    backgroundColor: recipientsType === 'contacts' ? 'var(--bg-card)' : 'transparent',
                    color: recipientsType === 'contacts' ? 'var(--primary-color)' : 'var(--text-muted)',
                    boxShadow: recipientsType === 'contacts' ? 'var(--shadow-sm)' : 'none'
                  }}
                >
                  Contacts
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientsType('groups')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    backgroundColor: recipientsType === 'groups' ? 'var(--bg-card)' : 'transparent',
                    color: recipientsType === 'groups' ? 'var(--primary-color)' : 'var(--text-muted)',
                    boxShadow: recipientsType === 'groups' ? 'var(--shadow-sm)' : 'none'
                  }}
                >
                  Groups
                </button>
              </div>
            </div>

            {/* Recipient Content rendering conditional */}
            {recipientsType === 'contacts' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Contacts Sub Options tabs */}
                <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setContactsSubOption('custom')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      backgroundColor: contactsSubOption === 'custom' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      color: contactsSubOption === 'custom' ? 'var(--primary-color)' : 'var(--text-muted)'
                    }}
                  >
                    Custom Numbers
                  </button>
                  <button
                    type="button"
                    onClick={() => setContactsSubOption('group')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      backgroundColor: contactsSubOption === 'group' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      color: contactsSubOption === 'group' ? 'var(--primary-color)' : 'var(--text-muted)'
                    }}
                  >
                    Database Group
                  </button>
                </div>

                {contactsSubOption === 'custom' ? (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Phone Numbers</label>
                    <textarea
                      placeholder="Enter target numbers (e.g. 628123456789, separate with comma for multiple targets)"
                      value={customNumbers}
                      onChange={(e) => setCustomNumbers(e.target.value)}
                      className="form-control"
                      style={{ height: '110px', borderRadius: '8px', resize: 'none', fontSize: '0.825rem' }}
                    />
                  </div>
                ) : (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Select Contact Group</label>
                    <select
                      className="form-control"
                      value={selectedContactGroupId}
                      onChange={(e) => setSelectedContactGroupId(e.target.value)}
                      style={{ borderRadius: '8px', height: '42px' }}
                    >
                      {contactGroups.length === 0 ? (
                        <option value="">No database groups found</option>
                      ) : (
                        contactGroups.map(cg => (
                          <option key={cg.id} value={cg.id}>
                            {cg.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      <Search size={14} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search groups..."
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                      className="form-control"
                      style={{ paddingLeft: '34px', height: '36px', borderRadius: '8px' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={fetchGroups}
                    disabled={groupsLoading}
                    className="btn btn-outline"
                    style={{ height: '36px', padding: '0 12px', borderRadius: '8px' }}
                  >
                    <RefreshCw size={14} className={groupsLoading ? 'spin' : ''} />
                    <span style={{ fontSize: '0.8rem' }}>Refresh</span>
                  </button>
                </div>

                {/* Group Checkbox list container */}
                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  backgroundColor: 'rgba(255, 255, 255, 0.01)'
                }}>
                  {groupsLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Fetching WhatsApp groups...
                    </div>
                  ) : filteredGroups.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                      No groups found
                    </div>
                  ) : (
                    filteredGroups.map(g => (
                      <div 
                        key={g.id} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '12px 16px', 
                          borderBottom: '1px solid var(--border-color)' 
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedGroupIds.includes(g.id)}
                            onChange={() => toggleGroupSelection(g.id)}
                            style={{ 
                              width: '16px', 
                              height: '16px', 
                              borderRadius: '4px', 
                              cursor: 'pointer',
                              accentColor: 'var(--primary-color)'
                            }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>{g.subject}</div>
                            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{g.id}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {g.size} members
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: MESSAGE COMPOSER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <MessageSquare size={18} color="var(--primary-color)" />
                Message Composer
              </h3>

              {/* Message Type Tabs Selector */}
              <div style={{ 
                display: 'flex', 
                backgroundColor: 'var(--bg-main)', 
                padding: '4px', 
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}>
                {['text', 'template', 'media'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMessageType(t)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      backgroundColor: messageType === t ? 'var(--bg-card)' : 'transparent',
                      color: messageType === t ? 'var(--primary-color)' : 'var(--text-muted)',
                      textTransform: 'capitalize'
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* MESSAGE COMPOSER FIELDS */}
            {messageType === 'text' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" style={{ margin: 0 }}>Message Content</label>
                  
                  {/* Spintax Quick Action Panel */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleQuickAction('random')}
                      className="btn-outline"
                      style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px' }}
                    >
                      Random
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAction('spintax')}
                      className="btn-outline"
                      style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px' }}
                    >
                      Spintax
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAction('linebreak')}
                      className="btn-outline"
                      style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px' }}
                    >
                      Line Break
                    </button>
                  </div>
                </div>

                <textarea
                  className="form-control"
                  placeholder="Type your custom message text..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  style={{ height: '180px', borderRadius: '8px', fontSize: '0.85rem' }}
                />
              </div>
            )}

            {messageType === 'template' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Select Template</label>
                  <select
                    className="form-control"
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    style={{ borderRadius: '8px', height: '42px' }}
                  >
                    <option value="">-- Choose message template --</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Advanced Template Preview Card */}
                {selectedTemplatePreview && (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px', 
                    padding: '16px',
                    backgroundColor: 'rgba(99, 102, 241, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-light)', fontWeight: 600 }}>TEMPLATE PREVIEW</span>
                      <span style={{ 
                        fontSize: '0.65rem', 
                        fontWeight: 700, 
                        color: 'var(--primary-color)',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        textTransform: 'uppercase'
                      }}>
                        {selectedTemplatePreview.type}
                      </span>
                    </div>

                    <div style={{ 
                      fontSize: '0.85rem', 
                      color: 'var(--text-main)', 
                      whiteSpace: 'pre-wrap',
                      backgroundColor: 'rgba(255, 255, 255, 0.01)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px',
                      maxHeight: '130px',
                      overflowY: 'auto'
                    }}>
                      {selectedTemplatePreview.content}
                    </div>

                    {/* Meta info inside preview */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                      <span>Category: <strong>{selectedTemplatePreview.category || 'General'}</strong></span>
                      {selectedTemplatePreview.attachment_url && (
                        <span style={{ color: 'var(--info)' }}>With Media attachment</span>
                      )}
                      {selectedTemplatePreview.poll_question && (
                        <span style={{ color: 'var(--success)' }}>With Poll query</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messageType === 'media' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Media URL</label>
                  <input
                    type="text"
                    placeholder="Enter direct URL of the media file"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    className="form-control"
                    style={{ borderRadius: '8px', height: '38px' }}
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
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Attachment Type</label>
                    <select
                      className="form-control"
                      value={attachmentType}
                      onChange={(e) => setAttachmentType(e.target.value)}
                      style={{ borderRadius: '8px', height: '38px' }}
                    >
                      {['Image', 'Video', 'Audio', 'Document'].map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Filename (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Document.pdf"
                      value={attachmentName}
                      disabled={attachmentType !== 'Document'}
                      onChange={(e) => setAttachmentName(e.target.value)}
                      className="form-control"
                      style={{ borderRadius: '8px', height: '38px' }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Caption / Companion Text</label>
                  <textarea
                    placeholder="Type captions for image/video/document..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="form-control"
                    style={{ height: '90px', borderRadius: '8px', resize: 'none', fontSize: '0.825rem' }}
                  />
                </div>
              </div>
            )}

            {/* SEND MESSAGE MAIN BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: '100%',
                borderRadius: '8px',
                height: '46px',
                fontSize: '0.95rem',
                fontWeight: 600,
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.25)',
                background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                border: 'none',
                marginTop: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
            >
              <Send size={18} />
              {loading ? 'Sending Messages...' : 'Send Message Now'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default SingleMessage;
