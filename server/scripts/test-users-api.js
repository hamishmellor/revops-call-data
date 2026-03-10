/**
 * Test GET /v2/users/:id with owner_guid from conversation. Run: node server/scripts/test-users-api.js
 */
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  Object.assign(process.env, dotenv.parse(readFileSync(rootEnv, 'utf8')));
}

const key = (process.env.SALESLOFT_API_KEY || '').trim();
const userId = process.argv[2] || '431190ad-2486-4cee-8ce4-58885f431d14';

const res = await fetch(`https://api.salesloft.com/v2/users/${userId}`, {
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
});
console.log('GET /v2/users/' + userId + '  status:', res.status);
const text = await res.text();
console.log('Body:', text.slice(0, 800));
