import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { dbGet } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'iplocate');

// State unduhan di memori
let downloadState = {
  status: 'idle', // 'idle' | 'downloading' | 'completed' | 'error'
  currentFile: '',
  bytesDownloaded: 0,
  totalBytes: 0,
  percent: 0,
  error: null
};

// URL Download Default
const DEFAULT_API_KEY = '2f066169ff2bd20f3cd4e4c75fd4a155';
const FILES_TO_DOWNLOAD = [
  {
    name: 'ip-to-country.csv',
    urlPattern: 'https://www.iplocate.io/download/ip-to-country.csv?apikey={API_KEY}&variant={VARIANT}'
  },
  {
    name: 'ip-to-country-geolite2.csv',
    urlPattern: 'https://www.iplocate.io/download/ip-to-country-geolite2.csv?apikey={API_KEY}&variant={VARIANT}'
  },
  {
    name: 'ip-to-asn.csv',
    urlPattern: 'https://www.iplocate.io/download/ip-to-asn.csv?apikey={API_KEY}&variant={VARIANT}'
  }
];

export const getDownloadStatus = () => {
  // Hitung juga file lokal asli yang ada di disk untuk menyajikan ukuran real-time
  const filesInfo = FILES_TO_DOWNLOAD.map(file => {
    const filePath = path.join(DATA_DIR, file.name);
    let exists = false;
    let sizeBytes = 0;
    let lastModified = null;

    if (fs.existsSync(filePath)) {
      exists = true;
      const stats = fs.statSync(filePath);
      sizeBytes = stats.size;
      lastModified = stats.mtime;
    }

    return {
      name: file.name,
      exists,
      sizeBytes,
      lastModified
    };
  });

  return {
    state: downloadState,
    files: filesInfo
  };
};

const downloadFile = (url, destPath, fileName) => {
  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      https.get(targetUrl, (res) => {
        // Penanganan Redirect (301, 302, 307, 308)
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            console.log(`[Offline DB] Mengikuti redirect ke: ${redirectUrl}`);
            return request(redirectUrl);
          }
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Gagal mengunduh ${fileName}. Status: ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let bytesDownloaded = 0;
        
        downloadState.currentFile = fileName;
        downloadState.totalBytes = totalBytes;
        downloadState.bytesDownloaded = 0;
        downloadState.percent = 0;

        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          bytesDownloaded += chunk.length;
          downloadState.bytesDownloaded = bytesDownloaded;
          if (totalBytes > 0) {
            downloadState.percent = Math.round((bytesDownloaded / totalBytes) * 100);
          }
        });

        fileStream.on('error', (err) => {
          fileStream.close();
          reject(err);
        });

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        res.pipe(fileStream);
      }).on('error', (err) => {
        reject(err);
      });
    };

    request(url);
  });
};

export const startDownload = async () => {
  if (downloadState.status === 'downloading') {
    return { success: false, message: 'Proses pengunduhan sedang berjalan.' };
  }

  // Ambil API Key dari setting jika ada
  let apiKey = DEFAULT_API_KEY;
  try {
    const apiKeySetting = await dbGet("SELECT value FROM settings WHERE key = 'iplocate_api_key'");
    if (apiKeySetting && apiKeySetting.value && apiKeySetting.value.trim() !== '') {
      apiKey = apiKeySetting.value.trim();
    }
  } catch (err) {
    console.error('[Offline DB] Gagal memuat API Key dari database:', err);
  }

  // Set status ke downloading
  downloadState = {
    status: 'downloading',
    currentFile: '',
    bytesDownloaded: 0,
    totalBytes: 0,
    percent: 0,
    error: null
  };

  // Jalankan asinkron
  (async () => {
    // Pastikan folder data ada
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    try {
      for (const file of FILES_TO_DOWNLOAD) {
        const fileUrl = file.urlPattern
          .replace('{API_KEY}', apiKey)
          .replace('{VARIANT}', 'daily');
        
        const destPath = path.join(DATA_DIR, file.name);
        const tempPath = destPath + '.tmp';

        console.log(`[Offline DB] Mengunduh ${file.name} dari ${fileUrl}...`);
        await downloadFile(fileUrl, tempPath, file.name);

        // Rename tmp file ke asli setelah sukses
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        fs.renameSync(tempPath, destPath);
        console.log(`[Offline DB] Selesai mengunduh ${file.name}`);
      }

      downloadState.status = 'completed';
      downloadState.currentFile = '';
      downloadState.percent = 100;
    } catch (err) {
      console.error('[Offline DB] Error saat mengunduh database:', err);
      downloadState.status = 'error';
      downloadState.error = err.message;
    }
  })();

  return { success: true, message: 'Pengunduhan database dimulai di latar belakang.' };
};
