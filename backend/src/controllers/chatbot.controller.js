import { dbRun, dbAll, dbGet } from '../database.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import {
  normalizeFlowSessionIds,
  removeFlowSessionAssignments,
  syncFlowSessionAssignments
} from '../services/chatbot_flow_sessions.service.js';
import {
  syncFlowKnowledgeSourceSafely,
  deleteFlowKnowledgeSourceSafely
} from '../services/chatbot_ai_rag_index.service.js';
import { auditLog } from '../services/audit.service.js';

export const getFlows = async (req, res) => {
  try {
    const summaryQuery = `SELECT
          id, flow_name, description, session_ids, target_type, keywords, match_type,
          case_sensitive, cooldown, delay, status, sent_count, trigger_count, failed_count, created_at,
          CASE WHEN json_valid(nodes) THEN json_array_length(nodes) ELSE 0 END AS node_count
        FROM chatbot_flows
        WHERE user_id = ?
        ORDER BY id DESC`;

    const fallbackSummaryQuery = `SELECT
          id, flow_name, description, session_ids, target_type, keywords, match_type,
          case_sensitive, cooldown, delay, status, sent_count, 0 AS trigger_count, 0 AS failed_count, created_at,
          0 AS node_count
        FROM chatbot_flows
        WHERE user_id = ?
        ORDER BY id DESC`;

    let flows;
    try {
      flows = await dbAll(summaryQuery, [req.auth.userId]);
    } catch (error) {
      logError('getFlowsSummaryQuery', error);
      flows = await dbAll(fallbackSummaryQuery, [req.auth.userId]);
    }

    return sendSuccess(res, flows);
  } catch (error) {
    logError('getFlows', error);
    return sendError(res, 500, 'GET_FLOWS_ERROR', 'Gagal memuat alur chatbot.');
  }
};

export const getFlowById = async (req, res) => {
  const { id } = req.params;
  try {
    const flow = await dbGet('SELECT * FROM chatbot_flows WHERE id = ?', [id]);
    if (!flow) {
      return sendError(res, 404, 'FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan.');
    }

    if (flow.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke alur chatbot ini.');
    }

    return sendSuccess(res, flow);
  } catch (error) {
    logError('getFlowById', error, { params: req.params });
    return sendError(res, 500, 'GET_FLOW_DETAIL_ERROR', 'Gagal memuat detail alur chatbot.');
  }
};

export const createFlow = async (req, res) => {
  const { flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status } = req.body;

  try {
    const sIds = normalizeFlowSessionIds(session_ids || []);
    for (const sid of sIds) {
      const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sid]);
      if (!sess || sess.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', `Anda tidak memiliki akses ke sesi ${sid}.`);
      }
    }

    const result = await dbRun(
      'INSERT INTO chatbot_flows (flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        flow_name, 
        description || null, 
        JSON.stringify(sIds), 
        target_type || 'ALL', 
        keywords, 
        match_type || 'CONTAINS', 
        case_sensitive ? 1 : 0, 
        cooldown || 0, 
        delay || 0, 
        JSON.stringify(nodes || []), 
        status || 'ACTIVE',
        req.auth.userId
      ]
    );
    await syncFlowSessionAssignments(result.id, sIds, req.auth.userId);
    await syncFlowKnowledgeSourceSafely({
      flowId: result.id,
      userId: req.auth.userId,
      flow: {
        id: result.id,
        flow_name,
        description,
        session_ids: sIds,
        keywords,
        nodes,
        status: status || 'ACTIVE',
        user_id: req.auth.userId
      },
      sessionIds: sIds
    });
    auditLog(req, 'CHATBOT_FLOW_CREATE', 'chatbot_flow', String(result.id), 'success', { flow_name, status: status || 'ACTIVE' });
    return sendSuccess(res, { id: result.id }, 201, { message: 'Alur chatbot berhasil disimpan.' });
  } catch (error) {
    logError('createFlow', error, { body: req.body });
    return sendError(res, 500, 'CREATE_FLOW_ERROR', 'Gagal menyimpan alur chatbot.');
  }
};

export const updateFlow = async (req, res) => {
  const { id } = req.params;
  const { flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM chatbot_flows WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke alur chatbot ini.');
    }

    const sIds = normalizeFlowSessionIds(session_ids || []);
    for (const sid of sIds) {
      const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sid]);
      if (!sess || sess.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', `Anda tidak memiliki akses ke sesi ${sid}.`);
      }
    }

    await dbRun(
      'UPDATE chatbot_flows SET flow_name = ?, description = ?, session_ids = ?, target_type = ?, keywords = ?, match_type = ?, case_sensitive = ?, cooldown = ?, delay = ?, nodes = ?, status = ? WHERE id = ?',
      [
        flow_name, 
        description || null, 
        JSON.stringify(sIds), 
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
    await syncFlowSessionAssignments(id, sIds, existing.user_id || req.auth.userId);
    await syncFlowKnowledgeSourceSafely({
      flowId: Number(id),
      userId: req.auth.userId,
      flow: {
        id: Number(id),
        flow_name,
        description,
        session_ids: sIds,
        keywords,
        nodes,
        status,
        user_id: req.auth.userId
      },
      sessionIds: sIds
    });
    auditLog(req, 'CHATBOT_FLOW_UPDATE', 'chatbot_flow', String(id), 'success', { flow_name, status });
    return sendSuccess(res, null, 200, { message: 'Alur chatbot berhasil diperbarui.' });
  } catch (error) {
    logError('updateFlow', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_FLOW_ERROR', 'Gagal memperbarui alur chatbot.');
  }
};

export const updateFlowSettings = async (req, res) => {
  const { id } = req.params;
  const { flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, status } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM chatbot_flows WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke alur chatbot ini.');
    }

    const sIds = normalizeFlowSessionIds(session_ids || []);
    for (const sid of sIds) {
      const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sid]);
      if (!sess || sess.user_id !== req.auth.userId) {
        return sendError(res, 403, 'FORBIDDEN_ACCESS', `Anda tidak memiliki akses ke sesi ${sid}.`);
      }
    }

    await dbRun(
      'UPDATE chatbot_flows SET flow_name = ?, description = ?, session_ids = ?, target_type = ?, keywords = ?, match_type = ?, case_sensitive = ?, cooldown = ?, delay = ?, status = ? WHERE id = ?',
      [
        flow_name,
        description || null,
        JSON.stringify(sIds),
        target_type,
        keywords,
        match_type,
        case_sensitive ? 1 : 0,
        cooldown,
        delay,
        status,
        id
      ]
    );
    await syncFlowSessionAssignments(id, sIds, existing.user_id || req.auth.userId);
    await syncFlowKnowledgeSourceSafely({
      flowId: Number(id),
      userId: req.auth.userId,
      flow: {
        id: Number(id),
        flow_name,
        description,
        session_ids: sIds,
        keywords,
        nodes: existing.nodes,
        status,
        user_id: req.auth.userId
      },
      sessionIds: sIds
    });
    auditLog(req, 'CHATBOT_FLOW_SETTINGS_UPDATE', 'chatbot_flow', String(id), 'success', { flow_name, status });
    return sendSuccess(res, null, 200, { message: 'Pengaturan alur chatbot berhasil diperbarui.' });
  } catch (error) {
    logError('updateFlowSettings', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_FLOW_SETTINGS_ERROR', 'Gagal memperbarui pengaturan alur chatbot.');
  }
};

export const deleteFlow = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT * FROM chatbot_flows WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke alur chatbot ini.');
    }

    await deleteFlowKnowledgeSourceSafely({ flowId: Number(id), userId: req.auth.userId });
    await removeFlowSessionAssignments(id);
    await dbRun('DELETE FROM chatbot_flows WHERE id = ?', [id]);
    auditLog(req, 'CHATBOT_FLOW_DELETE', 'chatbot_flow', String(id), 'success', { flow_name: existing.flow_name });
    return sendSuccess(res, null, 200, { message: 'Alur chatbot berhasil dihapus.' });
  } catch (error) {
    logError('deleteFlow', error, { params: req.params });
    return sendError(res, 500, 'DELETE_FLOW_ERROR', 'Gagal menghapus alur chatbot.');
  }
};

export const updateFlowStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const existing = await dbGet('SELECT * FROM chatbot_flows WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 404, 'FLOW_NOT_FOUND', 'Alur chatbot tidak ditemukan.');
    }

    if (existing.user_id !== req.auth.userId) {
      return sendError(res, 403, 'FORBIDDEN_ACCESS', 'Anda tidak memiliki akses ke alur chatbot ini.');
    }

    await dbRun('UPDATE chatbot_flows SET status = ? WHERE id = ?', [status, id]);
    await syncFlowKnowledgeSourceSafely({
      flowId: Number(id),
      userId: req.auth.userId,
      flow: {
        ...existing,
        status
      }
    });
    auditLog(req, 'CHATBOT_FLOW_STATUS_UPDATE', 'chatbot_flow', String(id), 'success', { status });
    return sendSuccess(res, null, 200, { message: 'Status alur chatbot berhasil diperbarui.' });
  } catch (error) {
    logError('updateFlowStatus', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'UPDATE_FLOW_STATUS_ERROR', 'Gagal memperbarui status alur chatbot.');
  }
};

export const exportFlows = async (req, res) => {
  try {
    const sql = 'SELECT * FROM chatbot_flows WHERE user_id = ?';
    const flows = await dbAll(sql, [req.auth.userId]);
    
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
          id: parseInt(node.id, 10) || i + 1,
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

    return res.json(exportData);
  } catch (error) {
    logError('exportFlows', error);
    return sendError(res, 500, 'EXPORT_FLOWS_ERROR', 'Gagal mengekspor alur chatbot.');
  }
};

export const importFlows = async (req, res) => {
  const { flows } = req.body;

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
            logError('parseOptionsOnImport', e);
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

      // Filter session IDs based on user ownership if not admin
      let validatedSessionIds = [];
      if (session_ids.length > 0) {
        for (const sid of session_ids) {
          const sess = await dbGet('SELECT user_id FROM sessions WHERE session_id = ?', [sid]);
          if (sess && sess.user_id === req.auth.userId) {
            validatedSessionIds.push(sid);
          }
        }
      }

      const result = await dbRun(
        'INSERT INTO chatbot_flows (flow_name, description, session_ids, target_type, keywords, match_type, case_sensitive, cooldown, delay, nodes, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          flow_name,
          description,
          JSON.stringify(validatedSessionIds),
          target_type,
          keywords,
          match_type,
          case_sensitive ? 1 : 0,
          cooldown,
          delay,
          JSON.stringify(mappedNodes),
          status,
          req.auth.userId
        ]
      );
      await syncFlowSessionAssignments(result.id, validatedSessionIds, req.auth.userId);
      await syncFlowKnowledgeSourceSafely({
        flowId: result.id,
        userId: req.auth.userId,
        flow: {
          id: result.id,
          flow_name,
          description,
          session_ids: validatedSessionIds,
          keywords,
          nodes: mappedNodes,
          status,
          user_id: req.auth.userId
        },
        sessionIds: validatedSessionIds
      });
      importCount++;
    }

    return sendSuccess(res, null, 200, { message: `${importCount} chatbot flows successfully imported.` });
  } catch (error) {
    logError('importFlows', error, { body: req.body });
    return sendError(res, 500, 'IMPORT_FLOWS_ERROR', error.message || 'Gagal mengimpor alur chatbot.');
  }
};
