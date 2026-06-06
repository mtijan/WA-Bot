import { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  RefreshCw, 
  FileText, 
  Trash2, 
  X, 
  Clipboard, 
  Check,
  MessageSquare,
  Image as ImageIcon,
  Paperclip,
  Users,
  BarChart2,
  Video,
  Volume2,
  Lock,
  Sparkles,
  Smile,
  CornerDownLeft
} from 'lucide-react';
import { apiRequest } from '../apiClient';
import MediaUploadField from './MediaUploadField';

const Templates = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

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

  // Form State
  const [selectedType, setSelectedType] = useState('text'); // 'text', 'image', 'document', 'contact', 'poll', 'video', 'audio'
  const [templateName, setTemplateName] = useState('');
  const [category, setCategory] = useState('General');
  const [messageContent, setMessageContent] = useState('');
  
  // Extra fields for media / special templates
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(''); // newline separated

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const json = await apiRequest('/templates');
      if (json.status === 'success') {
        setTemplates(json.data || []);
      }
    } catch (err) {
      console.error('Gagal memuat template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!templateName.trim() || !messageContent.trim()) {
      window.showWarning('Nama template dan konten pesan wajib diisi.');
      return;
    }

    // Validations based on type
    if ((selectedType === 'image' || selectedType === 'document' || selectedType === 'video' || selectedType === 'audio') && !attachmentUrl.trim()) {
      window.showWarning('URL Lampiran wajib diisi untuk tipe media.');
      return;
    }

    if (selectedType === 'contact' && (!contactName.trim() || !contactNumber.trim())) {
      window.showWarning('Nama dan nomor kontak wajib diisi.');
      return;
    }

    if (selectedType === 'poll' && (!pollQuestion.trim() || !pollOptions.trim())) {
      window.showWarning('Pertanyaan jajak pendapat dan pilihan wajib diisi.');
      return;
    }

    try {
      setLoading(true);
      const json = await apiRequest('/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: templateName,
          content: messageContent,
          type: selectedType,
          category: category,
          attachment_url: attachmentUrl || null,
          attachment_name: attachmentName || null,
          contact_name: contactName || null,
          contact_number: contactNumber || null,
          poll_question: pollQuestion || null,
          poll_options: pollOptions || null
        })
      });
      if (json.status === 'success') {
        window.showSuccess('Template pesan berhasil disimpan.');
        // Reset states
        setTemplateName('');
        setMessageContent('');
        setSelectedType('text');
        setCategory('General');
        setAttachmentUrl('');
        setAttachmentName('');
        setContactName('');
        setContactNumber('');
        setPollQuestion('');
        setPollOptions('');
        setShowCreateModal(false);
        fetchTemplates();
      } else {
        window.showError(json.message || 'Gagal menyimpan template.');
      }
    } catch {
      window.showError('Kesalahan jaringan saat menyimpan template.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (id) => {
    triggerConfirm(
      'Hapus Template',
      'Apakah Anda yakin ingin menghapus template pesan ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const json = await apiRequest(`/templates/${id}`, { method: 'DELETE' });
          if (json.status === 'success') {
            window.showSuccess('Template berhasil dihapus.');
            fetchTemplates();
          } else {
            window.showError(json.message || 'Gagal menghapus template.');
          }
        } catch {
          window.showError('Kesalahan jaringan saat menghapus template.');
        }
      }
    );
  };

  const handleCopyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    copiedId === null && setCopiedId(id);
    window.showInfo('Isi template disalin ke papan klip.');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Quick Action Buttons
  const insertTextAtCursor = (textToInsert) => {
    const textarea = document.getElementById('templateContentArea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = messageContent;
    
    const newText = currentText.substring(0, start) + textToInsert + currentText.substring(end);
    setMessageContent(newText);
    
    // Focus back and set selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
    }, 0);
  };

  const handleInsertRandom = () => {
    insertTextAtCursor('{{random_greeting}}');
  };

  const handleInsertSpintax = () => {
    insertTextAtCursor('{Halo|Hai|Selamat pagi}');
  };

  const handleInsertLineBreak = () => {
    insertTextAtCursor('\n');
  };

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // Template type display helper
  const renderTypeIcon = (type) => {
    switch (type) {
      case 'image': return <ImageIcon size={14} />;
      case 'document': return <Paperclip size={14} />;
      case 'contact': return <Users size={14} />;
      case 'poll': return <BarChart2 size={14} />;
      case 'video': return <Video size={14} />;
      case 'audio': return <Volume2 size={14} />;
      default: return <MessageSquare size={14} />;
    }
  };

  // Available types in Modal grid (Image 1 style)
  const templateTypesGrid = [
    { id: 'text', name: 'Text Message', icon: <MessageSquare size={24} />, desc: 'Simple text message with variables', enabled: true },
    { id: 'image', name: 'Message + Image', icon: <ImageIcon size={24} />, desc: 'Send images with optional captions', enabled: true },
    { id: 'document', name: 'Message + Document', icon: <Paperclip size={24} />, desc: 'Send PDFs or doc files with descriptions', enabled: true },
    { id: 'contact', name: 'Message + Contact', icon: <Users size={24} />, desc: 'Send phone book contact card details', enabled: true },
    { id: 'poll', name: 'Message + Poll', icon: <BarChart2 size={24} />, desc: 'Create real-time interactive poll questions', enabled: true },
    { id: 'video', name: 'Message + Video', icon: <Video size={24} />, desc: 'Send MP4 or short video files', enabled: true },
    { id: 'audio', name: 'Message + Audio', icon: <Volume2 size={24} />, desc: 'Send high-quality audio or voice messages', enabled: true },
    // Disabled options as per instructions
    { id: 'buttons', name: 'Message + Buttons', icon: <MessageSquare size={24} />, desc: 'Interactive buttons (Soon)', enabled: false },
    { id: 'location', name: 'Message + Location', icon: <MessageSquare size={24} />, desc: 'Share GPS location coordinates (Soon)', enabled: false },
    { id: 'mixed', name: 'Mixed Interactive Buttons', icon: <MessageSquare size={24} />, desc: 'Mixed actions and buttons (Soon)', enabled: false },
    { id: 'carousel', name: 'Message + Carousel', icon: <MessageSquare size={24} />, desc: 'Dynamic swipable cards (Soon)', enabled: false },
  ];

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
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Message Templates</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Create and manage reusable message templates for bulk campaigns and personalized messaging
          </p>
        </div>

        <button 
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          style={{
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
            background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
            border: 'none'
          }}
        >
          <Plus size={18} /> Create Template
        </button>
      </div>

      {/* Control Area: Search & Refresh */}
      <div className="card" style={{
        padding: '16px 24px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          Total Templates: {templates.length}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchTemplates}
            className="btn-icon"
            style={{
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'white'
            }}
          >
            <RefreshCw size={16} className={loading ? 'spin-animation' : ''} />
          </button>

          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{
                paddingLeft: '36px',
                width: '260px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                height: '38px'
              }}
            />
          </div>
        </div>
      </div>

      {/* Templates Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(325px, 1fr))',
        gap: '20px'
      }}>
        {filteredTemplates.length === 0 ? (
          <div className="card text-center" style={{ gridColumn: '1 / -1', padding: '60px 40px', borderStyle: 'dashed' }}>
            <FileText size={48} style={{ color: 'var(--text-light)', margin: '0 auto 16px' }} />
            <h3>No templates found</h3>
            <p style={{ maxWidth: '400px', margin: '8px auto 24px' }}>
              Create templates to compose campaign messages faster.
            </p>
            <button 
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
              style={{ borderRadius: '8px', padding: '10px 20px', fontWeight: 600 }}
            >
              <Plus size={18} /> Create Template
            </button>
          </div>
        ) : (
          filteredTemplates.map(t => (
            <div key={t.id} className="card" style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRadius: '12px',
              background: 'white',
              position: 'relative'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                      color: 'var(--primary-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {renderTypeIcon(t.type)}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{t.name}</h4>
                      <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Category: {t.category || 'General'}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      title="Salin Isi Template"
                      onClick={() => handleCopyToClipboard(t.content, t.id)}
                      className="btn-icon"
                      style={{ padding: '6px', color: 'var(--text-muted)' }}
                    >
                      {copiedId === t.id ? <Check size={15} color="var(--success)" /> : <Clipboard size={15} />}
                    </button>
                    <button
                      title="Hapus Template"
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="btn-icon"
                      style={{ padding: '6px', color: 'var(--danger)' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Main Body */}
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.825rem',
                  color: 'var(--text-main)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '110px',
                  overflowY: 'auto'
                }}>
                  {t.content}
                </div>

                {/* Render Media / Special Details if present */}
                {t.type === 'contact' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '10px', padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: '6px', fontSize: '0.75rem', border: '1px dashed rgba(59, 130, 246, 0.2)' }}>
                    <div><strong>Contact Card Details:</strong></div>
                    <div>Name: {t.contact_name}</div>
                    <div>Phone: {t.contact_number}</div>
                  </div>
                )}

                {t.type === 'poll' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '10px', padding: '8px', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: '6px', fontSize: '0.75rem', border: '1px dashed rgba(16, 185, 129, 0.2)' }}>
                    <div><strong>Poll details:</strong></div>
                    <div>Question: {t.poll_question}</div>
                    <div>Options: {(t.poll_options || '').split('\n').join(', ')}</div>
                  </div>
                )}

                {(t.type === 'image' || t.type === 'document' || t.type === 'video' || t.type === 'audio') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '10px', padding: '8px', backgroundColor: 'rgba(139, 92, 246, 0.05)', borderRadius: '6px', fontSize: '0.75rem', border: '1px dashed rgba(139, 92, 246, 0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>Media details ({t.type}):</strong>
                      {t.attachment_name && <span>File: {t.attachment_name}</span>}
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--primary-color)' }}>
                      URL: {t.attachment_url}
                    </div>
                  </div>
                )}
              </div>

              <div style={{
                borderTop: '1px solid var(--border-color)',
                paddingTop: '12px',
                marginTop: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-light)'
              }}>
                <span style={{
                  fontSize: '0.675rem',
                  fontWeight: 600,
                  color: 'var(--primary-color)',
                  backgroundColor: 'rgba(99, 102, 241, 0.08)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  textTransform: 'uppercase'
                }}>
                  {t.type}
                </span>
                <span>Dibuat: {formatDate(t.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ========================================== */}
      {/* MODAL: CREATE TEMPLATE                     */}
      {/* ========================================== */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '820px',
            maxHeight: '92vh',
            overflowY: 'auto',
            background: 'white',
            borderRadius: '16px',
            padding: '28px',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowCreateModal(false)}
              className="btn-icon"
              style={{
                position: 'absolute',
                right: '20px',
                top: '20px',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '32px',
                height: '32px'
              }}
            >
              <X size={16} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '8px', 
                backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Plus size={20} />
              </div>
              <h3 style={{ margin: 0 }}>Create Template</h3>
            </div>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '20px', paddingLeft: '46px' }}>
              Define reusable campaign templates with dynamic parameters and custom attachments.
            </p>

            <form onSubmit={handleCreateTemplate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Template Type Selection Grid (Image 1/2 style) */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Template Type</label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px',
                  marginTop: '6px'
                }}>
                  {templateTypesGrid.map((type) => {
                    const isSelected = selectedType === type.id;
                    const isEnabled = type.enabled;

                    return (
                      <div
                        key={type.id}
                        onClick={() => isEnabled && setSelectedType(type.id)}
                        style={{
                          border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.05)' : isEnabled ? 'white' : '#f9fafb',
                          borderRadius: '8px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isEnabled ? 'pointer' : 'not-allowed',
                          opacity: isEnabled ? 1 : 0.6,
                          textAlign: 'center',
                          transition: 'all 0.2s',
                          position: 'relative'
                        }}
                      >
                        <div style={{
                          color: isSelected ? 'var(--primary-color)' : 'var(--text-muted)',
                          marginBottom: '8px'
                        }}>
                          {type.icon}
                        </div>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: isSelected ? 'var(--primary-color)' : 'var(--text-main)',
                          lineHeight: '1.2'
                        }}>
                          {type.name}
                        </span>
                        {!isEnabled && (
                          <div style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            color: 'var(--text-light)'
                          }}>
                            <Lock size={12} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {templateTypesGrid.find(t => t.id === selectedType)?.desc || ''}
                </div>
              </div>

              {/* Template Name & Category side-by-side (Image 1 style) */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Template Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Welcome Message"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="form-control"
                  />
                </div>

                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="form-control"
                  >
                    <option value="General">General</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Utility">Utility</option>
                    <option value="Support">Support</option>
                  </select>
                </div>
              </div>

              {/* Dynamic inputs based on type */}
              {(selectedType === 'image' || selectedType === 'document' || selectedType === 'video' || selectedType === 'audio') && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.825rem' }}>Media Settings</div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Attachment URL *</label>
                      <input
                        type="text"
                        required
                        placeholder="https://example.com/file.png atau path upload"
                        value={attachmentUrl}
                        onChange={(e) => setAttachmentUrl(e.target.value)}
                        className="form-control"
                      />
                      {(selectedType === 'image' || selectedType === 'video') && (
                        <MediaUploadField
                          mediaType={selectedType}
                          onUploaded={(media) => setAttachmentUrl(media.url)}
                        />
                      )}
                    </div>
                    {selectedType === 'document' && (
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="form-label">Document File Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Catalog.pdf"
                          value={attachmentName}
                          onChange={(e) => setAttachmentName(e.target.value)}
                          className="form-control"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedType === 'contact' && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.825rem' }}>Contact Details</div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Contact Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. CS Finance"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        className="form-control"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Contact Phone Number *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. 62812345678"
                        value={contactNumber}
                        onChange={(e) => setContactNumber(e.target.value)}
                        className="form-control"
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedType === 'poll' && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.825rem' }}>Poll Settings</div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Poll Question *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Apakah Anda menyukai layanan kami?"
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      className="form-control"
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Poll Options * (one per line, max 5 options)</label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Sangat Puas&#10;Puas&#10;Cukup&#10;Kurang"
                      value={pollOptions}
                      onChange={(e) => setPollOptions(e.target.value)}
                      className="form-control"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </div>
              )}

              {/* Message Content with editor actions (Image 1 style) */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Message Content *</label>
                  
                  {/* Action buttons on top right of editor */}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={handleInsertRandom}
                      style={{
                        padding: '4px 10px', fontSize: '0.725rem', border: '1px solid var(--border-color)',
                        borderRadius: '6px', background: '#f9fafb', cursor: 'pointer', display: 'inline-flex',
                        alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontWeight: 500
                      }}
                    >
                      <Sparkles size={11} /> Random
                    </button>
                    <button
                      type="button"
                      onClick={handleInsertSpintax}
                      style={{
                        padding: '4px 10px', fontSize: '0.725rem', border: '1px solid var(--border-color)',
                        borderRadius: '6px', background: '#f9fafb', cursor: 'pointer', display: 'inline-flex',
                        alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontWeight: 500
                      }}
                    >
                      <Smile size={11} /> Spintax
                    </button>
                    <button
                      type="button"
                      onClick={handleInsertLineBreak}
                      style={{
                        padding: '4px 10px', fontSize: '0.725rem', border: '1px solid var(--border-color)',
                        borderRadius: '6px', background: '#f9fafb', cursor: 'pointer', display: 'inline-flex',
                        alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontWeight: 500
                      }}
                    >
                      <CornerDownLeft size={11} /> Line Break
                    </button>
                  </div>
                </div>

                <textarea
                  id="templateContentArea"
                  required
                  rows={5}
                  placeholder="Enter your message content here... Use {{variable}} for dynamic content"
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  className="form-control"
                  style={{ resize: 'vertical' }}
                />
                
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Use double curly braces for variables: <code>{"{{product}}"}</code>, <code>{"{{date}}"}</code>, <code>{"{{location}}"}</code>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-outline"
                  style={{ borderRadius: '8px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                    border: 'none',
                    padding: '10px 24px',
                    fontWeight: 600
                  }}
                >
                  {loading ? 'Saving...' : 'Create Template'}
                </button>
              </div>
            </form>
          </div>
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

export default Templates;
