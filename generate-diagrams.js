import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mdPath = path.join(__dirname, 'sdlc_documentation.md');
const outputDir = path.join(__dirname, 'docs', 'images');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const mdContent = fs.readFileSync(mdPath, 'utf8');

// Pembagian baris dokumen untuk penelusuran judul secara presisi
const lines = mdContent.split('\n');

const mermaidRegex = /```mermaid([\s\S]*?)```/g;
let match;
const diagrams = [];

while ((match = mermaidRegex.exec(mdContent)) !== null) {
  const code = match[1].trim();
  const index = match.index;
  
  // Mencari judul terdekat di atas blok mermaid
  let heading = 'diagram';
  let charCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1; // +1 untuk karakter newline
    if (charCount > index) {
      // Telah melewati awal blok mermaid, cari judul (#) mundur dari baris ini
      for (let j = i; j >= 0; j--) {
        if (lines[j].startsWith('#')) {
          heading = lines[j].replace(/^#+\s+/, '').trim();
          break;
        }
      }
      break;
    }
  }
  
  // Format nama file PNG
  const fileName = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_+)|(_+$)/g, '') + '.png';
    
  diagrams.push({ heading, code, fileName });
}

console.log(`[INFO] Menemukan ${diagrams.length} diagram Mermaid. Mengunduh PNG...`);

// Mengompres kode diagram menggunakan Zlib Deflate + Base64 URL-safe (Kroki API Standard)
const getKrokiUrl = (code) => {
  const buffer = Buffer.from(code, 'utf8');
  const compressed = zlib.deflateSync(buffer); // Menggunakan deflateSync (bukan deflateRawSync)
  const base64 = compressed.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `https://kroki.io/mermaid/png/${base64}`;
};

const downloadImage = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Server merespons dengan status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

const run = async () => {
  for (const diag of diagrams) {
    const url = getKrokiUrl(diag.code);
    const dest = path.join(outputDir, diag.fileName);
    
    console.log(`[Proses] Mengunduh ${diag.heading} -> docs/images/${diag.fileName}...`);
    try {
      await downloadImage(url, dest);
      console.log(`  [SUKSES] Berhasil disimpan.`);
    } catch (err) {
      console.error(`  [GAGAL] Gagal mengunduh:`, err.message);
    }
  }
  console.log('\n[SELESAI] Semua diagram Mermaid telah diekspor menjadi berkas PNG!');
};

run();
