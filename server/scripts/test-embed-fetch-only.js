/**
 * Test OpenAI embeddings with only fetch (no OpenAI SDK). Run: node server/scripts/test-embed-fetch-only.js
 */
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  let raw = readFileSync(rootEnv, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  Object.assign(process.env, dotenv.parse(raw));
}

const key = (process.env.OPENAI_API_KEY || '').trim();
console.log('Calling OpenAI embeddings with fetch...');
const res = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'text-embedding-3-small', input: ['Hello world'] }),
});
const data = await res.json();
console.log('Status:', res.status, 'embedding length:', data.data?.[0]?.embedding?.length ?? 0);
if (!res.ok) console.error(data);
