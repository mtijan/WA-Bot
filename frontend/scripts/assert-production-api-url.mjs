import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
const forbiddenPatterns = [
  /localhost:3001\/api/i,
  /127\.0\.0\.1:3001\/api/i,
  /0\.0\.0\.0:3001\/api/i,
  /43\.157\.224\.57:3001\/api/i,
  /window\.location\.hostname\}:3001\/api/i,
  /:3001\/api/i
];

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath);
    if (entry.isFile() && /\.(js|html|css|map)$/i.test(entry.name)) return [fullPath];
    return [];
  });
}

const files = collectFiles(distDir);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push({
        file: path.relative(process.cwd(), file),
        pattern: pattern.toString()
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Production frontend build contains a private backend API URL.');
  console.error('Public VPS builds must call /api through Caddy/Nginx, never :3001 directly.');
  console.error('Fix: remove or set VITE_API_URL=/api in frontend .env.production, then rebuild.');
  console.error(JSON.stringify(violations, null, 2));
  process.exit(1);
}

console.log('Production API URL guard passed: frontend bundle does not expose :3001/api.');
