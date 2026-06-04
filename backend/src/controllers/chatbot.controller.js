import { dbRun, dbAll, dbGet } from '../database.js';

export const getFlows = async (req, res) => {
  try {
    const flows = await dbAll('SELECT * FROM chatbot_flows');
    res.json({ status: 'success', data: flows });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createFlow = async (req, res) => {
  const { flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status } = req.body;

  try {
    const result = await dbRun(
      'INSERT INTO chatbot_flows (flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        flow_name, 
        description, 
        JSON.stringify(session_ids || []), 
        target_type || 'ALL', 
        keywords, 
        match_type || 'CONTAINS', 
        case_sensitive ? 1 : 0, 
        cooldown || 0, 
        delay || 0, 
        JSON.stringify(nodes || []), 
        status || 'ACTIVE'
      ]
    );
    res.status(201).json({ status: 'success', message: 'Chatbot flow created', data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateFlow = async (req, res) => {
  const { id } = req.params;
  const { flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status } = req.body;

  try {
    await dbRun(
      'UPDATE chatbot_flows SET flow_name = ?, description = ?, session_ids = ?, target_type = ?, keywords = ?, match_type = ?, case_sensitive = ?, cooldown = ?, delay = ?, nodes = ?, status = ? WHERE id = ?',
      [
        flow_name, 
        description, 
        JSON.stringify(session_ids || []), 
        target_type, 
        keywords, 
        match_type, 
        case_sensitive ? 1 : 0, 
        cooldown, 
        delay, 
        JSON.stringify(nodes || []), 
        status, 
        id
      ]
    );
    res.json({ status: 'success', message: 'Chatbot flow updated' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteFlow = async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM chatbot_flows WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Chatbot flow deleted' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateFlowStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await dbRun('UPDATE chatbot_flows SET status = ? WHERE id = ?', [status, id]);
    res.json({ status: 'success', message: 'Chatbot flow status updated' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const exportFlows = async (req, res) => {
  try {
    const flows = await dbAll('SELECT * FROM chatbot_flows');
    
    const exportedFlows = flows.map(flow => {
      let sessionIds = [];
      try {
        sessionIds = JSON.parse(flow.session_ids || '[]');
      } catch (e) {
        sessionIds = [];
      }
      const primarySessionId = sessionIds[0] || 'session_default';

      let nodesList = [];
      try {
        nodesList = JSON.parse(flow.nodes || '[]');
      } catch (e) {
        nodesList = [];
      }

      const mappedNodes = nodesList.map((node, i) => {
        const isButtons = node.message_type === 'Interactive Buttons';
        let optionsStr = '[]';
        if (isButtons) {
          optionsStr = JSON.stringify({
            options: (node.buttons || []).map((btnText, idx) => ({
              display_text: btnText,
              id: `option_${idx + 1}`,
              title: btnText
            })),
            extract_variable: null,
            interaction_type: 'buttons'
          });
        }

        return {
          id: parseInt(node.id) || i + 1,
          flow_id: flow.id,
          name: node.node_name || `Node ${i + 1}`,
          message: node.message_content || '',
          node_type: isButtons ? 'question' : 'message',
          options: optionsStr,
          next_node_id: node.next_node || null,
          position: i + 1,
          template_id: null,
          attachment_data: node.attachment?.url || null,
          attachment_type: node.attachment?.type ? node.attachment.type.toLowerCase() : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

      return {
        id: flow.id,
        session_id: primarySessionId,
        name: flow.flow_name,
        description: flow.description,
        trigger_keywords: flow.keywords,
        keyword_match_type: (flow.match_type || 'CONTAINS').toLowerCase(),
        keyword_case_sensitive: flow.case_sensitive ? 1 : 0,
        is_active: flow.status === 'ACTIVE' ? 1 : 0,
        welcome_message: null,
        fallback_message: null,
        cooldown_minutes: flow.cooldown || 0,
        message_delay_seconds: flow.delay || 0,
        conversation_count: 0,
        last_triggered: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        nodes: mappedNodes
      };
    });

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      type: 'chatbot_complete_export',
      flows: exportedFlows
    };

    res.json(exportData);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const importFlows = async (req, res) => {
  const { version, type, flows } = req.body;

  if (!flows || !Array.isArray(flows)) {
    return res.status(400).json({ status: 'error', message: 'Invalid export file structure: missing flows array.' });
  }

  try {
    let importCount = 0;
    for (const exportedFlow of flows) {
      const flow_name = exportedFlow.name || 'Unnamed Flow';
      const description = exportedFlow.description || null;
      const session_ids = exportedFlow.session_id ? [exportedFlow.session_id] : [];
      const target_type = 'ALL';
      const keywords = exportedFlow.trigger_keywords || '';
      
      let match_type = 'CONTAINS';
      if (exportedFlow.keyword_match_type) {
        const matchLower = exportedFlow.keyword_match_type.toLowerCase();
        if (matchLower === 'exact') match_type = 'EXACT';
        else if (matchLower === 'starts_with') match_type = 'STARTS_WITH';
      }
      
      const case_sensitive = exportedFlow.keyword_case_sensitive === 1;
      const cooldown = exportedFlow.cooldown_minutes || 0;
      const delay = exportedFlow.message_delay_seconds || 0;
      const status = exportedFlow.is_active === 1 ? 'ACTIVE' : 'INACTIVE';

      const exportedNodes = exportedFlow.nodes || [];
      const mappedNodes = exportedNodes.map((exportedNode, idx) => {
        let message_type = 'Text Message';
        let buttons = [];

        if (exportedNode.node_type === 'question' && exportedNode.options) {
          try {
            const optObj = JSON.parse(exportedNode.options);
            if (optObj.interaction_type === 'buttons' && Array.isArray(optObj.options)) {
              message_type = 'Interactive Buttons';
              buttons = optObj.options.map(o => o.display_text || o.title);
            }
          } catch (e) {
            console.error('Gagal memproses options JSON saat import node:', e);
          }
        }

        let attachment = { type: '', url: '' };
        if (exportedNode.attachment_data) {
          let attachment_type = '';
          if (exportedNode.attachment_type) {
            const typeLower = exportedNode.attachment_type.toLowerCase();
            if (typeLower === 'image') attachment_type = 'Image';
            else if (typeLower === 'video') attachment_type = 'Video';
            else if (typeLower === 'audio') attachment_type = 'Audio';
            else if (typeLower === 'document') attachment_type = 'Document';
          }
          attachment = {
            type: attachment_type || 'Image',
            url: exportedNode.attachment_data
          };
        }

        return {
          id: (Date.now() + idx).toString(),
          node_name: exportedNode.name || `Node ${idx + 1}`,
          node_type: 'Message',
          message_type,
          message_content: exportedNode.message || '',
          attachment,
          typing_indicator: false,
          next_node: exportedNode.next_node_id ? exportedNode.next_node_id.toString() : '',
          buttons
        };
      });

      await dbRun(
        'INSERT INTO chatbot_flows (flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          flow_name,
          description,
          JSON.stringify(session_ids),
          target_type,
          keywords,
          match_type,
          case_sensitive ? 1 : 0,
          cooldown,
          delay,
          JSON.stringify(mappedNodes),
          status
        ]
      );
      importCount++;
    }

    res.json({ status: 'success', message: `${importCount} chatbot flows successfully imported.` });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
