/**
 * Runs POST /run-analysis with mock data (no SALESLOFT or OpenAI keys required).
 * Use: node scripts/run-mock-analysis.js (from server directory) or npm run test:integration (from root).
 */

import dotenv from 'dotenv';
import http from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from project root (parent of server)
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const opts = { hostname: url.hostname, port: url.port || 3001, path: url.pathname, method };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.setHeader('Content-Type', 'application/json'), req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('Running mock analysis (POST /run-analysis)...');
  const { status, data } = await request('POST', '/run-analysis', {
    startDate: '2025-02-01',
    endDate: '2025-02-28',
  });
  if (status !== 200) {
    console.error('Error:', status, data);
    process.exit(1);
  }
  console.log('Result:', data);
  const get = await request('GET', '/insights');
  if (get.status === 200 && get.data) {
    console.log('Insights count:', get.data.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
