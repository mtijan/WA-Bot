import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  Cpu, 
  Database, 
  Key, 
  Eye, 
  EyeOff, 
  Play, 
  AlertCircle, 
  Loader2, 
  Save, 
  Clock,
  MessageSquare
} from 'lucide-react';
import { apiRequest } from '../apiClient';

function ChatbotAI({ API_URL }) {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  
  // AI Settings State
  const [isActive, setIsActive] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://ai.sumopod.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [systemInstruction, setSystemInstruction] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [knowledgeSource, setKnowledgeSource] = useState('manual');
  const [flowsKnowledgeBase, setFlowsKnowledgeBase] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [showTyping, setShowTyping] = useState(true);
  const [chatbotMode, setChatbotMode] = useState('both');

  // AI Credentials List & Modal State
  const [credentials, setCredentials] = useState([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState('');
  const [showCredModal, setShowCredModal] = useState(false);
  const [editingCred, setEditingCred] = useState(null);
  const [loadingCredentials, setLoadingCredentials] = useState(false);

  // Modal Form State
  const [credName, setCredName] = useState('');
  const [credBaseUrl, setCredBaseUrl] = useState('https://ai.sumopod.com/v1');
  const [credApiKey, setCredApiKey] = useState('');
  const [credModelName, setCredModelName] = useState('gpt-4o-mini');
  const [credIsActive, setCredIsActive] = useState(true);
  const [showModalApiKey, setShowModalApiKey] = useState(false);
  
  // UI & Loading States
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

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

  // Sandbox Simulator State
  const [sandboxMessages, setSandboxMessages] = useState([
    { role: 'system', content: 'Sandbox Simulator aktif. Silakan kirim pesan uji coba di bawah untuk menguji asisten AI Anda secara instan.' }
  ]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [simulating, setSimulating] = useState(false);
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchSessions();
    fetchCredentials();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      fetchAISettings(selectedSession);
    } else {
      resetForm();
    }
  }, [selectedSession]);

  useEffect(() => {
    // Scroll to bottom in sandbox simulator chat
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sandboxMessages, simulating]);

  const fetchSessions = async () => {
    try {
      const result = await apiRequest('/sessions');
      if (result.status === 'success') {
        const activeSessions = result.data.filter(s => s.status === 'CONNECTED');
        setSessions(activeSessions);
        if (activeSessions.length > 0) {
          setSelectedSession(activeSessions[0].session_id);
        }
      }
    } catch (err) {
      console.error(err);
      setError('Gagal memuat sesi WhatsApp aktif.');
    }
  };

  const fetchAISettings = async (sessionId) => {
    setLoadingSettings(true);
    setError(null);
    try {
      const result = await apiRequest(`/chatbot-ai/settings/${sessionId}`);
      if (result.status === 'success' && result.data) {
        const d = result.data;
        setIsActive(d.is_active === 1);
        setBaseUrl(d.base_url || 'https://ai.sumopod.com/v1');
        setApiKey('');
        setHasStoredApiKey(Boolean(d.has_api_key));
        setModelName(d.model_name || 'gpt-4o-mini');
        setSystemInstruction(d.system_instruction || '');
        setKnowledgeBase(d.knowledge_base || '');
        setKnowledgeSource(d.knowledge_source || 'manual');
        setFlowsKnowledgeBase(d.flows_knowledge_base || '');
        setDelaySeconds(d.delay_seconds !== undefined ? d.delay_seconds : 2);
        setShowTyping(d.show_typing === 1);
        setSelectedCredentialId(d.credential_id || '');
        setChatbotMode(d.chatbot_mode || 'both');
      }
    } catch (err) {
      console.error(err);
      setError('Gagal memuat pengaturan Chatbot AI.');
    } finally {
      setLoadingSettings(false);
    }
  };

  const resetForm = () => {
    setIsActive(false);
    setBaseUrl('https://ai.sumopod.com/v1');
    setApiKey('');
    setHasStoredApiKey(false);
    setModelName('gpt-4o-mini');
    setSystemInstruction('');
    setKnowledgeBase('');
    setKnowledgeSource('manual');
    setFlowsKnowledgeBase('');
    setDelaySeconds(2);
    setShowTyping(true);
    setSelectedCredentialId('');
    setChatbotMode('both');
  };

  const fetchCredentials = async () => {
    setLoadingCredentials(true);
    try {
      const result = await apiRequest('/chatbot-ai/credentials');
      if (result.status === 'success') {
        setCredentials(result.data);
      }
    } catch (err) {
      console.error(err);
      window.showError('Gagal memuat daftar kredensial AI.');
    } finally {
      setLoadingCredentials(false);
    }
  };

  const handleOpenCredModal = (cred = null) => {
    setEditingCred(cred);
    if (cred) {
      setCredName(cred.name);
      setCredBaseUrl(cred.base_url || 'https://ai.sumopod.com/v1');
      setCredApiKey('');
      setCredModelName(cred.model_name || 'gpt-4o-mini');
      setCredIsActive(cred.is_active === 1);
    } else {
      setCredName('');
      setCredBaseUrl('https://ai.sumopod.com/v1');
      setCredApiKey('');
      setCredModelName('gpt-4o-mini');
      setCredIsActive(true);
    }
    setShowModalApiKey(false);
    setShowCredModal(true);
  };

  const handleSaveCredential = async (e) => {
    e.preventDefault();
    if (!credName.trim()) {
      window.showWarning('Nama kredensial wajib diisi.');
      return;
    }

    try {
      const payload = {
        name: credName.trim(),
        base_url: credBaseUrl.trim(),
        model_name: credModelName,
        is_active: credIsActive ? 1 : 0
      };

      if (credApiKey) {
        payload.api_key = credApiKey;
      }

      let path = '/chatbot-ai/credentials';
      let method = 'POST';

      if (editingCred) {
        path = `/chatbot-ai/credentials/${editingCred.id}`;
        method = 'PUT';
        if (!credApiKey && !editingCred.has_api_key) {
          window.showWarning('API Key wajib disertakan.');
          return;
        }
      } else {
        if (!credApiKey) {
          window.showWarning('API Key wajib diisi untuk kredensial baru.');
          return;
        }
      }

      const result = await apiRequest(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result.status === 'success') {
        window.showSuccess(result.message);
        setShowCredModal(false);
        fetchCredentials();
        if (selectedSession) {
          fetchAISettings(selectedSession);
        }
      } else {
        window.showError(result.message || 'Gagal menyimpan kredensial.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat menyimpan kredensial.');
    }
  };

  const handleDeleteCredential = async (id) => {
    triggerConfirm(
      'Hapus Kredensial AI',
      'Apakah Anda yakin ingin menghapus kredensial ini?',
      'Ya, Hapus',
      'btn-danger',
      async () => {
        try {
          const result = await apiRequest(`/chatbot-ai/credentials/${id}`, {
            method: 'DELETE'
          });
          if (result.status === 'success') {
            window.showSuccess('Kredensial berhasil dihapus.');
            fetchCredentials();
            if (selectedSession) {
              fetchAISettings(selectedSession);
            }
          } else {
            window.showError(result.message || 'Gagal menghapus kredensial.');
          }
        } catch (err) {
          console.error(err);
          window.showError('Kesalahan jaringan saat menghapus kredensial.');
        }
      }
    );
  };

  const handleToggleCredential = async (id) => {
    try {
      const result = await apiRequest(`/chatbot-ai/credentials/${id}/toggle`, {
        method: 'PATCH'
      });
      if (result.status === 'success') {
        window.showSuccess(`Kredensial ${result.is_active === 1 ? 'diaktifkan' : 'dinonaktifkan'}.`);
        fetchCredentials();
      } else {
        window.showError(result.message || 'Gagal mengubah status kredensial.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat mengubah status kredensial.');
    }
  };

  const handleSaveCredentials = async () => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }

    setSavingCredentials(true);
    try {
      const payload = {
        session_id: selectedSession,
        credential_id: selectedCredentialId ? parseInt(selectedCredentialId) : null
      };

      if (!selectedCredentialId) {
        payload.base_url = baseUrl;
        payload.model_name = modelName;
        if (apiKey) {
          payload.api_key = apiKey;
        }
      }

      const result = await apiRequest('/chatbot-ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result.status === 'success') {
        if (apiKey) setHasStoredApiKey(true);
        setApiKey('');
        window.showSuccess('Kredensial AI untuk sesi berhasil disimpan.');
      } else {
        window.showError(result.message || 'Gagal menyimpan kredensial.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat menyimpan kredensial.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }

    setSavingSettings(true);
    try {
      const result = await apiRequest('/chatbot-ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSession,
          is_active: isActive ? 1 : 0,
          system_instruction: systemInstruction,
          knowledge_base: knowledgeBase,
          knowledge_source: knowledgeSource,
          delay_seconds: parseInt(delaySeconds),
          show_typing: showTyping ? 1 : 0,
          chatbot_mode: chatbotMode
        })
      });
      if (result.status === 'success') {
        window.showSuccess('Pengaturan Chatbot AI berhasil disimpan.');
        fetchAISettings(selectedSession);
      } else {
        window.showError(result.message || 'Gagal menyimpan pengaturan.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat menyimpan pengaturan.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleModeChange = async (newMode) => {
    if (!selectedSession) return;
    setChatbotMode(newMode);

    try {
      const result = await apiRequest('/chatbot-ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSession,
          chatbot_mode: newMode
        })
      });
      if (result.status === 'success') {
        window.showSuccess('Mode chatbot berhasil diperbarui.');
      } else {
        window.showError(result.message || 'Gagal memperbarui mode chatbot.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat mengubah mode chatbot.');
    }
  };

  const handleToggleActive = async () => {
    if (!selectedSession) return;
    const nextActiveState = !isActive;
    setIsActive(nextActiveState);

    try {
      const result = await apiRequest('/chatbot-ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSession,
          is_active: nextActiveState ? 1 : 0
        })
      });
      if (result.status === 'success') {
        window.showSuccess(`Status AI berhasil diubah menjadi ${nextActiveState ? 'AKTIF' : 'NON-AKTIF'}.`);
      } else {
        window.showError(result.message || 'Gagal mengubah status keaktifan AI.');
        setIsActive(isActive); // Revert state
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat mengubah status keaktifan AI.');
      setIsActive(isActive); // Revert state
    }
  };

  const handleTestConnection = async () => {
    const isLegacy = !selectedCredentialId;
    if (isLegacy && !apiKey && !hasStoredApiKey) {
      window.showWarning('Isi API Key terlebih dahulu untuk melakukan tes koneksi.');
      return;
    }

    setTesting(true);
    try {
      const payload = {
        session_id: selectedSession
      };

      if (selectedCredentialId) {
        payload.credential_id = parseInt(selectedCredentialId);
      } else {
        payload.base_url = baseUrl;
        payload.api_key = apiKey;
        payload.model_name = modelName;
      }

      const result = await apiRequest('/chatbot-ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result.status === 'success') {
        window.showSuccess('Koneksi sukses! API Key valid.');
        setSandboxMessages(prev => [
          ...prev,
          { role: 'assistant', content: `[Sistem] Uji koneksi API berhasil. Respon uji coba SumoPod AI: "${result.reply}"` }
        ]);
      } else {
        window.showError(result.message || 'Koneksi gagal.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat melakukan tes koneksi.');
    } finally {
      setTesting(false);
    }
  };

  const handleSandboxSend = async (e) => {
    e.preventDefault();
    if (!sandboxInput.trim()) return;

    const isLegacy = !selectedCredentialId;
    const activeCred = credentials.find(c => c.id === parseInt(selectedCredentialId));
    
    if (isLegacy && !apiKey && !hasStoredApiKey) {
      window.showWarning('Isi API Key SumoPod terlebih dahulu untuk menggunakan Sandbox.');
      return;
    }
    if (!isLegacy && activeCred && activeCred.is_active === 0) {
      window.showWarning('Kredensial yang dipilih berstatus NON-AKTIF. Aktifkan terlebih dahulu.');
      return;
    }

    const userMessage = sandboxInput.trim();
    setSandboxInput('');
    setSandboxMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setSimulating(true);

    try {
      const systemPrompt = [];
      if (systemInstruction) systemPrompt.push(systemInstruction);
      
      let testKb = '';
      if (knowledgeSource === 'manual') {
        testKb = knowledgeBase;
      } else if (knowledgeSource === 'flow') {
        testKb = flowsKnowledgeBase;
      } else if (knowledgeSource === 'both') {
        testKb = [knowledgeBase, flowsKnowledgeBase].filter(Boolean).join('\n\n');
      }

      if (testKb) {
        systemPrompt.push("Gunakan informasi berikut sebagai satu-satunya basis pengetahuan untuk menjawab pertanyaan pelanggan. Jika informasi tidak ada di basis pengetahuan ini, jawablah secara sopan bahwa Anda tidak mengetahuinya atau tawarkan bantuan lain:\n" + testKb);
      }
      const finalSystemPrompt = systemPrompt.join("\n\n");

      const payload = {
        session_id: selectedSession,
        system_prompt: finalSystemPrompt,
        prompt_override: `Instruksi Asisten:\n${finalSystemPrompt}\n\nPertanyaan Pengguna:\n${userMessage}`
      };

      if (selectedCredentialId) {
        payload.credential_id = parseInt(selectedCredentialId);
      } else {
        payload.base_url = baseUrl;
        payload.api_key = apiKey;
        payload.model_name = modelName;
      }

      const result = await apiRequest('/chatbot-ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result.status === 'success') {
        setSandboxMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      } else {
        setSandboxMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.message}` }]);
      }
    } catch (err) {
      console.error(err);
      const errMsg = err.payload?.message || err.message || 'Gagal terhubung dengan server simulator.';
      setSandboxMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
    } finally {
      setSimulating(false);
    }
  };

  const clearSandbox = () => {
    setSandboxMessages([
      { role: 'system', content: 'Sandbox Simulator diatur ulang. Silakan kirim pesan uji coba di bawah.' }
    ]);
  };

  return (
    <div className="dashboard-container chatbot-ai-page" style={{ paddingBottom: '40px' }}>
      <header className="dashboard-header" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
          }}>
            <Bot size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.875rem', fontWeight: 800, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>Chatbot AI</h1>
              <span style={{ 
                padding: '2px 8px', 
                borderRadius: '20px', 
                backgroundColor: 'rgba(99,102,241,0.1)', 
                color: 'var(--primary-color)', 
                fontSize: '0.75rem', 
                fontWeight: 700 
              }}>SUMOPOD API</span>
            </div>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Integrasikan asisten pintar berbasis model bahasa besar (LLM) untuk merespon pelanggan secara otomatis
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          borderRadius: 'var(--border-radius-md)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          color: '#ef4444',
          marginBottom: '20px'
        }}>
          <AlertCircle size={18} />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{error}</span>
        </div>
      )}

      {/* Sesi Pengirim Card */}
      <div className="card" style={{ marginBottom: '24px', backdropFilter: 'blur(16px)', background: 'var(--bg-card-glass)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={16} /> Pilih Sesi WhatsApp Aktif
          </label>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select 
              className="form-control" 
              value={selectedSession} 
              onChange={(e) => setSelectedSession(e.target.value)}
              style={{ flex: 2, margin: 0, minWidth: '200px' }}
            >
              <option value="">-- Hubungkan Device WhatsApp Terlebih Dahulu --</option>
              {sessions.map(s => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id} ({s.phone_number || 'Belum Terverifikasi'})
                </option>
              ))}
            </select>
            {selectedSession && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 3, minWidth: '320px', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mode Chatbot:</span>
                <select
                  className="form-control"
                  value={chatbotMode}
                  onChange={(e) => handleModeChange(e.target.value)}
                  style={{ width: '200px', margin: 0, fontSize: '0.825rem' }}
                >
                  <option value="off">Nonaktif (Matikan Chatbot)</option>
                  <option value="flow">Hanya Chatbot Flow (Kata Kunci)</option>
                  <option value="ai">Hanya Chatbot AI (Tanya Jawab Bebas)</option>
                  <option value="both">Kombinasi (Flow Utama + Fallback AI)</option>
                </select>

                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Status AI:</span>
                <button
                  type="button"
                  onClick={handleToggleActive}
                  style={{
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    background: isActive ? 'linear-gradient(135deg, #10b981, #059669)' : 'var(--border-color)',
                    color: 'white',
                    boxShadow: isActive ? '0 4px 12px rgba(16, 185, 129, 0.2)' : 'none'
                  }}
                >
                  {isActive ? 'AKTIF' : 'NON-AKTIF'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '24px',
        alignItems: 'stretch'
      }}>
        {/* Panel Kiri: Form Setelan AI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 0: Daftar Kredensial AI */}
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={18} className="text-primary" /> Daftar Kredensial AI
              </h3>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleOpenCredModal()}
                style={{ padding: '6px 12px', fontSize: '0.75rem', margin: 0 }}
              >
                + Tambah Kredensial
              </button>
            </div>

            {loadingCredentials ? (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '0.875rem' }}>Memuat list kredensial...</span>
              </div>
            ) : credentials.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Belum ada kredensial yang ditambahkan. Silakan klik tombol di atas untuk membuat kredensial baru.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 4px', fontWeight: 600 }}>Nama / Base URL</th>
                      <th style={{ padding: '8px 4px', fontWeight: 600 }}>Model Default</th>
                      <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credentials.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '10px 4px', fontWeight: 500, color: 'var(--text-main)' }}>
                          {c.name}
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{c.base_url}</div>
                        </td>
                        <td style={{ padding: '10px 4px', color: 'var(--text-muted)' }}>{c.model_name}</td>
                        <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleCredential(c.id)}
                            style={{
                              border: 'none',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: c.is_active === 1 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: c.is_active === 1 ? '#10b981' : '#ef4444',
                              transition: 'all 0.2s'
                            }}
                          >
                            {c.is_active === 1 ? 'Aktif' : 'Non-aktif'}
                          </button>
                        </td>
                        <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => handleOpenCredModal(c)}
                              style={{
                                border: '1px solid var(--border-color)',
                                background: 'transparent',
                                color: 'var(--text-main)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.6875rem',
                                cursor: 'pointer'
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCredential(c.id)}
                              style={{
                                border: 'none',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.6875rem',
                                cursor: 'pointer'
                              }}
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Card 1: Engine AI & API Credentials */}
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} className="text-primary" /> Kredensial &amp; Engine AI Sesi
            </h3>
            
            {loadingSettings ? (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '0.875rem' }}>Memuat kredensial...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Pilih Kredensial AI dari Daftar
                  </label>
                  <select
                    className="form-control"
                    value={selectedCredentialId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedCredentialId(val);
                      if (val) {
                        const selected = credentials.find(c => c.id === parseInt(val));
                        if (selected) {
                          setBaseUrl(selected.base_url);
                          setModelName(selected.model_name);
                        }
                      }
                    }}
                    disabled={!selectedSession}
                    style={{ fontSize: '0.85rem' }}
                  >
                    <option value="">-- Gunakan Kredensial Khusus Sesi (Legacy) --</option>
                    {credentials.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.is_active === 0 ? '(NON-AKTIF)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCredentialId ? (
                  (() => {
                    const selected = credentials.find(c => c.id === parseInt(selectedCredentialId));
                    return (
                      <div style={{ 
                        backgroundColor: 'rgba(255,255,255,0.02)', 
                        padding: '12px', 
                        borderRadius: 'var(--border-radius-md)', 
                        border: '1px dashed var(--border-color)',
                        fontSize: '0.8125rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Nama Kredensial:</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{selected?.name || '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Base URL:</span>
                          <span style={{ color: 'var(--text-main)' }}>{selected?.base_url || '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Model Default:</span>
                          <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{selected?.model_name || '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Status Kredensial:</span>
                          <span style={{ 
                            fontWeight: 600, 
                            color: selected?.is_active === 1 ? '#10b981' : '#ef4444' 
                          }}>
                            {selected?.is_active === 1 ? 'AKTIF' : 'NON-AKTIF'}
                          </span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                          Base URL API
                        </label>
                        <input 
                          type="text" 
                          className="form-control" 
                          placeholder="https://ai.sumopod.com/v1"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          required
                          disabled={!selectedSession}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                          Model Name
                        </label>
                        <select
                          className="form-control"
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                          disabled={!selectedSession}
                          style={{ fontSize: '0.85rem' }}
                        >
                          <option value="gpt-4o-mini">gpt-4o-mini (OpenAI Standar: $0.15/1M tokens - Sangat Direkomendasikan)</option>
                          <option value="MiniMax-M2.7-highspeed">MiniMax-M2.7-highspeed (Termurah: $0.02/1M tokens - Direkomendasikan)</option>
                          <option value="gemini/gemini-2.5-flash-lite">gemini-2.5-flash-lite (Gemini Ekonomis: $0.10/1M tokens)</option>
                          <option value="deepseek-v4-flash">deepseek-v4-flash (DeepSeek Ekonomis: $0.14/1M tokens)</option>
                          <option value="glm-5-turbo">glm-5-turbo (Zhipu AI Cepat: $0.10/1M tokens)</option>
                          <option value="gpt-5-nano">gpt-5-nano (OpenAI Ekonomis: $0.05/1M tokens)</option>
                          <option value="kimi-k2.6">kimi-k2.6 (Moonshot Ekonomis: $0.08/1M tokens)</option>
                          <option value="gemma-4-31b-it">gemma-4-31b-it (SumoPod Ekonomis: $0.12/1M tokens)</option>
                          <option value="gpt-4o">gpt-4o (Kemampuan Tinggi: $2.50/1M tokens)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                        <Key size={14} /> API Key SumoPod
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input 
                          type={showApiKey ? "text" : "password"} 
                          className="form-control" 
                          placeholder={hasStoredApiKey ? "API key tersimpan. Isi hanya untuk mengganti." : "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          style={{ paddingRight: '44px' }}
                          required
                          disabled={!selectedSession}
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px'
                          }}
                          disabled={!selectedSession}
                        >
                          {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {hasStoredApiKey && (
                        <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-muted)' }}>
                          API key tersimpan aman dari respons UI. Biarkan kosong untuk mempertahankan key lama.
                        </small>
                      )}
                    </div>
                  </>
                )}
                
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleTestConnection}
                    disabled={testing || !selectedSession || (!selectedCredentialId && !apiKey && !hasStoredApiKey)}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {testing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    Tes Koneksi API
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveCredentials}
                    disabled={savingCredentials || !selectedSession}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {savingCredentials ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Terapkan Kredensial Sesi
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Brain & Knowledge Base */}
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={18} className="text-primary" /> Basis Pengetahuan &amp; Persona AI
            </h3>

            {loadingSettings ? (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '0.875rem' }}>Memuat data pengetahuan...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Persona & System Instruction */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      <Sparkles size={14} className="text-secondary" /> System Prompt / Persona AI
                    </label>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Pandu karakter, kepribadian, dan batasan asisten AI Anda dalam merespon pesan.
                  </p>
                  <textarea 
                    className="form-control" 
                    rows="3" 
                    placeholder="Contoh: Bertindaklah sebagai admin penjualan toko KiddieWear yang ramah, sopan, dan persuasif. Gunakan bahasa kasual namun sopan. Selalu tawarkan bantuan lanjutan."
                    value={systemInstruction}
                    onChange={(e) => setSystemInstruction(e.target.value)}
                    disabled={!selectedSession}
                  />
                </div>

                {/* Knowledge Source Selection */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                    Sumber Basis Pengetahuan
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Pilih bagaimana asisten AI memperoleh informasi referensi bisnis.
                  </p>
                  <select
                    className="form-control"
                    value={knowledgeSource}
                    onChange={(e) => setKnowledgeSource(e.target.value)}
                    disabled={!selectedSession}
                    style={{ fontSize: '0.85rem' }}
                  >
                    <option value="manual">Hanya Basis Pengetahuan Manual (Teks di bawah)</option>
                    <option value="flow">Hanya Alur Chatbot (Otomatis dari Chatbot Flows Sesi Ini)</option>
                    <option value="both">Kombinasi (Teks Manual &amp; Alur Chatbot)</option>
                  </select>
                </div>

                {/* Manual Knowledge Base Textarea */}
                {knowledgeSource !== 'flow' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        <Database size={14} className="text-secondary" /> Basis Pengetahuan Manual (FAQ / Detail Bisnis)
                      </label>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Masukkan seluruh informasi FAQ bisnis Anda secara manual.
                    </p>
                    <textarea 
                      className="form-control" 
                      rows="5" 
                      placeholder="Tulis FAQ bisnis Anda di sini secara manual..."
                      value={knowledgeBase}
                      onChange={(e) => setKnowledgeBase(e.target.value)}
                      disabled={!selectedSession}
                      style={{ fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: '1.5' }}
                    />
                  </div>
                )}

                {/* Active Chatbot Flows resolved preview */}
                {['flow', 'both'].includes(knowledgeSource) && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                      Pratinjau Informasi dari Alur Chatbot (Otomatis)
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Berikut adalah informasi terstruktur yang diambil secara otomatis dari chatbot flows sesi ini yang berstatus AKTIF.
                    </p>
                    {flowsKnowledgeBase ? (
                      <textarea
                        className="form-control"
                        rows="6"
                        value={flowsKnowledgeBase}
                        readOnly
                        disabled={!selectedSession}
                        style={{ fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: '1.4', backgroundColor: 'rgba(0,0,0,0.1)', color: 'var(--text-muted)' }}
                      />
                    ) : (
                      <div style={{ padding: '12px', border: '1px dashed var(--border-color)', borderRadius: 'var(--border-radius-md)', fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                        Tidak ada alur chatbot aktif (ACTIVE) yang terikat dengan sesi ini.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 3: Setelan Respons WhatsApp & Tombol Simpan */}
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} className="text-primary" /> Setelan Respons WhatsApp
            </h3>

            {loadingSettings ? (
              <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '16px', alignItems: 'center' }}>
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Jeda Balasan (Detik)
                    </label>
                    <input 
                      type="number" 
                      className="form-control" 
                      min="0"
                      max="30"
                      value={delaySeconds}
                      onChange={(e) => setDelaySeconds(e.target.value)}
                      disabled={!selectedSession}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px' }}>
                    <input
                      type="checkbox"
                      id="showTyping"
                      checked={showTyping}
                      onChange={(e) => setShowTyping(e.target.checked)}
                      disabled={!selectedSession}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="showTyping" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer' }}>
                      Tampilkan Status "Sedang Mengetik..."
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveSettings}
                  disabled={savingSettings || !selectedSession}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', marginTop: '4px' }}
                >
                  {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Simpan Pengaturan Chatbot AI
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Panel Kanan: Sandbox Simulator */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)', 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column',
            padding: 0,
            overflow: 'hidden'
          }}>
            {/* Header Simulator */}
            <div style={{ 
              padding: '16px 20px', 
              borderBottom: '1px solid var(--border-color)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} className="text-secondary" /> Sandbox Simulator
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Uji respon asisten Anda secara terisolasi</span>
              </div>
              <button 
                type="button" 
                onClick={clearSandbox}
                style={{
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s'
                }}
              >
                Atur Ulang
              </button>
            </div>

            {/* Area Chat Bubbles */}
            <div style={{ 
              flex: 1, 
              padding: '20px', 
              overflowY: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
              minHeight: '440px',
              background: 'rgba(0,0,0,0.02)'
            }}>
              {sandboxMessages.map((msg, index) => {
                const isSystem = msg.role === 'system';
                const isUser = msg.role === 'user';

                if (isSystem) {
                  return (
                    <div key={index} style={{
                      alignSelf: 'center',
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      backgroundColor: 'rgba(0, 0, 0, 0.03)',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      maxWidth: '90%',
                      border: '1px solid var(--border-color)'
                    }}>
                      {msg.content}
                    </div>
                  );
                }

                return (
                  <div key={index} style={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start'
                  }}>
                    <div style={{
                      backgroundColor: isUser 
                        ? 'var(--primary-color)' 
                        : 'var(--bg-main)',
                      color: isUser ? 'white' : 'var(--text-main)',
                      padding: '10px 14px',
                      borderRadius: isUser 
                        ? '16px 16px 2px 16px' 
                        : '16px 16px 16px 2px',
                      fontSize: '0.875rem',
                      lineHeight: '1.45',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                      border: isUser ? 'none' : '1px solid var(--border-color)'
                    }}>
                      {msg.content}
                    </div>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px', padding: '0 4px' }}>
                      {isUser ? 'Anda' : 'Asisten AI'}
                    </span>
                  </div>
                );
              })}

              {simulating && (
                <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    backgroundColor: 'var(--bg-main)',
                    padding: '10px 16px',
                    borderRadius: '16px 16px 16px 2px',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: '4px'
                  }}>
                    <span className="dot-blink" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', display: 'inline-block' }}></span>
                    <span className="dot-blink" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', display: 'inline-block', animationDelay: '0.2s' }}></span>
                    <span className="dot-blink" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', display: 'inline-block', animationDelay: '0.4s' }}></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Simulator Form */}
            <form onSubmit={handleSandboxSend} style={{ 
              padding: '16px 20px', 
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <input 
                type="text" 
                className="form-control" 
                placeholder={(apiKey || hasStoredApiKey || selectedCredentialId) ? "Ketik pesan uji coba..." : "Pilih atau isi Kredensial AI terlebih dahulu..."}
                value={sandboxInput}
                onChange={(e) => setSandboxInput(e.target.value)}
                style={{ flex: 1, margin: 0 }}
                disabled={simulating || (!apiKey && !hasStoredApiKey && !selectedCredentialId)}
              />
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ 
                  margin: 0, 
                  padding: '0 16px', 
                  height: '42px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
                disabled={simulating || !sandboxInput.trim() || (!apiKey && !hasStoredApiKey && !selectedCredentialId)}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal Dialog Kredensial */}
      {showCredModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '500px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {editingCred ? 'Edit Kredensial AI' : 'Tambah Kredensial AI'}
            </h3>
            
            <form onSubmit={handleSaveCredential} style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: 0 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Nama Kredensial
                </label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="Contoh: SumoPod Official, Zhipu Pro"
                  value={credName}
                  onChange={(e) => setCredName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Base URL API
                </label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="https://ai.sumopod.com/v1"
                  value={credBaseUrl}
                  onChange={(e) => setCredBaseUrl(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  API Key
                </label>
                <div style={{ position: 'relative' }}>
                  <input 
                    type={showModalApiKey ? "text" : "password"} 
                    className="form-control" 
                    placeholder={editingCred && editingCred.has_api_key ? "API key tersimpan. Isi hanya untuk mengganti." : "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                    value={credApiKey}
                    onChange={(e) => setCredApiKey(e.target.value)}
                    style={{ paddingRight: '44px' }}
                    required={!editingCred}
                  />
                  <button
                    type="button"
                    onClick={() => setShowModalApiKey(!showModalApiKey)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px'
                    }}
                  >
                    {showModalApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Model Name
                </label>
                <select
                  className="form-control"
                  value={credModelName}
                  onChange={(e) => setCredModelName(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (OpenAI Standar - Sangat Direkomendasikan)</option>
                  <option value="MiniMax-M2.7-highspeed">MiniMax-M2.7-highspeed (Termurah - Direkomendasikan)</option>
                  <option value="gemini/gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                  <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                  <option value="glm-5-turbo">glm-5-turbo (Zhipu AI Cepat)</option>
                  <option value="gpt-5-nano">gpt-5-nano</option>
                  <option value="kimi-k2.6">kimi-k2.6</option>
                  <option value="gemma-4-31b-it">gemma-4-31b-it</option>
                  <option value="gpt-4o">gpt-4o</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="credIsActive"
                  checked={credIsActive}
                  onChange={(e) => setCredIsActive(e.target.checked)}
                  style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                />
                <label htmlFor="credIsActive" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer' }}>
                  Aktifkan Kredensial Ini
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCredModal(false)}
                  style={{ flex: 1, margin: 0 }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, margin: 0 }}
                >
                  Simpan Kredensial
                </button>
              </div>
            </form>
          </div>
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
}

export default ChatbotAI;
