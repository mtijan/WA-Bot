import { dbAll, dbRun } from '../database.js';

export function normalizeFlowSessionIds(sessionIds = []) {
  if (!Array.isArray(sessionIds)) return [];
  return [...new Set(
    sessionIds
      .map((sessionId) => String(sessionId || '').trim())
      .filter(Boolean)
  )];
}

export async function syncFlowSessionAssignments(flowId, sessionIds = [], userId = 1) {
  const normalizedSessionIds = normalizeFlowSessionIds(sessionIds);

  await dbRun('DELETE FROM chatbot_flow_sessions WHERE flow_id = ?', [flowId]);
  for (const sessionId of normalizedSessionIds) {
    await dbRun(
      `INSERT OR IGNORE INTO chatbot_flow_sessions (flow_id, session_id, user_id)
       VALUES (?, ?, ?)`,
      [flowId, sessionId, userId || 1]
    );
  }

  return normalizedSessionIds;
}

export async function removeFlowSessionAssignments(flowId) {
  await dbRun('DELETE FROM chatbot_flow_sessions WHERE flow_id = ?', [flowId]);
}

export async function getActiveFlowSummariesForSession(sessionId) {
  return dbAll(
    `SELECT
       f.id, f.flow_name, f.description, f.session_ids, f.target_type, f.keywords,
       f.match_type, f.case_sensitive, f.cooldown, f.delay, f.status,
       f.sent_count, f.trigger_count, f.failed_count, f.created_at, f.user_id
     FROM chatbot_flow_sessions fs
     INNER JOIN chatbot_flows f ON f.id = fs.flow_id
     WHERE fs.session_id = ?
       AND f.status = 'ACTIVE'
     ORDER BY f.id DESC`,
    [sessionId]
  );
}

export async function getActiveFlowsWithNodesForSession(sessionId) {
  return dbAll(
    `SELECT f.*
     FROM chatbot_flow_sessions fs
     INNER JOIN chatbot_flows f ON f.id = fs.flow_id
     WHERE fs.session_id = ?
       AND f.status = 'ACTIVE'
     ORDER BY f.id DESC`,
    [sessionId]
  );
}
