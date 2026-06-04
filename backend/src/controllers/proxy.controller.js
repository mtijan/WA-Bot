import { HttpsProxyAgent } from 'https-proxy-agent';
import http from 'http';
import https from 'https';
import { dbRun, dbAll, dbGet } from '../database.js';
import { getDownloadStatus, startDownload } from '../services/iplocate.service.js';


export const getProxies = async (req, res) => {
  try {
    const proxies = await dbAll('SELECT * FROM proxies ORDER BY created_at DESC');
    res.json({ status: 'success', data: proxies });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createProxy = async (req, res) => {
  const { name, proxy_url } = req.body;
  if (!name || !proxy_url) {
    return res.status(400).json({ status: 'error', message: 'Name dan Proxy URL wajib diisi.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO proxies (name, proxy_url, status) VALUES (?, ?, ?)',
      [name, proxy_url.trim(), 'ACTIVE']
    );
    res.status(201).json({ status: 'success', message: 'Proxy berhasil ditambahkan.', data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deleteProxy = async (req, res) => {
  const { id } = req.params;
  try {
    // Kembalikan sesi-sesi yang memakai proxy ini ke null
    await dbRun('UPDATE sessions SET proxy_id = NULL WHERE proxy_id = ?', [id]);
    await dbRun('DELETE FROM proxies WHERE id = ?', [id]);
    res.json({ status: 'success', message: 'Proxy berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const testProxyConnection = async (req, res) => {
  const { id } = req.params;

  try {
    const proxy = await dbGet('SELECT * FROM proxies WHERE id = ?', [id]);
    if (!proxy) {
      return res.status(404).json({ status: 'error', message: 'Proxy tidak ditemukan.' });
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
                console.warn('[Proxy Test] Gagal parsing JSON dari iplocate:', e.message);
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
      res.json({
        status: 'success',
        working: true,
        latency: result.latency,
        geo: geo,
        message: `Proxy aktif dengan latency ${result.latency}ms.`
      });
    } else {
      await dbRun(
        'UPDATE proxies SET status = ?, country = NULL, city = NULL, isp = NULL, ip = NULL WHERE id = ?', 
        ['INACTIVE', id]
      );
      res.json({
        status: 'success',
        working: false,
        error: result.error || 'Gagal merespons (bukan status 200)',
        message: `Proxy gagal terhubung: ${result.error || 'Bukan status 200'}`
      });
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getSetting = async (req, res) => {
  const { key } = req.params;
  try {
    const setting = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
    res.json({ status: 'success', value: setting ? setting.value : '' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
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
    res.json({ status: 'success', message: 'Pengaturan berhasil disimpan.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getOfflineDbStatus = async (req, res) => {
  try {
    const status = getDownloadStatus();
    res.json({ status: 'success', data: status });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const startOfflineDbDownload = async (req, res) => {
  try {
    const result = await startDownload();
    if (result.success) {
      res.json({ status: 'success', message: result.message });
    } else {
      res.status(400).json({ status: 'error', message: result.message });
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

