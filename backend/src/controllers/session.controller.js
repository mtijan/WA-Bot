import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbGet, dbRun } from '../database.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

export const getSessions = async (req, res) => {
  try {
    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.listSessions();
      return res.json(payload);
    }

    const dbSessions = await dbAll(
      `SELECT s.*, p.name as proxy_name, p.proxy_url as resolved_proxy_url 
       FROM sessions s 
       LEFT JOIN proxies p ON s.proxy_id = p.id`
    );
    const result = [];
    
    for (const session of dbSessions) {
      const liveData = await whatsappService.getSessionStatus(session.session_id);
      result.push(liveData || {
        session_id: session.session_id,
        phone_number: session.phone_number,
        status: session.status,
        proxy_id: session.proxy_id,
        proxy_name: session.proxy_name,
        proxy_url: session.resolved_proxy_url || session.proxy_url,
        qr_code: null
      });
    }
    
    res.json({ status: 'success', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const createSession = async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'session_id wajib diisi.' });
  }

  try {
    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.initSession(session_id);
      return res.status(201).json(payload);
    }

    // Pastikan entri sesi ada atau diperbarui di DB sebelum inisialisasi, proxy_id diatur ke null
    const existing = await dbGet('SELECT * FROM sessions WHERE session_id = ?', [session_id]);
    if (existing) {
      await dbRun('UPDATE sessions SET proxy_id = NULL WHERE session_id = ?', [session_id]);
    } else {
      await dbRun('INSERT INTO sessions (session_id, status, proxy_id) VALUES (?, ?, NULL)', [session_id, 'DISCONNECTED']);
    }

    // Inisialisasi sesi di background
    await whatsappService.initSession(session_id);

    // Polling kecil untuk mendapatkan status pertama (CONNECTED atau QR Code)
    let checkCount = 0;
    const checkState = async () => {
      const statusObj = await whatsappService.getSessionStatus(session_id);
      if (statusObj && (statusObj.status === 'CONNECTED' || statusObj.qr_code)) {
        return statusObj;
      }
      if (checkCount < 10) { // Menunggu maksimal 5 detik
        checkCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
        return checkState();
      }
      return statusObj;
    };

    const finalStatus = await checkState();
    res.status(201).json({
      status: 'success',
      message: 'Sesi diinisialisasi.',
      data: finalStatus
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const deleteSession = async (req, res) => {
  const { id } = req.params;
  try {
    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.deleteSession(id);
      return res.json(payload);
    }

    await whatsappService.deleteSession(id);
    res.json({ status: 'success', message: `Sesi ${id} berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

export const updateSessionProxy = async (req, res) => {
  const { id } = req.params;
  const { proxy_id } = req.body;

  try {
    if (isSessionManagerClientEnabled()) {
      const payload = await sessionManagerClient.updateSessionProxy(id, proxy_id);
      return res.json(payload);
    }

    // 1. Update database
    await dbRun('UPDATE sessions SET proxy_id = ? WHERE session_id = ?', [proxy_id || null, id]);

    // 2. Cek apakah socket sesi ini sedang berjalan aktif
    const activeSock = whatsappService.sockets[id];
    if (activeSock) {
      console.log(`[WA Server] Proxy untuk sesi ${id} diperbarui menjadi proxy_id: ${proxy_id || 'null'}. Memutuskan koneksi soket aktif...`);
      // Panggil .end() untuk memutuskan soket secara bersih, Baileys akan otomatis reconnect
      try {
        activeSock.end(new Error('Proxy changed'));
      } catch (err) {
        console.warn(`[WA Server] Gagal memutuskan soket sesi ${id}:`, err.message);
      }
    }

    res.json({
      status: 'success',
      message: 'Proxy sesi berhasil diperbarui.'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
