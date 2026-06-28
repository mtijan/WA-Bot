import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';
import { dbRun, dbAll, dbGet } from '../database.js';
import { getDownloadStatus, startDownload } from '../services/iplocate.service.js';
import { maskProxyRecord, maskSecret } from '../utils/secret_masking.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';
import { auditLog } from '../services/audit.service.js';

export const getProxies = async (req, res) => {
  try {
    const proxies = await dbAll('SELECT * FROM proxies ORDER BY created_at DESC');
    return sendSuccess(res, proxies.map(maskProxyRecord));
  } catch (error) {
    logError('getProxies', error);
    return sendError(res, 500, 'GET_PROXIES_ERROR', 'Gagal memuat daftar proxy.');
  }
};

export const createProxy = async (req, res) => {
  const { name, proxy_url } = req.body;

  try {
    const result = await dbRun(
      'INSERT INTO proxies (name, proxy_url, status) VALUES (?, ?, ?)',
      [name, proxy_url.trim(), 'ACTIVE']
    );
    auditLog(req, 'PROXY_CREATE', 'proxy', String(result.id), 'success', { name });
    return sendSuccess(res, { id: result.id }, 201, { message: 'Proxy berhasil ditambahkan.' });
  } catch (error) {
    logError('createProxy', error, { body: req.body });
    return sendError(res, 500, 'CREATE_PROXY_ERROR', 'Gagal menyimpan proxy.');
  }
};

export const deleteProxy = async (req, res) => {
  const { id } = req.params;
  try {
    // Kembalikan sesi-sesi yang memakai proxy ini ke null
    await dbRun('UPDATE sessions SET proxy_id = NULL WHERE proxy_id = ?', [id]);
    await dbRun('DELETE FROM proxies WHERE id = ?', [id]);
    auditLog(req, 'PROXY_DELETE', 'proxy', String(id), 'success');
    return sendSuccess(res, null, 200, { message: 'Proxy berhasil dihapus.' });
  } catch (error) {
    logError('deleteProxy', error, { params: req.params });
    return sendError(res, 500, 'DELETE_PROXIES_ERROR', 'Gagal menghapus proxy.');
  }
};

export const testProxyConnection = async (req, res) => {
  const { id } = req.params;

  try {
    const proxy = await dbGet('SELECT * FROM proxies WHERE id = ?', [id]);
    if (!proxy) {
      return sendError(res, 404, 'PROXY_NOT_FOUND', 'Proxy tidak ditemukan.');
    }

    // Ambil API Key IPLocate jika dikonfigurasi
    const apiKeySetting = await dbGet("SELECT value FROM settings WHERE key = 'iplocate_api_key'");
    const apiKey = apiKeySetting ? apiKeySetting.value : null;

    const start = Date.now();
    const proxyUrl = proxy.proxy_url;
    const agent = new HttpsProxyAgent(proxyUrl);

    const check = () => {
      return new Promise((resolve) => {
        const options = {
          host: 'iplocate.io',
          port: 443,
          path: '/api/lookup/',
          agent: agent,
          headers: {},
          timeout: 6000 // 6 seconds timeout
        };

        if (apiKey) {
          options.headers['X-API-Key'] = apiKey;
        }

        const checkReq = https.get(options, (checkRes) => {
          let data = '';
          checkRes.on('data', (chunk) => {
            data += chunk;
          });

          checkRes.on('end', () => {
            const success = checkRes.statusCode === 200;
            let geo = null;
            if (success) {
              try {
                const json = JSON.parse(data);
                geo = {
                  country: json.country || null,
                  country_code: json.country_code || null,
                  city: json.city || null,
                  isp: json.asn?.name || null,
                  ip: json.ip || null
                };
              } catch (e) {
                logError('parseGeoData', e);
              }
            }
            const latency = Date.now() - start;
            resolve({ success, latency, error: null, geo });
          });
        });

        checkReq.on('error', (err) => {
          resolve({ success: false, latency: 0, error: err.message, geo: null });
        });

        checkReq.on('timeout', () => {
          checkReq.destroy();
          resolve({ success: false, latency: 0, error: 'Connection Timeout', geo: null });
        });
      });
    };

    const result = await check();

    if (result.success) {
      const geo = result.geo || {};
      await dbRun(
        'UPDATE proxies SET status = ?, country = ?, city = ?, isp = ?, ip = ? WHERE id = ?', 
        ['ACTIVE', geo.country, geo.city, geo.isp, geo.ip, id]
      );
      return sendSuccess(res, {
        working: true,
        latency: result.latency,
        geo: geo
      }, 200, { message: `Proxy aktif dengan latency ${result.latency}ms.` });
    } else {
      await dbRun(
        'UPDATE proxies SET status = ?, country = NULL, city = NULL, isp = NULL, ip = NULL WHERE id = ?', 
        ['INACTIVE', id]
      );
      return sendSuccess(res, {
        working: false,
        error: result.error || 'Gagal merespons (bukan status 200)'
      }, 200, { message: `Proxy gagal terhubung: ${result.error || 'Bukan status 200'}` });
    }
  } catch (error) {
    logError('testProxyConnection', error, { params: req.params });
    return sendError(res, 500, 'TEST_PROXY_ERROR', error.message || 'Gagal mengetes koneksi proxy.');
  }
};

export const getSetting = async (req, res) => {
  const { key } = req.params;
  try {
    const setting = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
    if (key === 'iplocate_api_key') {
      const value = setting ? setting.value : '';
      return sendSuccess(res, {
        value: '',
        has_value: Boolean(value),
        masked_value: maskSecret(value)
      });
    }
    return sendSuccess(res, { value: setting ? setting.value : '' });
  } catch (error) {
    logError('getSetting', error, { params: req.params });
    return sendError(res, 500, 'GET_SETTING_ERROR', 'Gagal memuat pengaturan.');
  }
};

export const saveSetting = async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  try {
    const existing = await dbGet('SELECT * FROM settings WHERE key = ?', [key]);
    if (existing) {
      await dbRun('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
    } else {
      await dbRun('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
    // Mask value in audit metadata — sensitive keys (e.g. iplocate_api_key) must not be logged
    const isSensitiveKey = key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token');
    auditLog(req, 'SETTING_SAVE', 'setting', key, 'success', {
      key,
      value: isSensitiveKey ? '[REDACTED]' : String(value).slice(0, 100),
      action: existing ? 'update' : 'create',
    });
    return sendSuccess(res, null, 200, { message: 'Pengaturan berhasil disimpan.' });
  } catch (error) {
    logError('saveSetting', error, { params: req.params, body: req.body });
    return sendError(res, 500, 'SAVE_SETTING_ERROR', 'Gagal menyimpan pengaturan.');
  }
};

export const getOfflineDbStatus = async (req, res) => {
  try {
    const status = getDownloadStatus();
    return sendSuccess(res, status);
  } catch (error) {
    logError('getOfflineDbStatus', error);
    return sendError(res, 500, 'GET_OFFLINE_DB_STATUS_ERROR', 'Gagal memuat status database offline.');
  }
};

export const startOfflineDbDownload = async (req, res) => {
  try {
    const result = await startDownload();
    if (result.success) {
      return sendSuccess(res, null, 200, { message: result.message });
    } else {
      return sendError(res, 400, 'START_DOWNLOAD_FAILED', result.message);
    }
  } catch (error) {
    logError('startOfflineDbDownload', error);
    return sendError(res, 500, 'START_DOWNLOAD_ERROR', error.message || 'Gagal memulai download database offline.');
  }
};
