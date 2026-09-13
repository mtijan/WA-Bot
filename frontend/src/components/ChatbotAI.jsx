import { useState, useEffect, useRef } from 'react';
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
  MessageSquare,
  RefreshCw,
  Sliders,
  Search,
  CheckCircle2,
  Layers,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Settings
} from 'lucide-react';
import { apiRequest } from '../apiClient';

function ChatbotAI() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');

  // Navigation Tab State
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'rag'

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

  // RAG Configuration State
  const [ragMode, setRagMode] = useState('off');
  const [ragTopK, setRagTopK] = useState(4);
  const [ragContextTokens, setRagContextTokens] = useState(1200);
  const [ragInputBudgetTokens, setRagInputBudgetTokens] = useState(30000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(512);
  const [temperature, setTemperature] = useState(0.3);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheTtlSeconds, setCacheTtlSeconds] = useState(86400);
  const [directAnswerEnabled, setDirectAnswerEnabled] = useState(true);
  const [debounceMs, setDebounceMs] = useState(3000);

  // RAG Index Status State
  const [ragStatus, setRagStatus] = useState(null);
  const [loadingRagStatus, setLoadingRagStatus] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // Embedding Profile & Generation State
  const [showEmbeddingModal, setShowEmbeddingModal] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [embeddingDimensions, setEmbeddingDimensions] = useState(1536);
  const [embeddingCredId, setEmbeddingCredId] = useState('');
  const [savingEmbeddingProfile, setSavingEmbeddingProfile] = useState(false);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState(null);
  const [generatingEmbeddings, setGeneratingEmbeddings] = useState(false);

  // RAG Test Retrieval State
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalMode, setRetrievalMode] = useState('hybrid');
  const [retrievalTopK, setRetrievalTopK] = useState(4);
  const [retrievalThreshold] = useState(0.4);
  const [retrievalResult, setRetrievalResult] = useState(null);
  const [testingRetrieval, setTestingRetrieval] = useState(false);

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
    { role: 'system', content: 'Sandbox Simulator aktif. Pilih mode pengujian (Dengan RAG atau Tanpa RAG), lalu kirim pesan untuk menguji asisten AI Anda.' }
  ]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [sandboxUseRag, setSandboxUseRag] = useState(true);
  const [expandedChunkMsgIndex, setExpandedChunkMsgIndex] = useState(null);
  const [ragRightPanelTab, setRagRightPanelTab] = useState('simulator'); // 'simulator' | 'retrieval'

  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchSessions();
    fetchCredentials();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      fetchAISettings(selectedSession);
      fetchRagStatus(selectedSession);
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

        // RAG Settings
        setRagMode(d.rag_mode || 'off');
        setRagTopK(d.rag_top_k !== undefined ? Number(d.rag_top_k) : 4);
        setRagContextTokens(d.rag_context_tokens !== undefined ? Number(d.rag_context_tokens) : 1200);
        setRagInputBudgetTokens(d.rag_input_budget_tokens !== undefined ? Number(d.rag_input_budget_tokens) : 3000);
        setMaxOutputTokens(d.max_output_tokens !== undefined ? Number(d.max_output_tokens) : 512);
        setTemperature(d.temperature !== undefined ? Number(d.temperature) : 0.3);
        setCacheEnabled(d.cache_enabled === 1 || d.cache_enabled === true);
        setCacheTtlSeconds(d.cache_ttl_seconds !== undefined ? Number(d.cache_ttl_seconds) : 86400);
        setDirectAnswerEnabled(d.direct_answer_enabled === 1 || d.direct_answer_enabled === true || d.direct_answer_enabled === undefined);
        setDebounceMs(d.debounce_ms !== undefined ? Number(d.debounce_ms) : 3000);
      }
    } catch (err) {
      console.error(err);
      setError('Gagal memuat pengaturan Chatbot AI.');
    } finally {
      setLoadingSettings(false);
    }
  };

  const fetchRagStatus = async (sessionId) => {
    if (!sessionId) return;
    setLoadingRagStatus(true);
    try {
      const result = await apiRequest(`/chatbot-ai/rag/${sessionId}/status`);
      if (result.status === 'success' && result.data) {
        setRagStatus(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch RAG status:', err);
    } finally {
      setLoadingRagStatus(false);
    }
  };

  const handleReindex = async () => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }
    setReindexing(true);
    try {
      const result = await apiRequest(`/chatbot-ai/rag/${selectedSession}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      if (result.status === 'success') {
        window.showSuccess('Job reindex berhasil dijadwalkan ke antrean sistem.');
        fetchRagStatus(selectedSession);
      } else {
        window.showError(result.message || 'Gagal memicu proses reindex.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat memicu proses reindex.');
    } finally {
      setReindexing(false);
    }
  };

  const fetchEmbeddingProfile = async () => {
    try {
      const result = await apiRequest('/chatbot-ai/rag/embedding-profile');
      if (result.status === 'success' && result.data) {
        const d = result.data;
        if (d.model) setEmbeddingModel(d.model);
        if (d.dimensions) setEmbeddingDimensions(d.dimensions);
        if (d.credential_id) setEmbeddingCredId(d.credential_id);
      }
    } catch (err) {
      console.error('Failed to fetch embedding profile:', err);
    }
  };

  const handleTestEmbedding = async () => {
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      const result = await apiRequest('/chatbot-ai/rag/embedding-profile/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential_id: embeddingCredId ? Number(embeddingCredId) : undefined,
          model: embeddingModel,
          dimensions: Number(embeddingDimensions)
        })
      });
      if (result.status === 'success' && result.data?.capabilityStatus === 'SUPPORTED') {
        setEmbeddingTestResult({ success: true, message: 'Koneksi embedding berhasil dan didukung!' });
      } else {
        setEmbeddingTestResult({
          success: false,
          message: result.data?.error || result.message || 'Uji koneksi embedding gagal.'
        });
      }
    } catch {
      setEmbeddingTestResult({ success: false, message: 'Kesalahan jaringan saat menguji koneksi embedding.' });
    } finally {
      setTestingEmbedding(false);
    }
  };

  const handleSaveEmbeddingProfile = async (e) => {
    if (e) e.preventDefault();
    setSavingEmbeddingProfile(true);
    try {
      const result = await apiRequest('/chatbot-ai/rag/embedding-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential_id: embeddingCredId ? Number(embeddingCredId) : null,
          model: embeddingModel,
          dimensions: Number(embeddingDimensions),
          test_capability: true
        })
      });
      if (result.status === 'success') {
        window.showSuccess('Profil model embedding berhasil disimpan.');
        setShowEmbeddingModal(false);
        if (selectedSession) {
          fetchRagStatus(selectedSession);
        }
      } else {
        window.showError(result.message || 'Gagal menyimpan profil embedding.');
      }
    } catch (err) {
      window.showError(err.message || 'Kesalahan jaringan saat menyimpan profil embedding.');
    } finally {
      setSavingEmbeddingProfile(false);
    }
  };

  const handleGenerateEmbeddings = async () => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }

    const chunkCount = ragStatus?.chunks_count || 0;
    const estTokens = chunkCount * 200;
    const estCostRupiah = Math.max(1, Math.round((estTokens / 1000000) * 0.02 * 16000));

    triggerConfirm(
      'Generate Vektor Embedding Terkontrol',
      `Sistem akan mengonversi ${chunkCount} potongan dokumen (chunk) menjadi vektor semantik menggunakan model ${embeddingModel || 'text-embedding-3-small'}. Estimasi penggunaan: ~${estTokens.toLocaleString('id-ID')} token (biaya sangat murah: ~Rp ${estCostRupiah}). Lanjutkan proses?`,
      'Mulai Generate Vektor',
      'btn-primary',
      async () => {
        setGeneratingEmbeddings(true);
        try {
          const result = await apiRequest(`/chatbot-ai/rag/${selectedSession}/generate-embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false })
          });
          if (result.status === 'success') {
            window.showSuccess(result.message || `Berhasil memproses ${result.data?.processed_chunks || 0} chunk vektor.`);
            fetchRagStatus(selectedSession);
          } else {
            window.showError(result.message || 'Gagal menghasilkan vektor embedding.');
          }
        } catch (err) {
          console.error(err);
          window.showError('Kesalahan jaringan saat menghasilkan vektor embedding.');
        } finally {
          setGeneratingEmbeddings(false);
        }
      }
    );
  };

  const handleTestRetrieval = async (e) => {
    if (e) e.preventDefault();
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }
    if (!retrievalQuery.trim()) {
      window.showWarning('Ketik query pencarian uji coba terlebih dahulu.');
      return;
    }
    setTestingRetrieval(true);
    try {
      const result = await apiRequest(`/chatbot-ai/rag/${selectedSession}/test-retrieval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: retrievalQuery.trim(),
          mode: retrievalMode,
          top_k: Number(retrievalTopK),
          relevance_threshold: Number(retrievalThreshold)
        })
      });
      if (result.status === 'success' && result.data) {
        setRetrievalResult(result.data);
        window.showSuccess(`Uji retrieval selesai dalam ${result.data.retrieval_latency_ms || 0}ms (${result.data.selected_count || 0} chunk terpilih).`);
      } else {
        window.showError(result.message || 'Gagal menjalankan uji retrieval.');
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat menjalankan uji retrieval.');
    } finally {
      setTestingRetrieval(false);
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
    setRagMode('off');
    setRagTopK(4);
    setRagContextTokens(1200);
    setRagInputBudgetTokens(3000);
    setMaxOutputTokens(512);
    setTemperature(0.3);
    setCacheEnabled(false);
    setCacheTtlSeconds(86400);
    setDirectAnswerEnabled(true);
    setDebounceMs(3000);
    setRagStatus(null);
    setRetrievalResult(null);
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
          chatbot_mode: chatbotMode,
          rag_mode: ragMode,
          rag_top_k: Number(ragTopK),
          rag_context_tokens: Number(ragContextTokens),
          rag_input_budget_tokens: Number(ragInputBudgetTokens),
          max_output_tokens: Number(maxOutputTokens),
          temperature: Number(temperature),
          cache_enabled: cacheEnabled ? 1 : 0,
          cache_ttl_seconds: Number(cacheTtlSeconds),
          direct_answer_enabled: directAnswerEnabled ? 1 : 0,
          debounce_ms: Number(debounceMs)
        })
      });
      if (result.status === 'success') {
        window.showSuccess('Pengaturan Chatbot AI & RAG berhasil disimpan.');
        fetchAISettings(selectedSession);
        fetchRagStatus(selectedSession);
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

  const handleToggleRagMode = async (targetMode) => {
    if (!selectedSession) {
      window.showWarning('Pilih sesi WhatsApp terlebih dahulu.');
      return;
    }
    const nextMode = targetMode !== undefined ? targetMode : (ragMode === 'off' ? 'hybrid' : 'off');
    const prevMode = ragMode;
    setRagMode(nextMode);

    try {
      const result = await apiRequest('/chatbot-ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSession,
          rag_mode: nextMode
        })
      });
      if (result.status === 'success') {
        const modeLabel = nextMode === 'off'
          ? 'NON-RAG (Standar Prompt AI)'
          : (nextMode === 'fts' ? 'RAG AKTIF (Pencarian Kata Kunci FTS5)' : 'RAG AKTIF (Hybrid: Semantik + Kata Kunci)');
        window.showSuccess(`Metode basis pengetahuan sesi diubah: ${modeLabel}.`);
        fetchRagStatus(selectedSession);
      } else {
        window.showError(result.message || 'Gagal mengubah mode RAG.');
        setRagMode(prevMode);
      }
    } catch (err) {
      console.error(err);
      window.showError('Kesalahan jaringan saat mengubah mode RAG.');
      setRagMode(prevMode);
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
        session_id: selectedSession,
        test_kind: 'connection'
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
          { role: 'assistant', content: `[Sistem] Uji koneksi API berhasil. Respon uji coba SumoPod AI: "${result.data?.reply}"` }
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

      // Jika mode TANPA RAG, sertakan basis pengetahuan langsung di system prompt
      if (!sandboxUseRag) {
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
      }
      const finalSystemPrompt = systemPrompt.join("\n\n");

      const payload = {
        session_id: selectedSession,
        test_kind: 'sandbox',
        system_prompt: finalSystemPrompt,
        user_message: userMessage,
        use_rag: Boolean(sandboxUseRag),
        rag_mode: ragMode === 'off' ? 'fts' : ragMode,
        rag_top_k: Number(ragTopK || 4),
        rag_context_tokens: Number(ragContextTokens || 1200),
        max_output_tokens: Number(maxOutputTokens || 512),
        temperature: Number(temperature !== undefined ? temperature : 0.3)
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
        setSandboxMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: result.data?.reply,
            rag_info: result.data?.rag_info
          }
        ]);
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
      { role: 'system', content: 'Sandbox Simulator diatur ulang. Silakan pilih mode pengujian di bawah (Dengan RAG atau Tanpa RAG), lalu kirim pesan untuk menguji asisten AI Anda.' }
    ]);
  };

  const renderSandboxSimulator = () => {
    return (
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
          flexDirection: 'column',
          gap: '12px',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} className="text-secondary" /> Sandbox Simulator
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Uji respon asisten AI Anda secara interaktif</span>
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
              Atur Ulang Chat
            </button>
          </div>

          {/* Toggle Pilihan Mode: Tanpa RAG vs Dengan RAG */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.04)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                Metode AI:
              </span>
              <div style={{ display: 'inline-flex', background: 'var(--bg-main)', borderRadius: '6px', padding: '2px', border: '1px solid var(--border-color)' }}>
                <button
                  type="button"
                  onClick={() => setSandboxUseRag(false)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: !sandboxUseRag ? 'var(--primary-color)' : 'transparent',
                    color: !sandboxUseRag ? '#ffffff' : 'var(--text-muted)',
                    transition: 'all 0.2s'
                  }}
                >
                  Tanpa RAG (Standar AI)
                </button>
                <button
                  type="button"
                  onClick={() => setSandboxUseRag(true)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: sandboxUseRag ? 'var(--primary-color)' : 'transparent',
                    color: sandboxUseRag ? '#ffffff' : 'var(--text-muted)',
                    transition: 'all 0.2s'
                  }}
                >
                  Dengan RAG (Knowledge Retrieval)
                </button>
              </div>
            </div>

            {/* Keterangan parameter aktif */}
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
              {sandboxUseRag ? (
                <span>
                  Mode: <strong style={{ color: 'var(--text-main)' }}>{ragMode === 'off' ? 'FTS (Preview)' : ragMode.toUpperCase()}</strong> | Top-K: <strong style={{ color: 'var(--text-main)' }}>{ragTopK}</strong> | Temp: <strong style={{ color: 'var(--text-main)' }}>{temperature}</strong>
                </span>
              ) : (
                <span>
                  Prompt Langsung: <strong style={{ color: 'var(--text-main)' }}>{knowledgeSource.toUpperCase()}</strong> | Temp: <strong style={{ color: 'var(--text-main)' }}>{temperature}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Area Chat Bubbles */}
        <div style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          minHeight: '440px',
          maxHeight: '620px',
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

            const isExpanded = expandedChunkMsgIndex === index;
            const hasRagChunks = msg.rag_info?.used_rag && msg.rag_info.chunks && msg.rag_info.chunks.length > 0;

            return (
              <div key={index} style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
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
                  border: isUser ? 'none' : '1px solid var(--border-color)',
                  whiteSpace: 'pre-wrap'
                }}>
                  {msg.content}
                </div>

                {/* Metadata Badge & Info RAG */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', padding: '0 4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    {isUser ? 'Anda' : 'Asisten AI'}
                  </span>

                  {!isUser && msg.rag_info && (
                    <>
                      {msg.rag_info.used_rag ? (
                        <span style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(16, 185, 129, 0.1)',
                          color: '#10b981',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <Database size={10} /> RAG ({msg.rag_info.chunks_found || 0} Chunks, {msg.rag_info.latency_ms || 0}ms)
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '0.6875rem',
                          fontWeight: 500,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(100, 116, 139, 0.1)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-color)'
                        }}>
                          Tanpa RAG (Standar)
                        </span>
                      )}

                      {hasRagChunks && (
                        <button
                          type="button"
                          onClick={() => setExpandedChunkMsgIndex(isExpanded ? null : index)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '0 4px',
                            color: 'var(--primary-color)',
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px'
                          }}
                        >
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {isExpanded ? 'Tutup Dokumen' : `Lihat ${msg.rag_info.chunks.length} Dokumen RAG`}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Accordion List Chunks RAG yang Dipakai */}
                {!isUser && hasRagChunks && isExpanded && (
                  <div style={{
                    marginTop: '8px',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '10px',
                    background: 'rgba(0, 0, 0, 0.03)',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '8px'
                  }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '2px' }}>
                      Dokumen Terpilih untuk Jawaban Ini:
                    </div>
                    {msg.rag_info.chunks.map((chunk, cIdx) => (
                      <div key={cIdx} style={{
                        padding: '8px',
                        borderRadius: '6px',
                        background: 'var(--bg-main)',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ color: 'var(--primary-color)' }}>
                            #{cIdx + 1} {chunk.source_title}
                          </strong>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            Skor: {chunk.score} ({chunk.token_count} tokens)
                          </span>
                        </div>
                        <div style={{
                          color: 'var(--text-main)',
                          fontFamily: 'monospace',
                          fontSize: '0.6875rem',
                          maxHeight: '120px',
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          background: 'rgba(0,0,0,0.02)',
                          padding: '4px 6px',
                          borderRadius: '4px'
                        }}>
                          {chunk.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
            placeholder={(apiKey || hasStoredApiKey || selectedCredentialId) ? (sandboxUseRag ? "Ketik pertanyaan untuk diuji dengan mesin RAG..." : "Ketik pesan uji coba (Tanpa RAG)...") : "Pilih atau isi Kredensial AI terlebih dahulu..."}
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
    );
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 3, minWidth: '320px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mode Chatbot:</span>
                <select
                  className="form-control"
                  value={chatbotMode}
                  onChange={(e) => handleModeChange(e.target.value)}
                  style={{ width: '180px', margin: 0, fontSize: '0.825rem' }}
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

                {/* Tombol Langsung RAG vs Non-RAG untuk Sesi */}
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Metode RAG:</span>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '20px',
                  padding: '2px',
                  border: '1px solid var(--border-color)'
                }}>
                  <button
                    type="button"
                    onClick={() => handleToggleRagMode('off')}
                    title="Non-RAG: AI merespon berdasarkan teks prompt tanpa mencari potongan dokumen"
                    style={{
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: '16px',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      background: ragMode === 'off' ? 'var(--bg-card)' : 'transparent',
                      color: ragMode === 'off' ? 'var(--text-main)' : 'var(--text-muted)',
                      boxShadow: ragMode === 'off' ? '0 2px 6px rgba(0, 0, 0, 0.2)' : 'none'
                    }}
                  >
                    Non-RAG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleRagMode('hybrid')}
                    title="RAG Aktif: AI otomatis mencari potongan dokumen relevan di database"
                    style={{
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: '16px',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      background: ragMode !== 'off' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                      color: ragMode !== 'off' ? 'white' : 'var(--text-muted)',
                      boxShadow: ragMode !== 'off' ? '0 2px 8px rgba(37, 99, 235, 0.3)' : 'none'
                    }}
                  >
                    RAG Aktif
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px'
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'general' ? 'var(--primary-color)' : 'transparent',
            color: activeTab === 'general' ? 'white' : 'var(--text-muted)'
          }}
        >
          <Bot size={18} />
          Asisten &amp; Model AI
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('rag');
            if (selectedSession) fetchRagStatus(selectedSession);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'rag' ? 'var(--primary-color)' : 'transparent',
            color: activeTab === 'rag' ? 'white' : 'var(--text-muted)'
          }}
        >
          <Database size={18} />
          Optimasi Hybrid RAG &amp; Indeks
          {ragStatus && (
            <span style={{
              fontSize: '0.6875rem',
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: ragStatus.index_ready ? '#10b981' : (ragStatus.rag_mode === 'off' ? 'rgba(255,255,255,0.1)' : '#f59e0b'),
              color: 'white',
              fontWeight: 700
            }}>
              {ragStatus.rag_mode === 'off' ? 'OFF' : (ragStatus.index_ready ? 'READY' : 'INDEXING')}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'general' && (
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
                {/* Banner & Tombol Langsung: RAG vs Non-RAG untuk Sesi Ini */}
                <div style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--border-radius-md)',
                  background: ragMode === 'off' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(59, 130, 246, 0.08)',
                  border: ragMode === 'off' ? '1px solid var(--border-color)' : '1px solid rgba(59, 130, 246, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '480px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Layers size={16} className={ragMode !== 'off' ? 'text-primary' : 'text-muted'} />
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        Metode Pengetahuan: {ragMode === 'off' ? 'Non-RAG (Standar Prompt AI)' : 'RAG Aktif (Pencarian Cerdas Dokumen)'}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                      {ragMode === 'off'
                        ? 'Model AI membaca seluruh prompt & FAQ secara langsung tanpa mencari dokumen. Cocok untuk instruksi ringkas.'
                        : 'Model AI mencari potongan dokumen relevan di database secara otomatis sebelum merespon. Menghemat kuota token & mencegah halusinasi.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      display: 'inline-flex',
                      background: 'var(--bg-main)',
                      borderRadius: '8px',
                      padding: '3px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <button
                        type="button"
                        onClick={() => handleToggleRagMode('off')}
                        disabled={!selectedSession}
                        style={{
                          border: 'none',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          background: ragMode === 'off' ? 'var(--bg-card)' : 'transparent',
                          color: ragMode === 'off' ? 'var(--text-main)' : 'var(--text-muted)',
                          boxShadow: ragMode === 'off' ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
                          transition: 'all 0.2s'
                        }}
                      >
                        Gunakan Non-RAG
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleRagMode('hybrid')}
                        disabled={!selectedSession}
                        style={{
                          border: 'none',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          background: ragMode !== 'off' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                          color: ragMode !== 'off' ? 'white' : 'var(--text-muted)',
                          boxShadow: ragMode !== 'off' ? '0 2px 8px rgba(37,99,235,0.3)' : 'none',
                          transition: 'all 0.2s'
                        }}
                      >
                        Aktifkan RAG
                      </button>
                    </div>
                  </div>
                </div>

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
          {renderSandboxSimulator()}
        </div>
      </div>
      )}

      {/* Tab 2: Optimasi Hybrid RAG & Indeks */}
      {activeTab === 'rag' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: '24px',
          alignItems: 'start'
        }}>
          {/* Panel Kiri RAG: Status & Konfigurasi */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Card Status Sinkronisasi & Indeks RAG (RAG-0808) */}
            <div className="card" style={{
              backdropFilter: 'blur(16px)',
              background: 'var(--bg-card-glass)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Database size={18} className="text-primary" /> Status Sinkronisasi &amp; Indeks RAG
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => handleToggleRagMode(ragMode === 'off' ? 'hybrid' : 'off')}
                    disabled={!selectedSession}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      fontSize: '0.8125rem',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: ragMode === 'off' ? '1px solid var(--border-color)' : 'none',
                      background: ragMode === 'off' ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #10b981, #059669)',
                      color: ragMode === 'off' ? 'var(--text-muted)' : 'white',
                      transition: 'all 0.2s ease',
                      boxShadow: ragMode !== 'off' ? '0 2px 8px rgba(16,185,129,0.3)' : 'none'
                    }}
                    title={ragMode === 'off' ? 'Klik untuk mengaktifkan RAG pada sesi ini' : 'Klik untuk menonaktifkan RAG dan kembali ke Non-RAG'}
                  >
                    <Layers size={14} />
                    {ragMode === 'off' ? 'Aktifkan RAG Sesi Ini' : 'Matikan RAG (Gunakan Non-RAG)'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleReindex}
                    disabled={reindexing || !selectedSession}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      fontSize: '0.8125rem',
                      margin: 0
                    }}
                  >
                    <RefreshCw size={14} className={reindexing ? 'animate-spin' : ''} />
                    {reindexing ? 'Memproses Indexing...' : 'Reindex Basis Pengetahuan'}
                  </button>
                </div>
              </div>

              {loadingRagStatus ? (
                <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                  <Loader2 size={24} className="animate-spin" />
                  <span style={{ fontSize: '0.875rem' }}>Memeriksa status kesiapan indeks...</span>
                </div>
              ) : !selectedSession ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  Pilih sesi WhatsApp aktif di atas untuk melihat status indeks RAG.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Grid 4 Kartu Status */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                    {/* Kartu 1: Status Kesiapan */}
                    <div style={{ padding: '12px', borderRadius: 'var(--border-radius-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Status Kesiapan</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: ragStatus?.rag_mode === 'off'
                            ? '#94a3b8'
                            : (ragStatus?.active_job && ['PENDING', 'RUNNING'].includes(ragStatus.active_job.status)
                              ? '#f59e0b'
                              : (ragStatus?.index_ready ? '#10b981' : (ragStatus?.operational_ready ? '#10b981' : '#f59e0b')))
                        }} />
                        <span style={{
                          fontSize: '0.875rem',
                          fontWeight: 700,
                          color: ragStatus?.rag_mode === 'off'
                            ? 'var(--text-muted)'
                            : (ragStatus?.active_job && ['PENDING', 'RUNNING'].includes(ragStatus.active_job.status)
                              ? '#f59e0b'
                              : (ragStatus?.index_ready ? '#10b981' : (ragStatus?.operational_ready ? '#10b981' : '#f59e0b')))
                        }}>
                          {ragStatus?.rag_mode === 'off'
                            ? 'NONAKTIF'
                            : (ragStatus?.active_job && ['PENDING', 'RUNNING'].includes(ragStatus.active_job.status)
                              ? 'MEMPROSES INDEKS'
                              : (ragStatus?.index_ready
                                ? 'SIAP PAKAI (FULL)'
                                : (ragStatus?.operational_ready ? 'SIAP PAKAI (LEKSIKAL)' : 'BELUM DIINDEKS')))}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {ragStatus?.rag_mode === 'off'
                          ? 'RAG Dimatikan'
                          : (ragStatus?.operational_ready && !ragStatus?.index_ready
                            ? 'Pencarian Kata Kunci Aktif'
                            : `Mode: ${ragStatus?.rag_mode?.toUpperCase() || 'OFF'}`)}
                      </div>
                    </div>

                    {/* Kartu 2: Leksikal (FTS5) */}
                    <div style={{ padding: '12px', borderRadius: 'var(--border-radius-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Leksikal (FTS5)</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 700, color: ragStatus?.lexical_ready ? '#10b981' : 'var(--text-muted)' }}>
                        {ragStatus?.lexical_ready ? 'READY (AKTIF)' : (ragStatus?.sources_count === 0 ? 'KOSONG' : 'PENDING')}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>Kata Kunci Cepat (0 Biaya)</div>
                    </div>

                    {/* Kartu 3: Vektor (Embedding) */}
                    <div style={{ padding: '12px', borderRadius: 'var(--border-radius-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Vektor (Embedding)</div>
                        <div style={{
                          fontSize: '0.875rem',
                          fontWeight: 700,
                          color: ragStatus?.embedding_ready
                            ? '#10b981'
                            : (ragMode === 'fts' ? 'var(--text-muted)' : (ragStatus?.has_embedding_profile ? '#f59e0b' : '#3b82f6'))
                        }}>
                          {ragStatus?.embedding_ready
                            ? 'READY (AKTIF)'
                            : (ragMode === 'fts'
                              ? 'DILEWATI (FTS)'
                              : (ragStatus?.has_embedding_profile ? 'BELUM DIGENERATE' : 'OPSIONAL (NONAKTIF)'))}
                        </div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {ragStatus?.embedding_ready
                            ? 'Semantik Vektor Siap'
                            : (ragMode === 'fts'
                              ? 'Mode Kata Kunci Aktif'
                              : (ragStatus?.has_embedding_profile ? 'Perlu Generate Vektor' : 'Perlu API Embedding'))}
                        </div>
                      </div>

                      {/* Tombol Kontrol Terkontrol untuk Embedding */}
                      <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleGenerateEmbeddings}
                          disabled={generatingEmbeddings || !selectedSession}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.6875rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            margin: 0,
                            borderRadius: '4px',
                            background: ragStatus?.embedding_ready ? 'rgba(16,185,129,0.15)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                            color: ragStatus?.embedding_ready ? '#10b981' : 'white',
                            border: ragStatus?.embedding_ready ? '1px solid rgba(16,185,129,0.3)' : 'none'
                          }}
                          title={ragStatus?.embedding_ready ? 'Generate ulang vektor embedding' : 'Konversi dokumen menjadi vektor embedding terkontrol'}
                        >
                          {generatingEmbeddings ? <Loader2 size={11} className="animate-spin" /> : <Cpu size={11} />}
                          {generatingEmbeddings ? 'Memproses...' : (ragStatus?.embedding_ready ? 'Re-generate Vektor' : 'Generate Vektor')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => {
                            fetchEmbeddingProfile();
                            setShowEmbeddingModal(true);
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.6875rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            margin: 0,
                            borderRadius: '4px'
                          }}
                          title="Atur model embedding dan kredensial API"
                        >
                          <Settings size={11} />
                          Atur Model
                        </button>
                      </div>
                    </div>

                    {/* Kartu 4: Indeks Tersimpan */}
                    <div style={{ padding: '12px', borderRadius: 'var(--border-radius-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Indeks Tersimpan</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {ragStatus?.sources_count || 0} Sumber / {ragStatus?.chunks_count || 0} Chunks
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>Revisi #{ragStatus?.current_revision || 0} (Config #{ragStatus?.config_revision || 1})</div>
                    </div>
                  </div>

                  {/* Active Job Alert - hanya muncul jika job benar-benar PENDING / RUNNING */}
                  {ragStatus?.active_job && ['PENDING', 'RUNNING'].includes(ragStatus.active_job.status) && (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--border-radius-md)',
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1px dashed rgba(59, 130, 246, 0.3)',
                      fontSize: '0.8125rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <Loader2 size={16} className="animate-spin text-primary" />
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Antrean Index Aktif: </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          Job #{ragStatus.active_job.id} (Sedang mengekstrak dan memproses potongan dokumen).
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Kotak Edukasi / Penjelasan Ramah Orang Awam */}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--border-radius-md)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.8125rem',
                    lineHeight: '1.5',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <HelpCircle size={15} className="text-secondary" /> Panduan Memahami Metode Pencarian (Leksikal vs Vektor)
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <strong style={{ color: 'var(--text-main)' }}>1. Leksikal (Kata Kunci FTS5):</strong> Bekerja seperti pencarian cepat di database Anda (instan &amp; 0 token biaya). Cepat dan akurat untuk kata-kata eksak (misal: nama produk, harga, info pendaftaran).
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <strong style={{ color: 'var(--text-main)' }}>2. Vektor (Embedding Semantik):</strong> Memahami maksud kalimat serupa meskipun kata-katanya berbeda. Membutuhkan API Key Embedding. Jika Vektor belum aktif, bot WhatsApp Anda <em>otomatis tetap menggunakan Pencarian Kata Kunci</em> sehingga tidak perlu khawatir menunggu.
                    </div>
                  </div>

                  {/* Last Error Alert */}
                  {ragStatus?.last_error && (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--border-radius-md)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      fontSize: '0.8125rem',
                      color: '#ef4444',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <AlertCircle size={16} />
                      <div>
                        <span style={{ fontWeight: 600 }}>Error Terakhir: </span>
                        <span>{ragStatus.last_error}</span>
                        {ragStatus.last_error_at && (
                          <span style={{ fontSize: '0.75rem', marginLeft: '6px', opacity: 0.8 }}>({new Date(ragStatus.last_error_at).toLocaleString()})</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card Form Konfigurasi Mesin RAG & Batas Token (RAG-0806, RAG-0807, RAG-0805) */}
            <div className="card" style={{
              backdropFilter: 'blur(16px)',
              background: 'var(--bg-card-glass)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders size={18} className="text-primary" /> Pengaturan Mesin RAG &amp; Batas Token
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* RAG Mode */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                      Strategi Mode RAG Sesi
                    </label>
                    <span style={{
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: ragMode === 'off' ? 'rgba(255,255,255,0.08)' : (ragMode === 'fts' ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)'),
                      color: ragMode === 'off' ? 'var(--text-muted)' : (ragMode === 'fts' ? '#10b981' : 'var(--primary-color)')
                    }}>
                      {ragMode === 'off' ? 'NONAKTIF (OFF)' : (ragMode === 'fts' ? 'FTS5 LEKSIKAL' : 'HYBRID')}
                    </span>
                  </div>

                  {/* Tombol Pilihan Langsung 3 Mode */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                    <button
                      type="button"
                      onClick={() => handleToggleRagMode('off')}
                      disabled={!selectedSession}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: ragMode === 'off' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                        background: ragMode === 'off' ? 'rgba(99,102,241,0.1)' : 'transparent',
                        color: ragMode === 'off' ? 'var(--primary-color)' : 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Non-RAG (Off)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleRagMode('fts')}
                      disabled={!selectedSession}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: ragMode === 'fts' ? '1px solid #10b981' : '1px solid var(--border-color)',
                        background: ragMode === 'fts' ? 'rgba(16,185,129,0.1)' : 'transparent',
                        color: ragMode === 'fts' ? '#10b981' : 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Kata Kunci (FTS5)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleRagMode('hybrid')}
                      disabled={!selectedSession}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: ragMode === 'hybrid' ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                        background: ragMode === 'hybrid' ? 'rgba(59,130,246,0.1)' : 'transparent',
                        color: ragMode === 'hybrid' ? '#3b82f6' : 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Hybrid (Semantik)
                    </button>
                  </div>

                  <select
                    className="form-control"
                    value={ragMode}
                    onChange={(e) => handleToggleRagMode(e.target.value)}
                    disabled={!selectedSession}
                    style={{ fontSize: '0.85rem' }}
                  >
                    <option value="off">Nonaktif (Standar AI - Mengirim Seluruh Teks Pengetahuan Tanpa Retrieval)</option>
                    <option value="fts">Leksikal FTS5 Only (Rekomendasi Cepat, Gratis &amp; Langsung Siap Pakai)</option>
                    <option value="hybrid">Hybrid (Kata Kunci + Vektor Semantik - Akurasi Pemahaman Tertinggi)</option>
                  </select>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                    {ragMode === 'fts' && 'Mode Leksikal mencari kata kunci eksak di database lokal (0 token embedding, 0 biaya, respon instan).'}
                    {ragMode === 'hybrid' && 'Mode Hybrid mencari kata kunci sekaligus memahami arti kalimat. Jika API embedding belum disetel, sistem otomatis memakai Leksikal.'}
                    {ragMode === 'off' && 'Seluruh teks pengetahuan dikirim langsung ke prompt AI seperti model AI konvensional.'}
                  </p>
                </div>

                {/* Top-K Chunks Slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Top-K Chunks Terpilih
                    </label>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary-color)' }}>{ragTopK} Chunks</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={ragTopK}
                    onChange={(e) => setRagTopK(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    <span>1 (Sangat Hemat)</span>
                    <span>3 (Seimbang)</span>
                    <span>5 (Maksimal)</span>
                  </div>
                </div>

                {/* Context Budget Slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Kapasitas Konteks Dokumen (Tokens)
                    </label>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary-color)' }}>{ragContextTokens?.toLocaleString('id-ID')} Tokens</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="100"
                    value={ragContextTokens}
                    onChange={(e) => setRagContextTokens(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    <span>100 Tokens</span>
                    <span>2.200 Tokens</span>
                    <span>10.000 Tokens (Maksimum)</span>
                  </div>
                </div>

                {/* Total Input Budget Slider (RAG Input Hard Budget) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Batas Total Input Token (Hard Budget)
                    </label>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary-color)' }}>{ragInputBudgetTokens?.toLocaleString('id-ID')} Tokens</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="32000"
                    step="500"
                    value={ragInputBudgetTokens}
                    onChange={(e) => setRagInputBudgetTokens(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    <span>1.000 Tokens</span>
                    <span>15.000 Tokens</span>
                    <span>30.000 Tokens (Pilihan Saat Ini)</span>
                    <span>32.000 Tokens (Maksimum)</span>
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                    Alokasi total token gabungan antara Prompt Sistem + Potongan Dokumen RAG + Riwayat Pesan. Nilai 30.000 token sangat leluasa untuk persona panjang dan riwayat percakapan.
                  </p>
                </div>

                {/* Max Output Tokens Slider (RAG-0805) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Batas Output Respon AI (Tokens)
                    </label>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary-color)' }}>{maxOutputTokens?.toLocaleString('id-ID')} Tokens</span>
                  </div>
                  <input
                    type="range"
                    min="64"
                    max="10000"
                    step="64"
                    value={maxOutputTokens}
                    onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    <span>64 Tokens (Ringkas)</span>
                    <span>2.048 Tokens (Standar)</span>
                    <span>10.000 Tokens (Maksimum)</span>
                  </div>
                </div>

                {/* Temperature Slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Kreativitas / Temperature AI
                    </label>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary-color)' }}>{temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    <span>0.0 (Faktual &amp; Tegas)</span>
                    <span>0.3 (Rekomendasi CS)</span>
                    <span>2.0 (Kreatif)</span>
                  </div>
                </div>

                {/* Debounce Setting */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Jendela Debounce Pesan Masuk (Milidetik)
                  </label>
                  <input
                    type="number"
                    className="form-control"
                    min="0"
                    max="60000"
                    step="500"
                    value={debounceMs}
                    onChange={(e) => setDebounceMs(Number(e.target.value))}
                    disabled={!selectedSession}
                    style={{ fontSize: '0.85rem' }}
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                    Menggabungkan pesan beruntun dalam {debounceMs} ms ({Number(debounceMs / 1000).toFixed(1)} detik) dari pelanggan yang sama ke satu panggilan AI.
                  </p>
                </div>

                {/* Cache & Direct Answer Options */}
                <div style={{ padding: '12px', borderRadius: 'var(--border-radius-md)', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      id="cacheEnabled"
                      checked={cacheEnabled}
                      onChange={(e) => setCacheEnabled(e.target.checked)}
                      disabled={!selectedSession}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="cacheEnabled" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer' }}>
                      Aktifkan SQLite Encrypted Response Cache
                    </label>
                  </div>

                  {cacheEnabled && (
                    <div style={{ paddingLeft: '26px' }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        TTL Cache (Detik, Max 86.400 / 24 Jam)
                      </label>
                      <input
                        type="number"
                        className="form-control"
                        min="60"
                        max="86400"
                        step="3600"
                        value={cacheTtlSeconds}
                        onChange={(e) => setCacheTtlSeconds(Number(e.target.value))}
                        disabled={!selectedSession}
                        style={{ fontSize: '0.8125rem', width: '160px' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      id="directAnswerEnabled"
                      checked={directAnswerEnabled}
                      onChange={(e) => setDirectAnswerEnabled(e.target.checked)}
                      disabled={!selectedSession}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="directAnswerEnabled" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer' }}>
                      Aktifkan Canonical Direct Answer (Bypass LLM untuk Pertanyaan Eksak)
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveSettings}
                  disabled={savingSettings || !selectedSession}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', marginTop: '6px' }}
                >
                  {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Simpan Pengaturan Mesin RAG
                </button>
              </div>
            </div>

          </div>

          {/* Panel Kanan RAG: Simulator & Live Retrieval */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Sub-tab Switcher: Chatbot Simulator vs Inspeksi Chunks */}
            <div style={{
              display: 'flex',
              background: 'var(--bg-card-glass)',
              borderRadius: '8px',
              padding: '4px',
              border: '1px solid var(--border-color)',
              gap: '4px'
            }}>
              <button
                type="button"
                onClick={() => setRagRightPanelTab('simulator')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: ragRightPanelTab === 'simulator' ? 'var(--primary-color)' : 'transparent',
                  color: ragRightPanelTab === 'simulator' ? '#ffffff' : 'var(--text-muted)',
                  transition: 'all 0.2s'
                }}
              >
                <Sparkles size={14} /> Chatbot Simulator (Interaktif)
              </button>
              <button
                type="button"
                onClick={() => setRagRightPanelTab('retrieval')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: ragRightPanelTab === 'retrieval' ? 'var(--primary-color)' : 'transparent',
                  color: ragRightPanelTab === 'retrieval' ? '#ffffff' : 'var(--text-muted)',
                  transition: 'all 0.2s'
                }}
              >
                <Search size={14} /> Inspeksi Chunks (0 Token LLM)
              </button>
            </div>

            {ragRightPanelTab === 'simulator' ? (
              renderSandboxSimulator()
            ) : (
            <div className="card" style={{
              backdropFilter: 'blur(16px)',
              background: 'var(--bg-card-glass)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={18} className="text-secondary" /> Uji Coba Retrieval Dokumen (Live Sandbox)
                </h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Simulasikan pencarian dokumen pengetahuan sesi ini tanpa memanggil LLM (0 token LLM, 0 biaya).
                </p>
              </div>

              {/* Form Input Query Test */}
              <form onSubmit={handleTestRetrieval} style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: 0 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                    Query Pertanyaan Uji Coba
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Contoh: Jam operasional kantor, harga paket premium, cara refund..."
                    value={retrievalQuery}
                    onChange={(e) => setRetrievalQuery(e.target.value)}
                    disabled={testingRetrieval || !selectedSession}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Mode Uji
                    </label>
                    <select
                      className="form-control"
                      value={retrievalMode}
                      onChange={(e) => setRetrievalMode(e.target.value)}
                      disabled={testingRetrieval || !selectedSession}
                      style={{ fontSize: '0.8125rem' }}
                    >
                      <option value="hybrid">Hybrid (FTS + Vektor)</option>
                      <option value="fts">FTS Only (Leksikal)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Top-K Chunks
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      min="1"
                      max="20"
                      value={retrievalTopK}
                      onChange={(e) => setRetrievalTopK(Number(e.target.value))}
                      disabled={testingRetrieval || !selectedSession}
                      style={{ fontSize: '0.8125rem' }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={testingRetrieval || !selectedSession || !retrievalQuery.trim()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}
                >
                  {testingRetrieval ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Jalankan Uji Retrieval
                </button>
              </form>

              {/* Area Hasil Uji Retrieval */}
              <div style={{
                marginTop: '8px',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Hasil Ekstraksi Dokumen
                  </span>
                  {retrievalResult && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Latency: <strong style={{ color: 'var(--primary-color)' }}>{retrievalResult.retrieval_latency_ms || 0} ms</strong> ({retrievalResult.selected_count || 0} chunk terpilih)
                    </span>
                  )}
                </div>

                {testingRetrieval ? (
                  <div style={{ padding: '30px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                    <Loader2 size={24} className="animate-spin" />
                    <span style={{ fontSize: '0.8125rem' }}>Mencari potongan dokumen paling relevan...</span>
                  </div>
                ) : !retrievalResult ? (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                    Masukkan query pertanyaan di atas dan klik tombol untuk melihat hasil ekstraksi chunk secara instan.
                  </div>
                ) : retrievalResult.selected_count === 0 ? (
                  <div style={{
                    padding: '16px',
                    borderRadius: 'var(--border-radius-md)',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px dashed rgba(245, 158, 11, 0.3)',
                    fontSize: '0.8125rem',
                    color: 'var(--text-muted)'
                  }}>
                    <strong style={{ color: '#f59e0b' }}>Tidak ada chunk dokumen relevan:</strong> Tidak ada potongan pengetahuan yang melampaui ambang batas skor untuk query ini. Pada runtime chat, AI akan mengarahkan pelanggan ke Customer Service atau fallback yang telah ditentukan.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '560px', overflowY: 'auto' }}>
                    {retrievalResult.chunks.map((chunk, idx) => (
                      <div
                        key={chunk.id || idx}
                        style={{
                          padding: '12px',
                          borderRadius: 'var(--border-radius-md)',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: 'var(--primary-color)',
                              color: 'white',
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {idx + 1}
                            </span>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                              {chunk.source_title}
                            </span>
                            <span style={{
                              fontSize: '0.6875rem',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              background: 'rgba(255,255,255,0.06)',
                              color: 'var(--text-muted)'
                            }}>
                              {chunk.source_type}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {chunk.is_canonical && (
                              <span style={{
                                fontSize: '0.6875rem',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                background: 'rgba(234, 179, 8, 0.15)',
                                color: '#eab308',
                                fontWeight: 700
                              }}>
                                Kanonis (Direct Answer)
                              </span>
                            )}
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '8px',
                              background: 'rgba(16, 185, 129, 0.12)',
                              color: '#10b981'
                            }}>
                              Score: {chunk.score}
                            </span>
                          </div>
                        </div>

                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          lineHeight: '1.45',
                          padding: '10px',
                          borderRadius: '6px',
                          background: 'rgba(0, 0, 0, 0.15)',
                          color: 'var(--text-main)',
                          whiteSpace: 'pre-wrap',
                          maxHeight: '160px',
                          overflowY: 'auto',
                          border: '1px solid rgba(255,255,255,0.04)'
                        }}>
                          {chunk.content}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                          Estimasi: {chunk.token_count} Tokens
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      )}

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

      {/* Modal Pengaturan Profil Embedding */}
      {showEmbeddingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9998,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="modal-content" style={{
            maxWidth: '520px',
            width: '90%',
            borderRadius: '16px',
            padding: '24px',
            backgroundColor: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={18} className="text-primary" /> Pengaturan Vektor Embedding
              </h3>
              <button
                type="button"
                onClick={() => setShowEmbeddingModal(false)}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            <div style={{
              padding: '10px 14px',
              borderRadius: 'var(--border-radius-md)',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              fontSize: '0.8125rem',
              color: 'var(--text-main)',
              lineHeight: 1.4
            }}>
              Menggunakan model OpenAI-compatible dari katalog harga [ListApiLLM.txt]. Rekomendasi utama: <strong>text-embedding-3-small</strong> ($0.02 / 1M token, 1.536 dimensi).
            </div>

            <form onSubmit={handleSaveEmbeddingProfile} style={{ display: 'flex', flexDirection: 'column', gap: '14px', margin: 0 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Pilih Model Embedding
                </label>
                <select
                  className="form-control"
                  value={embeddingModel}
                  onChange={(e) => {
                    const m = e.target.value;
                    setEmbeddingModel(m);
                    setEmbeddingDimensions(m === 'text-embedding-3-large' ? 3072 : 1536);
                  }}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="text-embedding-3-small">text-embedding-3-small (1.536 Dimensi, $0.02/1M Token - Sangat Direkomendasikan)</option>
                  <option value="text-embedding-3-large">text-embedding-3-large (3.072 Dimensi, $0.13/1M Token)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Kredensial API Penyedia Embedding
                </label>
                <select
                  className="form-control"
                  value={embeddingCredId}
                  onChange={(e) => setEmbeddingCredId(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                  required
                >
                  <option value="">-- Pilih Kredensial AI --</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.base_url || 'Default'}) {c.is_active ? '● Aktif' : '○ Nonaktif'}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  API Key dari kredensial ini akan digunakan saat mengonversi dokumen menjadi vektor.
                </div>
              </div>

              {embeddingTestResult && (
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--border-radius-md)',
                  background: embeddingTestResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${embeddingTestResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  color: embeddingTestResult.success ? '#10b981' : '#ef4444',
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {embeddingTestResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>{embeddingTestResult.message}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleTestEmbedding}
                  disabled={testingEmbedding || !embeddingCredId}
                  style={{ flex: 1, margin: 0, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  {testingEmbedding ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {testingEmbedding ? 'Menguji...' : 'Uji Koneksi Embedding'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEmbeddingProfile || !embeddingCredId}
                  style={{ flex: 1, margin: 0, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  {savingEmbeddingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {savingEmbeddingProfile ? 'Menyimpan...' : 'Simpan Profil'}
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
