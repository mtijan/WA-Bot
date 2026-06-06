import React, { useState } from 'react';
import { X, Plus, Trash2, GripVertical, Settings2, MessageSquare, Image, Video, Music, File } from 'lucide-react';
import MediaUploadField from './MediaUploadField';

const ChatbotFlowModal = ({ isOpen, onClose, onSave, flow, sessions, flows = [] }) => {
  const [formData, setFormData] = useState(
    flow || {
      flow_name: '',
      description: '',
      session_ids: [],
      target_type: 'ALL',
      keywords: '',
      match_type: 'CONTAINS',
      case_sensitive: false,
      cooldown: 0,
      delay: 0,
      status: 'ACTIVE',
      nodes: []
    }
  );

  const [activeTab, setActiveTab] = useState('settings'); // 'settings' | 'nodes'

  React.useEffect(() => {
    if (isOpen) {
      if (flow) {
        setFormData(flow);
      } else {
        setFormData({
          flow_name: '',
          description: '',
          session_ids: [],
          target_type: 'ALL',
          keywords: '',
          match_type: 'CONTAINS',
          case_sensitive: false,
          cooldown: 0,
          delay: 0,
          status: 'ACTIVE',
          nodes: []
        });
      }
      setActiveTab('settings');
    }
  }, [flow, isOpen]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSessionToggle = (sessionId) => {
    setFormData(prev => {
      const ids = [...prev.session_ids];
      if (ids.includes(sessionId)) {
        return { ...prev, session_ids: ids.filter(id => id !== sessionId) };
      } else {
        return { ...prev, session_ids: [...ids, sessionId] };
      }
    });
  };

  const addNode = () => {
    setFormData(prev => ({
      ...prev,
      nodes: [
        ...prev.nodes, 
        {
          id: Date.now().toString(),
          node_name: '',
          node_type: 'Message',
          message_type: 'Text Message',
          message_content: '',
          attachment: { type: '', url: '' },
          typing_indicator: false,
          next_node: '',
          buttons: []
        }
      ]
    }));
  };

  const updateNode = (index, field, value) => {
    setFormData(prev => {
      const newNodes = [...prev.nodes];
      newNodes[index] = { ...newNodes[index], [field]: value };
      return { ...prev, nodes: newNodes };
    });
  };

  const updateNodeAttachment = (index, field, value) => {
    setFormData(prev => {
      const newNodes = [...prev.nodes];
      newNodes[index].attachment = { ...newNodes[index].attachment, [field]: value };
      return { ...prev, nodes: newNodes };
    });
  };

  const removeNode = (index) => {
    setFormData(prev => {
      const newNodes = [...prev.nodes];
      newNodes.splice(index, 1);
      return { ...prev, nodes: newNodes };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{flow ? 'Edit Chatbot Flow' : 'Create Chatbot Flow'}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 24px' }}>
          <button 
            style={{ padding: '16px 24px', background: 'none', border: 'none', borderBottom: activeTab === 'settings' ? '2px solid var(--primary-color)' : '2px solid transparent', color: activeTab === 'settings' ? 'var(--primary-color)' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setActiveTab('settings')}
          >
            Flow Settings
          </button>
          <button 
            style={{ padding: '16px 24px', background: 'none', border: 'none', borderBottom: activeTab === 'nodes' ? '2px solid var(--primary-color)' : '2px solid transparent', color: activeTab === 'nodes' ? 'var(--primary-color)' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setActiveTab('nodes')}
          >
            Response Nodes ({formData.nodes.length})
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'settings' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Flow Name *</label>
                <input type="text" className="form-control" name="flow_name" value={formData.flow_name} onChange={handleChange} placeholder="e.g., Welcome Message" required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Description</label>
                <input type="text" className="form-control" name="description" value={formData.description} onChange={handleChange} placeholder="Internal description for this flow" />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">WhatsApp Sessions</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {sessions.map(s => (
                    <label key={s.session_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', cursor: 'pointer', backgroundColor: formData.session_ids.includes(s.session_id) ? 'var(--primary-color)' : 'transparent', color: formData.session_ids.includes(s.session_id) ? 'white' : 'var(--text-main)' }}>
                      <input type="checkbox" style={{ display: 'none' }} checked={formData.session_ids.includes(s.session_id)} onChange={() => handleSessionToggle(s.session_id)} />
                      {s.session_id}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Chat Target Restriction</label>
                <select className="form-control" name="target_type" value={formData.target_type || 'ALL'} onChange={handleChange} style={{ borderRadius: '8px', height: '40px' }}>
                  <option value="ALL">Both Group & Personal Chats (Keduanya)</option>
                  <option value="PERSONAL">Personal Chat Only (Hanya Pesan Pribadi)</option>
                  <option value="GROUP">Group Chat Only (Hanya Grup)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Trigger Keywords *</label>
                  <textarea className="form-control" name="keywords" value={formData.keywords} onChange={handleChange} placeholder="Comma separated (e.g. hello, hi, ping)" required style={{ minHeight: '80px' }} />
                </div>
                <div>
                  <div className="form-group">
                    <label className="form-label">Match Type</label>
                    <select className="form-control" name="match_type" value={formData.match_type} onChange={handleChange}>
                      <option value="CONTAINS">Contains (Matches if keyword is inside message)</option>
                      <option value="EXACT">Exact (Matches full message only)</option>
                      <option value="STARTS_WITH">Starts With (Matches beginning of message)</option>
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', marginTop: '12px', cursor: 'pointer' }}>
                    <input type="checkbox" name="case_sensitive" checked={formData.case_sensitive} onChange={handleChange} />
                    Case Sensitive Matching
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Cooldown Period (minutes)</label>
                  <input type="number" className="form-control" name="cooldown" value={formData.cooldown} onChange={handleChange} min="0" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Message Delay (seconds)</label>
                  <input type="number" className="form-control" name="delay" value={formData.delay} onChange={handleChange} min="0" />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {formData.nodes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed var(--border-color)', borderRadius: 'var(--border-radius)' }}>
                  <MessageSquare size={48} style={{ color: 'var(--border-color)', marginBottom: '16px' }} />
                  <h3 style={{ marginBottom: '8px' }}>No nodes added yet</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Nodes represent the sequence of messages sent to the user.</p>
                  <button className="btn btn-primary" onClick={addNode}><Plus size={16} /> Add First Node</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {formData.nodes.map((node, index) => (
                    <div key={node.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', overflow: 'hidden' }}>
                      <div style={{ backgroundColor: 'var(--bg-main)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 600 }}>
                          <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab' }} />
                          Node {index + 1}
                        </div>
                        <button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => removeNode(index)}><Trash2 size={16} /></button>
                      </div>
                      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Message Type</label>
                            <select className="form-control" value={node.message_type || 'Text Message'} onChange={(e) => updateNode(index, 'message_type', e.target.value)}>
                              <option value="Text Message">Text Message</option>
                              <option value="Interactive Buttons">Interactive Buttons</option>
                            </select>
                          </div>
                          
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Node Name</label>
                            <input type="text" className="form-control" value={node.node_name} onChange={(e) => updateNode(index, 'node_name', e.target.value)} placeholder="e.g., Greeting Text" />
                          </div>
                        </div>
                        
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Message Content *</label>
                          <textarea className="form-control" value={node.message_content} onChange={(e) => updateNode(index, 'message_content', e.target.value)} placeholder="Enter the message for this node..." required />
                        </div>

                        {(node.message_type || 'Text Message') === 'Interactive Buttons' && (
                          <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)', padding: '16px', backgroundColor: 'var(--bg-main)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                              <label className="form-label" style={{ marginBottom: 0 }}>Interactive Buttons</label>
                              <span style={{ fontSize: '0.75rem', color: (node.buttons || []).length >= 3 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                                {(node.buttons || []).length} / 3 Buttons
                              </span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: (node.buttons || []).length < 3 ? '12px' : 0 }}>
                              {(node.buttons || []).map((btn, btnIndex) => (
                                <div key={btnIndex} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <input 
                                    type="text" 
                                    className="form-control" 
                                    value={btn} 
                                    onChange={(e) => {
                                      const updatedButtons = [...(node.buttons || [])];
                                      updatedButtons[btnIndex] = e.target.value;
                                      updateNode(index, 'buttons', updatedButtons);
                                    }} 
                                    placeholder={`Button ${btnIndex + 1} text (max 20 characters)`}
                                    maxLength={20}
                                    required
                                  />
                                  <button 
                                    type="button" 
                                    className="btn-icon" 
                                    style={{ color: 'var(--danger)' }} 
                                    onClick={() => {
                                      const updatedButtons = (node.buttons || []).filter((_, i) => i !== btnIndex);
                                      updateNode(index, 'buttons', updatedButtons);
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            
                            {(node.buttons || []).length < 3 && (
                              <button 
                                type="button" 
                                className="btn btn-outline" 
                                style={{ padding: '6px 12px', fontSize: '0.875rem' }} 
                                onClick={() => {
                                  const updatedButtons = [...(node.buttons || []), ''];
                                  updateNode(index, 'buttons', updatedButtons);
                                }}
                              >
                                <Plus size={14} /> Add Button
                              </button>
                            )}
                          </div>
                        )}

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Attachment (Optional)</label>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <select className="form-control" style={{ width: '150px' }} value={node.attachment.type} onChange={(e) => updateNodeAttachment(index, 'type', e.target.value)}>
                              <option value="">None</option>
                              <option value="Image">Image</option>
                              <option value="Video">Video</option>
                              <option value="Audio">Audio</option>
                              <option value="Document">Document</option>
                            </select>
                            {node.attachment.type && (
                              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <input 
                                  type="text" 
                                  name={`media_url_${index}`}
                                  id={`media_url_${index}`}
                                  className="form-control" 
                                  value={node.attachment.url} 
                                  onChange={(e) => updateNodeAttachment(index, 'url', e.target.value)} 
                                  placeholder="Enter Direct Media URL (https://...)" 
                                  autoComplete="off"
                                />
                                {(node.attachment.type === 'Image' || node.attachment.type === 'Video') && (
                                  <MediaUploadField
                                    mediaType={node.attachment.type}
                                    onUploaded={(media) => updateNodeAttachment(index, 'url', media.url)}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={node.typing_indicator} onChange={(e) => updateNode(index, 'typing_indicator', e.target.checked)} />
                          Show typing indicator before sending this node's message
                        </label>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Next Node (Optional)</label>
                          <select className="form-control" value={node.next_node ? String(node.next_node) : ''} onChange={(e) => updateNode(index, 'next_node', e.target.value)}>
                            <option value="">Auto (Next in sequence)</option>
                            
                            <optgroup label="Jump to Node (Current Flow)">
                              {formData.nodes
                                .filter(n => String(n.id) !== String(node.id))
                                .map(n => (
                                  <option key={n.id} value={n.id}>
                                    {n.node_name || `Unnamed Node (${n.id})`}
                                  </option>
                                ))
                              }
                            </optgroup>

                            <optgroup label="Trigger Another Flow">
                              {flows
                                .filter(f => String(f.id) !== String(formData.id))
                                .map(f => (
                                  <option key={`flow-${f.id}`} value={`flow:${f.id}`}>
                                    {f.flow_name}
                                  </option>
                                ))
                              }
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button className="btn btn-outline" style={{ borderStyle: 'dashed' }} onClick={addNode}>
                    <Plus size={16} /> Add Node
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>Save Flow</button>
        </div>
      </div>
    </div>
  );
};

export default ChatbotFlowModal;
