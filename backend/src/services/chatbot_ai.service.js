import { getActiveFlowsWithNodesForSession } from './chatbot_flow_sessions.service.js';

export async function getFlowsKnowledgeBase(sessionId) {
  try {
    const flows = await getActiveFlowsWithNodesForSession(sessionId);
    if (flows.length === 0) return '';
    
    let text = "INFORMASI ALUR CHATBOT OTOMATIS YANG TERSEDIA:\n";
    flows.forEach((flow) => {
      text += `\nAlur: ${flow.flow_name}\n`;
      
      try {
        const nodes = JSON.parse(flow.nodes || '[]');
        const validNodes = nodes.filter(n => n.message_content && n.message_content.trim() !== '');
        if (validNodes.length > 0) {
          text += `Isi Pesan:\n`;
          validNodes.forEach(n => {
            text += `- ${n.message_content.trim()}\n`;
          });
        }
      } catch (err) {
        // Abaikan kesalahan parsing JSON nodes individual
      }
    });
    return text;
  } catch (error) {
    console.error('Gagal memproses knowledge base dari chatbot flow:', error);
    return '';
  }
}

export async function resolveKnowledgeBase(settings) {
  if (!settings) return '';
  const source = settings.knowledge_source || 'manual';
  const manualKb = settings.knowledge_base || '';
  
  if (source === 'manual') {
    return manualKb;
  }
  
  const flowsKb = await getFlowsKnowledgeBase(settings.session_id);
  
  if (source === 'flow') {
    return flowsKb;
  }
  
  if (source === 'both') {
    return [manualKb, flowsKb].filter(Boolean).join('\n\n');
  }
  
  return manualKb;
}
