import { createHash } from 'crypto';

const DEFAULT_CHUNK_OPTIONS = Object.freeze({
  minTokens: 150,
  targetTokens: 240,
  maxTokens: 300,
  overlapTokens: 40
});

const normalizeText = (value) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const normalizeStringList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Legacy comma/newline-separated values are handled below.
  }
  return trimmed.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
};

const getButtonLabel = (button) => {
  if (typeof button === 'string') return normalizeText(button);
  if (!button || typeof button !== 'object') return '';
  return normalizeText(button.title || button.text || button.label || button.display_text);
};

const getButtonTarget = (button) => {
  if (!button || typeof button !== 'object') return null;
  const value = button.next_node ?? button.target_node ?? button.nextNode ?? button.targetNode;
  return value === undefined || value === null || value === '' ? null : String(value);
};

const parseNodeOptions = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.options) ? parsed.options : [];
  } catch {
    return [];
  }
};

const getNodeButtons = (node) => [
  ...(Array.isArray(node?.buttons) ? node.buttons : []),
  ...parseNodeOptions(node?.options)
];

const getNodeNextId = (node) => {
  const value = node?.next_node ?? node?.next_node_id;
  return value === undefined || value === null || value === '' ? null : String(value);
};

const parseFlowNodes = (nodes) => {
  if (Array.isArray(nodes)) return nodes;
  if (typeof nodes !== 'string' || !nodes.trim()) return [];
  try {
    const parsed = JSON.parse(nodes);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildBranchPaths = (nodes) => {
  const ids = nodes.map((node, index) => String(node?.id ?? `index-${index}`));
  const idSet = new Set(ids);
  const outgoing = new Map();
  const incomingCount = new Map(ids.map((id) => [id, 0]));

  nodes.forEach((node, index) => {
    const edges = [];
    const explicitNext = getNodeNextId(node);
    if (explicitNext && idSet.has(explicitNext)) edges.push(explicitNext);
    for (const button of getNodeButtons(node)) {
      const target = getButtonTarget(button);
      if (target && idSet.has(target)) edges.push(target);
    }
    if (!explicitNext && edges.length === 0 && index + 1 < ids.length) edges.push(ids[index + 1]);

    const uniqueEdges = [...new Set(edges)];
    outgoing.set(ids[index], uniqueEdges);
    for (const target of uniqueEdges) incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
  });

  const roots = ids.filter((id) => incomingCount.get(id) === 0);
  if (roots.length === 0 && ids.length > 0) roots.push(ids[0]);
  const paths = new Map();
  const visit = (id, path, visiting) => {
    if (visiting.has(id)) return;
    const nextPath = [...path, id];
    const current = paths.get(id);
    if (!current || nextPath.join('/') < current.join('/')) paths.set(id, nextPath);
    const nextVisiting = new Set(visiting).add(id);
    for (const target of outgoing.get(id) || []) visit(target, nextPath, nextVisiting);
  };
  for (const root of roots) visit(root, [], new Set());
  for (const id of ids) if (!paths.has(id)) visit(id, [], new Set());
  return paths;
};

const stableHash = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

export function estimateRagTokens(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  const tokens = normalized.match(
    /https?:\/\/[^\s)\]}>,]+|(?:Rp\.?\s*)?\d[\d.,]*(?:\s*(?:ribu|juta|miliar))?|\+?\d[\d\s().-]{5,}\d|[\p{L}\p{M}]+|[^\s]/giu
  ) || [];
  return tokens.reduce((total, token) => {
    if (/^https?:\/\//i.test(token)) return total + Math.max(1, Math.ceil(token.length / 4));
    return total + 1;
  }, 0);
}

export function extractManualKnowledgeSource({ userId, sessionId, knowledgeBase }) {
  const text = normalizeText(knowledgeBase);
  const documents = text
    ? [{
        documentId: `manual:${sessionId}`,
        text,
        metadata: {
          source_type: 'manual',
          session_id: String(sessionId)
        }
      }]
    : [];

  return {
    sourceType: 'manual',
    userId: Number(userId),
    manualSessionId: String(sessionId),
    documents,
    contentHash: stableHash(documents)
  };
}

export function extractFlowKnowledgeSource(flow, options = {}) {
  const nodes = parseFlowNodes(flow?.nodes);
  const branchPaths = buildBranchPaths(nodes);
  const flowId = Number(flow?.id);
  const flowName = normalizeText(flow?.flow_name || flow?.name);
  const keywords = normalizeStringList(flow?.keywords || flow?.trigger_keywords);
  const documents = [];

  nodes.forEach((node, index) => {
    const nodeId = String(node?.id ?? `index-${index}`);
    const message = normalizeText(node?.message_content || node?.message);
    const buttons = getNodeButtons(node)
      .map(getButtonLabel)
      .filter(Boolean);
    if (!message && buttons.length === 0) return;

    const text = [message, buttons.length > 0 ? `Pilihan: ${buttons.join(' | ')}` : '']
      .filter(Boolean)
      .join('\n');
    documents.push({
      documentId: `flow:${flowId}:node:${nodeId}`,
      text,
      metadata: {
        source_type: 'flow',
        flow_id: flowId,
        flow_name: flowName,
        flow_keywords: keywords,
        node_id: nodeId,
        node_name: normalizeText(node?.node_name || node?.name),
        node_index: index,
        node_type: normalizeText(node?.node_type || node?.message_type),
        branch_path: branchPaths.get(nodeId) || [nodeId],
        next_node: getNodeNextId(node),
        buttons
      }
    });
  });

  return {
    sourceType: 'flow',
    userId: Number(options.userId ?? flow?.user_id),
    flowId,
    flowName,
    documents,
    contentHash: stableHash(documents)
  };
}

const splitOversizedUnit = (unit, maxTokens) => {
  if (estimateRagTokens(unit) <= maxTokens) return [unit];
  const atoms = unit.match(
    /https?:\/\/[^\s)\]}>,]+|(?:Rp\.?\s*)?\d[\d.,]*(?:\s*(?:ribu|juta|miliar))?|\+?\d[\d\s().-]{5,}\d|\S+/giu
  ) || [];
  const parts = [];
  let current = [];
  for (const atom of atoms) {
    const candidate = [...current, atom].join(' ');
    if (current.length > 0 && estimateRagTokens(candidate) > maxTokens) {
      parts.push(current.join(' '));
      current = [atom];
    } else {
      current.push(atom);
    }
  }
  if (current.length > 0) parts.push(current.join(' '));
  return parts;
};

const segmentDocument = (text, maxTokens) => {
  const rawUnits = [];
  for (const paragraph of normalizeText(text).split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (/^(?:[-*•]|\d+[.)])\s/u.test(trimmed)) {
      rawUnits.push(trimmed);
      continue;
    }
    const sentences = trimmed.split(/(?<=[.!?])\s+(?=[\p{Lu}\d•*-])/gu);
    rawUnits.push(...sentences.map((sentence) => sentence.trim()).filter(Boolean));
  }
  return rawUnits.flatMap((unit) => splitOversizedUnit(unit, maxTokens));
};

const getOverlapUnits = (units, overlapTokens) => {
  const overlap = [];
  let total = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const count = estimateRagTokens(units[index]);
    if (overlap.length > 0 && total + count > overlapTokens) break;
    if (count > overlapTokens && overlap.length === 0) break;
    overlap.unshift(units[index]);
    total += count;
  }
  return overlap;
};

const packDocument = (text, options) => {
  const totalTokens = estimateRagTokens(text);
  if (totalTokens <= options.maxTokens) return [{ text, overlapTokens: 0 }];
  const units = segmentDocument(text, options.maxTokens);
  const packed = [];
  let current = [];
  let overlapCount = 0;

  for (const unit of units) {
    const candidate = [...current, unit].join('\n');
    const currentTokens = estimateRagTokens(current.join('\n'));
    const effectiveTarget = overlapCount > 0 ? options.maxTokens : options.targetTokens;
    if (
      current.length > 0
      && estimateRagTokens(candidate) > effectiveTarget
      && (currentTokens >= options.minTokens || estimateRagTokens(candidate) > options.maxTokens)
    ) {
      packed.push({ text: current.join('\n'), overlapTokens: overlapCount });
      current = getOverlapUnits(current, options.overlapTokens);
      overlapCount = estimateRagTokens(current.join('\n'));
    }
    current.push(unit);
    if (estimateRagTokens(current.join('\n')) > options.maxTokens) {
      const last = current.pop();
      packed.push({ text: current.join('\n'), overlapTokens: overlapCount });
      current = [last];
      overlapCount = 0;
    }
  }
  if (current.length > 0) packed.push({ text: current.join('\n'), overlapTokens: overlapCount });

  if (packed.length > 1) {
    const last = packed.at(-1);
    const previous = packed.at(-2);
    if (estimateRagTokens(last.text) < options.minTokens) {
      const merged = `${previous.text}\n${last.text}`;
      if (estimateRagTokens(merged) <= options.maxTokens) {
        packed.splice(-2, 2, { text: merged, overlapTokens: previous.overlapTokens });
      }
    }
  }
  return packed;
};

export function chunkKnowledgeDocuments(documents, customOptions = {}) {
  const options = { ...DEFAULT_CHUNK_OPTIONS, ...customOptions };
  if (
    !Number.isInteger(options.minTokens)
    || !Number.isInteger(options.targetTokens)
    || !Number.isInteger(options.maxTokens)
    || !Number.isInteger(options.overlapTokens)
    || options.minTokens < 1
    || options.minTokens > options.targetTokens
    || options.targetTokens > options.maxTokens
    || options.overlapTokens < 0
    || options.overlapTokens > 50
  ) {
    throw new TypeError('Invalid RAG chunk options.');
  }

  const chunks = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const text = normalizeText(document?.text);
    if (!text) continue;
    const packed = packDocument(text, options);
    packed.forEach((part, documentChunkIndex) => {
      chunks.push({
        chunkIndex: chunks.length,
        documentChunkIndex,
        text: part.text,
        tokenCount: estimateRagTokens(part.text),
        overlapTokens: part.overlapTokens,
        contentHash: stableHash(part.text),
        metadata: {
          ...(document.metadata || {}),
          document_id: document.documentId,
          document_chunk_index: documentChunkIndex,
          document_chunk_count: packed.length
        }
      });
    });
  }
  return chunks;
}

export function resolveRagSourceRevision({ previousContentHash, previousRevision = 0, contentHash }) {
  if (!contentHash || typeof contentHash !== 'string') {
    throw new TypeError('contentHash is required to resolve a RAG source revision.');
  }
  if (previousContentHash && previousContentHash === contentHash) {
    return Math.max(1, Number(previousRevision) || 1);
  }
  return Math.max(1, (Number(previousRevision) || 0) + 1);
}
