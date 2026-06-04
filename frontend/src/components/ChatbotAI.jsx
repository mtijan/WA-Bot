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

function ChatbotAI({ API_URL }) {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  
  // AI Settings State
  const [isActive, setIsActive] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://ai.sumopod.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [modelName, setModelName] = useState('glm-5-turbo');
  const [systemInstruction, setSystemInstruction] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [showTyping, setShowTyping] = useState(true);
  
  // UI & Loading States
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  // Sandbox Simulator State
  const [sandboxMessages, setSandboxMessages] = useState([
    { role: 'system', content: 'Sandbox Simulator aktif. Silakan kirim pesan uji coba di bawah untuk menguji asisten AI Anda secara instan.' }
  ]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [simulating, setSimulating] = useState(false);
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchSessions();
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
      const res = await fetch(`${API_URL}/sessions`);
      const result = await res.json();
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
      const res = await fetch(`${API_URL}/chatbot-ai/settings/${sessionId}`);
      const result = await res.json();
      if (result.status === 'success' && result.data) {
        const d = result.data;
        setIsActive(d.is_active === 1);
        setBaseUrl(d.base_url || 'https://ai.sumopod.com/v1');
        setApiKey('');
        setHasStoredApiKey(Boolean(d.has_api_key));
        setModelName(d.model_name || 'gpt-4o-mini');
        setSystemInstruction(d.system_instruction || '');
        setKnowledgeBase(d.knowledge_base || '');
        setDelaySeconds(d.delay_seconds !== undefined ? d.delay_seconds : 2);
        setShowTyping(d.show_typing === 1);
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
    setModelName('glm-5-turbo');
    setSystemInstruction('');
    setKnowledgeBase('');
    setDelaySeconds(2);
    setShowTyping(true);
  };

  const handleSave = async () => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/chatbot-ai/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSession,
          is_active: isActive ? 1 : 0,
          base_url: baseUrl,
          api_key: apiKey,
          model_name: modelName,
          system_instruction: systemInstruction,
          knowledge_base: knowledgeBase,
          delay_seconds: parseInt(delaySeconds),
          show_typing: showTyping ? 1 : 0
        })
      });
      const result = await res.json();
      if (result.status === 'success') {
        if (apiKey) setHasStoredApiKey(true);
        setApiKey('');
        window.showSuccess('Pengaturan Chatbot AI berhasil disimpan.');
      } else {
        window.showError(result.message || 'Gagal menyimpan pengaturan.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat menyimpan pengaturan.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey) {
      window.showWarning('Isi API Key terlebih dahulu untuk melakukan tes koneksi.');
      return;
    }

    setTesting(true);
    try {
      const res = await fetch(`${API_URL}/chatbot-ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: apiKey,
          model_name: modelName
        })
      });
      const result = await res.json();
      if (result.status === 'success') {
        window.showSuccess('Koneksi sukses! API Key SumoPod valid.');
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

    if (!apiKey) {
      window.showWarning('Isi API Key SumoPod terlebih dahulu untuk menggunakan Sandbox.');
      return;
    }

    const userMessage = sandboxInput.trim();
    setSandboxInput('');
    setSandboxMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setSimulating(true);

    try {
      const systemPrompt = [];
      if (systemInstruction) systemPrompt.push(systemInstruction);
      if (knowledgeBase) {
        systemPrompt.push("Gunakan informasi berikut sebagai satu-satunya basis pengetahuan untuk menjawab pertanyaan pelanggan. Jika informasi tidak ada di basis pengetahuan ini, jawablah secara sopan bahwa Anda tidak mengetahuinya atau tawarkan bantuan lain:\n" + knowledgeBase);
      }
      const finalSystemPrompt = systemPrompt.join("\n\n");

      const res = await fetch(`${API_URL}/chatbot-ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: apiKey,
          model_name: modelName,
          system_prompt: finalSystemPrompt,
          prompt_override: `Instruksi Asisten:\n${finalSystemPrompt}\n\nPertanyaan Pengguna:\n${userMessage}`
        })
      });
      const result = await res.json();
      if (result.status === 'success') {
        setSandboxMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      } else {
        setSandboxMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.message}` }]);
      }
    } catch (err) {
      console.error(err);
      setSandboxMessages(prev => [...prev, { role: 'assistant', content: 'Gagal terhubung dengan server simulator.' }]);
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
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <select 
              className="form-control" 
              value={selectedSession} 
              onChange={(e) => setSelectedSession(e.target.value)}
              style={{ flex: 1, margin: 0 }}
            >
              <option value="">-- Hubungkan Device WhatsApp Terlebih Dahulu --</option>
              {sessions.map(s => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id} ({s.phone_number || 'Belum Terverifikasi'})
                </option>
              ))}
            </select>
            {selectedSession && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-muted)' }}>Status AI:</span>
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
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
        {/* Panel Kiri: Form Setelan AI (Dipisah menjadi 3 Card Premium) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 1: Engine AI & API Credentials */}
          <div className="card" style={{ 
            backdropFilter: 'blur(16px)', 
            background: 'var(--bg-card-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} className="text-primary" /> Kredensial &amp; Engine AI
            </h3>
            
            {loadingSettings ? (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '0.875rem' }}>Memuat kredensial...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                      <option value="glm-5-turbo">glm-5-turbo (Zhipu AI Cepat &amp; Handal: $0.10/1M tokens)</option>
                      <option value="MiniMax-M2.7-highspeed">MiniMax-M2.7-highspeed (Termurah: $0.02/1M tokens)</option>
                      <option value="gpt-5-nano">gpt-5-nano (OpenAI Ekonomis: $0.05/1M tokens)</option>
                      <option value="kimi-k2.6">kimi-k2.6 (Moonshot Ekonomis: $0.08/1M tokens)</option>
                      <option value="gemini/gemini-2.5-flash-lite">gemini-2.5-flash-lite (Gemini Ekonomis: $0.10/1M tokens)</option>
                      <option value="gemma-4-31b-it">gemma-4-31b-it (SumoPod Ekonomis: $0.12/1M tokens)</option>
                      <option value="deepseek-v4-flash">deepseek-v4-flash (DeepSeek Ekonomis: $0.14/1M tokens)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini (OpenAI Standar: $0.15/1M tokens)</option>
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
                
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleTestConnection}
                  disabled={testing || !selectedSession || !apiKey}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}
                >
                  {testing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Tes Koneksi API
                </button>
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

                {/* Knowledge Base */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      <Database size={14} className="text-secondary" /> Basis Pengetahuan (Knowledge Base)
                    </label>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Masukkan seluruh informasi operasional bisnis, FAQ, daftar harga, dan detail produk sebagai referensi AI.
                  </p>
                  <textarea 
                    className="form-control" 
                    rows="6" 
                    placeholder="Tulis informasi FAQ bisnis Anda di sini, contoh:&#10;- Nama Toko: KiddieWear Indonesia&#10;- Jam Operasional: Setiap hari jam 08:00 - 20:00 WIB&#10;- Lokasi Gudang: Jalan Melati No. 45, Jakarta Selatan&#10;- Kebijakan Garansi: Pengembalian barang maksimal 3 hari sejak diterima jika ada defect produksi."
                    value={knowledgeBase}
                    onChange={(e) => setKnowledgeBase(e.target.value)}
                    disabled={!selectedSession}
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: '1.5' }}
                  />
                </div>
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
                  onClick={handleSave}
                  disabled={saving || !selectedSession}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', marginTop: '4px' }}
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
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
                placeholder={apiKey ? "Ketik pesan uji coba..." : "Isi API Key di sebelah kiri untuk mencoba..."}
                value={sandboxInput}
                onChange={(e) => setSandboxInput(e.target.value)}
                style={{ flex: 1, margin: 0 }}
                disabled={simulating || !apiKey}
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
                disabled={simulating || !sandboxInput.trim() || !apiKey}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatbotAI;
