/**
 * Utility helpers for WhatsApp service.
 * Extracted from whatsapp.service.js to reduce file size and improve maintainability.
 */
import fs from 'fs';
import path from 'path';

// -------------------------------------------------------------------
// Media helpers
// -------------------------------------------------------------------

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function getMediaSource(urlOrPath, options = {}) {
  if (Buffer.isBuffer(urlOrPath)) return urlOrPath;

  if (!options.mediaRoot || typeof options.mediaRoot !== 'string') {
    const error = new Error('Root penyimpanan media terkelola belum dikonfigurasi.');
    error.code = 'UNSAFE_MEDIA_SOURCE';
    throw error;
  }

  const mediaRoot = path.resolve(options.mediaRoot);
  if (!urlOrPath || typeof urlOrPath !== 'string') {
    const error = new Error('Sumber media tidak valid. Gunakan file dari endpoint upload terkelola.');
    error.code = 'UNSAFE_MEDIA_SOURCE';
    throw error;
  }

  const candidate = path.resolve(urlOrPath);
  if (!isPathInside(mediaRoot, candidate) || !fs.existsSync(candidate)) {
    const error = new Error('Sumber media tidak diizinkan. Gunakan file dari endpoint upload terkelola.');
    error.code = 'UNSAFE_MEDIA_SOURCE';
    throw error;
  }

  try {
    const realRoot = fs.realpathSync(mediaRoot);
    const realCandidate = fs.realpathSync(candidate);
    if (!isPathInside(realRoot, realCandidate) || !fs.statSync(realCandidate).isFile()) {
      const error = new Error('Sumber media tidak diizinkan. Gunakan file dari endpoint upload terkelola.');
      error.code = 'UNSAFE_MEDIA_SOURCE';
      throw error;
    }
    return fs.readFileSync(realCandidate);
  } catch (err) {
    if (err?.code === 'UNSAFE_MEDIA_SOURCE') throw err;
    const error = new Error('Sumber media tidak dapat dibaca dari penyimpanan upload terkelola.');
    error.code = 'UNSAFE_MEDIA_SOURCE';
    throw error;
  }
}

const MIME_TYPE_MAP = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'mov': 'video/quicktime',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'txt': 'text/plain',
  'csv': 'text/csv',
  'zip': 'application/zip'
};

export function getMimeTypeFromUrl(url, defaultMime = 'application/octet-stream') {
  if (!url) return defaultMime;
  const ext = url.split('.').pop().toLowerCase();
  return MIME_TYPE_MAP[ext] || defaultMime;
}

export function getFileNameFromUrl(url, defaultName = 'Document.pdf') {
  if (!url) return defaultName;
  try {
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      const decodedFilename = decodeURIComponent(lastPart).split(/[?#]/)[0];
      if (!decodedFilename) return defaultName;

      const fileParts = decodedFilename.split('-');
      if (fileParts.length > 6) {
        return fileParts.slice(6).join('-');
      }

      return decodedFilename;
    }
  } catch (err) {
    // ignore
  }
  return defaultName;
}

// -------------------------------------------------------------------
// Text processing helpers
// -------------------------------------------------------------------

export function parseSpintax(text) {
  if (typeof text !== 'string') return text;

  const regex = /\{([^{|}]+\|[^{}]+)\}/g;
  let result = text;
  let match;

  while ((match = regex.exec(result)) !== null) {
    const options = match[1].split('|');
    const randomIndex = Math.floor(Math.random() * options.length);
    const chosen = options[randomIndex];

    result = result.replace(match[0], chosen);
    regex.lastIndex = 0;
  }

  return result;
}

export function normalizeIncomingText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

export function parseFlowKeywords(keywords) {
  if (typeof keywords !== 'string') return [];

  return keywords
    .split(/[\r\n,;]+/)
    .map((keyword) => normalizeIncomingText(keyword))
    .filter(Boolean);
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return '';
}

// -------------------------------------------------------------------
// Message text extraction
// -------------------------------------------------------------------

export function extractIncomingMessageText(messageType, innerMessage = {}) {
  if (!messageType || !innerMessage) return '';

  if (messageType === 'conversation') {
    return innerMessage.conversation || '';
  }

  if (messageType === 'extendedTextMessage') {
    return innerMessage.extendedTextMessage?.text || '';
  }

  if (messageType === 'imageMessage') {
    return innerMessage.imageMessage?.caption || '';
  }

  if (messageType === 'videoMessage') {
    return innerMessage.videoMessage?.caption || '';
  }

  if (messageType === 'buttonsResponseMessage') {
    return getFirstNonEmptyString(
      innerMessage.buttonsResponseMessage?.selectedDisplayText,
      innerMessage.buttonsResponseMessage?.selectedButtonId
    );
  }

  if (messageType === 'templateButtonReplyMessage') {
    return getFirstNonEmptyString(
      innerMessage.templateButtonReplyMessage?.selectedDisplayText,
      innerMessage.templateButtonReplyMessage?.selectedId
    );
  }

  if (messageType === 'listResponseMessage') {
    return getFirstNonEmptyString(
      innerMessage.listResponseMessage?.title,
      innerMessage.listResponseMessage?.singleSelectReply?.selectedRowId,
      innerMessage.listResponseMessage?.singleSelectReply?.title
    );
  }

  if (messageType === 'interactiveResponseMessage') {
    const nativeFlow = innerMessage.interactiveResponseMessage?.nativeFlowResponseMessage;
    if (!nativeFlow?.paramsJson) return '';

    try {
      const params = JSON.parse(nativeFlow.paramsJson);
      return getFirstNonEmptyString(
        params?.display_text,
        params?.title,
        params?.selectedDisplayText,
        params?.selectedTitle,
        params?.id,
        params?.selectedId
      );
    } catch (e) {
      console.error('Gagal memproses paramsJson pada interactiveResponseMessage:', e);
      return '';
    }
  }

  return '';
}

// -------------------------------------------------------------------
// Flow matching
// -------------------------------------------------------------------

export function doesFlowMatchIncomingText(flow, incomingText, options = {}) {
  const { isGroup = false } = options;
  if (!flow) return false;

  const target = flow.target_type || 'ALL';
  if (target === 'PERSONAL' && isGroup) return false;
  if (target === 'GROUP' && !isGroup) return false;

  let flowKeywords = parseFlowKeywords(flow.keywords);
  if (flowKeywords.length === 0) return false;

  const normalizedText = normalizeIncomingText(incomingText);
  if (!normalizedText) return false;

  if (!flow.case_sensitive) {
    flowKeywords = flowKeywords.map((keyword) => keyword.toLowerCase());
  }

  const textToMatch = flow.case_sensitive ? normalizedText : normalizedText.toLowerCase();
  const matchType = String(flow.match_type || 'CONTAINS').toUpperCase();

  if (matchType === 'EXACT') {
    return flowKeywords.includes(textToMatch);
  }

  if (matchType === 'STARTS_WITH') {
    return flowKeywords.some((keyword) => textToMatch.startsWith(keyword));
  }

  return flowKeywords.some((keyword) => textToMatch.includes(keyword));
}

// -------------------------------------------------------------------
// Console noise filter for libsignal
// -------------------------------------------------------------------

const LIBSIGNAL_NOISE_PATTERNS = [
  'Closing session',
  'Closing open session in favor of incoming prekey bundle',
  'Failed to decrypt message with any known session',
  'Session error:',
  'MessageCounterError',
  'Key used already or never filled'
];

function isLibsignalNoise(args) {
  if (!args || args.length === 0) return false;
  const first = args[0];
  if (typeof first !== 'string') return false;
  return LIBSIGNAL_NOISE_PATTERNS.some(pattern => first.includes(pattern));
}

export function installConsoleNoiseFilter() {
  const _origConsoleInfo = console.info;
  const _origConsoleWarn = console.warn;
  const _origConsoleError = console.error;

  console.info = function (...args) {
    if (isLibsignalNoise(args)) return;
    _origConsoleInfo.apply(console, args);
  };
  console.warn = function (...args) {
    if (isLibsignalNoise(args)) return;
    _origConsoleWarn.apply(console, args);
  };
  console.error = function (...args) {
    if (isLibsignalNoise(args)) return;
    _origConsoleError.apply(console, args);
  };
}
