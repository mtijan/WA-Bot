import fs from 'fs';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_BACKUP_MAX_AGE_HOURS = 36;
const DEFAULT_DISK_WARN_PERCENT = 80;

const nowIso = () => new Date().toISOString();

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const timeoutMs = parseNumber(process.env.WA_BOT_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const backupMaxAgeHours = parseNumber(process.env.WA_BOT_ALERT_BACKUP_MAX_AGE_HOURS, DEFAULT_BACKUP_MAX_AGE_HOURS);
const diskWarnPercent = parseNumber(process.env.WA_BOT_ALERT_DISK_WARN_PERCENT, DEFAULT_DISK_WARN_PERCENT);

const webhookUrl = process.env.WA_BOT_ALERT_WEBHOOK_URL || '';
const telegramBotToken = process.env.WA_BOT_ALERT_TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.WA_BOT_ALERT_TELEGRAM_CHAT_ID || '';
const internalToken = process.env.WA_BOT_INTERNAL_TOKEN || '';
const encryptedBackupDir = process.env.WA_BOT_ENCRYPTED_BACKUP_DIR || path.resolve('..', 'encrypted_backups');

const endpointTargets = [
  {
    name: 'api-ready',
    url: process.env.WA_BOT_ALERT_API_READY_URL || 'http://127.0.0.1:3001/health/ready',
    headers: {}
  },
  {
    name: 'worker-ready',
    url: process.env.WA_BOT_ALERT_WORKER_READY_URL || 'http://127.0.0.1:3002/internal/health/ready',
    headers: internalToken ? { 'X-Internal-Token': internalToken } : {}
  },
  {
    name: 'failed-replies',
    url: process.env.WA_BOT_ALERT_FAILED_REPLIES_URL || 'http://127.0.0.1:3002/internal/health/failed-replies',
    headers: internalToken ? { 'X-Internal-Token': internalToken } : {}
  },
  ...(process.env.WA_BOT_ALERT_PUBLIC_URL
    ? [{ name: 'public-frontend', url: process.env.WA_BOT_ALERT_PUBLIC_URL, headers: {} }]
    : []),
  ...(process.env.WA_BOT_ALERT_PUBLIC_HEALTH_URL
    ? [{ name: 'public-health', url: process.env.WA_BOT_ALERT_PUBLIC_HEALTH_URL, headers: {} }]
    : [])
];

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkEndpoint(target) {
  try {
    const response = await fetchWithTimeout(target.url, {
      headers: target.headers
    });

    if (!response.ok) {
      return {
        ok: false,
        target: target.name,
        message: `${target.name} returned HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body.status && !['healthy', 'ready', 'success'].includes(body.status)) {
        const detail = body.message || body.error || '';
        return {
          ok: false,
          target: target.name,
          message: `${target.name} returned status=${body.status}${detail ? ': ' + detail : ''}`
        };
      }
    }

    return { ok: true, target: target.name, message: 'ok' };
  } catch (error) {
    return {
      ok: false,
      target: target.name,
      message: `${target.name} failed: ${error.message}`
    };
  }
}

function findLatestManifest(rootDir) {
  if (!fs.existsSync(rootDir)) return null;

  const queue = [rootDir];
  let latest = null;

  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name === 'manifest.json') {
        const stat = fs.statSync(fullPath);
        if (!latest || stat.mtimeMs > latest.mtimeMs) {
          latest = { path: fullPath, mtimeMs: stat.mtimeMs };
        }
      }
    }
  }

  return latest;
}

function checkBackupFreshness() {
  const latest = findLatestManifest(encryptedBackupDir);
  if (!latest) {
    return {
      ok: false,
      target: 'backup-freshness',
      message: `No encrypted backup manifest found in ${encryptedBackupDir}`
    };
  }

  const ageHours = (Date.now() - latest.mtimeMs) / (1000 * 60 * 60);
  if (ageHours > backupMaxAgeHours) {
    return {
      ok: false,
      target: 'backup-freshness',
      message: `Latest backup is ${ageHours.toFixed(1)}h old; threshold ${backupMaxAgeHours}h`
    };
  }

  return {
    ok: true,
    target: 'backup-freshness',
    message: `Latest backup age ${ageHours.toFixed(1)}h`
  };
}

function checkDiskUsage() {
  if (typeof fs.statfsSync !== 'function') {
    return { ok: true, target: 'disk-usage', message: 'statfs unavailable on this Node.js runtime' };
  }

  const stat = fs.statfsSync(process.env.WA_BOT_ALERT_DISK_PATH || process.cwd());
  const total = stat.blocks * stat.bsize;
  const free = stat.bfree * stat.bsize;
  const usedPercent = total > 0 ? ((total - free) / total) * 100 : 0;

  if (usedPercent >= diskWarnPercent) {
    return {
      ok: false,
      target: 'disk-usage',
      message: `Disk usage ${usedPercent.toFixed(1)}%; threshold ${diskWarnPercent}%`
    };
  }

  return {
    ok: true,
    target: 'disk-usage',
    message: `Disk usage ${usedPercent.toFixed(1)}%`
  };
}

async function sendWebhookAlert(failures, checks) {
  if (!webhookUrl) return;

  const payload = {
    service: 's-bro',
    status: 'alert',
    timestamp: nowIso(),
    failures,
    checks
  };

  const response = await fetchWithTimeout(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`alert webhook returned HTTP ${response.status}`);
  }
}

function formatTelegramMessage(failures, checks) {
  const failureLines = failures
    .map((failure) => `- ${failure.target}: ${failure.message}`)
    .join('\n');

  const okCount = checks.length - failures.length;

  return [
    'S-BRO alert',
    `Time: ${nowIso()}`,
    `Failed checks: ${failures.length}`,
    `OK checks: ${okCount}`,
    '',
    failureLines
  ].join('\n');
}

async function sendTelegramAlert(failures, checks) {
  if (!telegramBotToken || !telegramChatId) return;

  const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const response = await fetchWithTimeout(telegramUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: formatTelegramMessage(failures, checks),
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    throw new Error(`telegram alert returned HTTP ${response.status}`);
  }
}

async function main() {
  const endpointChecks = await Promise.all(endpointTargets.map(checkEndpoint));
  const checks = [
    ...endpointChecks,
    checkDiskUsage(),
    checkBackupFreshness()
  ];

  const failures = checks.filter((check) => !check.ok);
  const result = {
    status: failures.length > 0 ? 'alert' : 'ok',
    timestamp: nowIso(),
    checks
  };

  console.log(JSON.stringify(result, null, 2));

  if (failures.length > 0) {
    await Promise.all([
      sendWebhookAlert(failures, checks),
      sendTelegramAlert(failures, checks)
    ]);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'error',
    timestamp: nowIso(),
    message: error.message
  }, null, 2));
  process.exitCode = 1;
});
