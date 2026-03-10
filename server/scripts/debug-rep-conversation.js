/**
 * Debug where rep (e.g. Scott Deane) lives in Salesloft API responses.
 * Run from project root: node server/scripts/debug-rep-conversation.js [conversationId]
 * Example: node server/scripts/debug-rep-conversation.js 5a2c47b7-6cfd-4b28-b1bc-61c6ade1805d
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  const raw = readFileSync(rootEnv, 'utf8').replace(/^\uFEFF/, '');
  Object.assign(process.env, dotenv.parse(raw));
}

const CONV_ID = process.argv[2] || '5a2c47b7-6cfd-4b28-b1bc-61c6ade1805d';
const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const key = (process.env.SALESLOFT_API_KEY || '').trim();
if (!key) {
  console.error('No SALESLOFT_API_KEY in .env');
  process.exit(1);
}

function truncate(obj, maxLen = 150) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.length <= maxLen ? obj : obj.slice(0, maxLen) + '...';
  if (Array.isArray(obj)) return obj.map((o) => truncate(o, maxLen));
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = truncate(obj[k], maxLen);
    return out;
  }
  return obj;
}

async function main() {
  console.log('Conversation ID:', CONV_ID);
  console.log('');

  const convRes = await fetch(`${SALESLOFT_BASE}/conversations/${CONV_ID}`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  console.log('GET /conversations/:id  status:', convRes.status);
  if (convRes.ok) {
    const conv = await convRes.json();
    console.log('Top-level keys:', Object.keys(conv));
    const c = conv.data ?? conv.conversation ?? conv;
    console.log('Conversation object keys:', Object.keys(c));
    console.log('owner_id:', c.owner_id);
    console.log('user_id:', c.user_id);
    console.log('created_by_id:', c.created_by_id);
    console.log('user:', truncate(c.user));
    console.log('created_by:', truncate(c.created_by));
    console.log('recording:', truncate(c.recording));
    console.log('Full (truncated):', JSON.stringify(truncate(conv), null, 2));
  }
  console.log('');

  const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${CONV_ID}/extensive`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  console.log('GET /conversations/:id/extensive  status:', extRes.status);
  if (extRes.ok) {
    const ext = await extRes.json();
    console.log('Top-level keys:', Object.keys(ext));
    const data = ext.data ?? ext.conversation ?? ext;
    console.log('Data object keys:', Object.keys(data));
    console.log('user:', truncate(data.user));
    console.log('owner:', truncate(data.owner));
    console.log('created_by:', truncate(data.created_by));
    console.log('owner_email:', data.owner_email);
    console.log('invitees:', truncate(data.invitees));
    console.log('participants:', truncate(data.participants));
    console.log('transcription:', truncate(data.transcription));
    console.log('recording:', truncate(data.recording));
  }
  console.log('');

  const listUrl = new URL(`${SALESLOFT_BASE}/transcriptions`);
  listUrl.searchParams.set('per_page', '100');
  listUrl.searchParams.set('conversation_id', CONV_ID);
  const listRes = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${key}` } });
  console.log('GET /transcriptions?conversation_id=...  status:', listRes.status);
  if (listRes.ok) {
    const listJson = await listRes.json();
    const list = listJson.data ?? listJson.results ?? listJson.transcriptions ?? [];
    const trans = Array.isArray(list) ? list[0] : null;
    if (trans) {
      const tid = trans.id ?? trans.transcription_id;
      console.log('First transcription id:', tid);
      if (tid) {
        const tRes = await fetch(`${SALESLOFT_BASE}/transcriptions/${tid}`, {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        });
        console.log('GET /transcriptions/:id  status:', tRes.status);
        if (tRes.ok) {
          const tJson = await tRes.json();
          const t = tJson.data ?? tJson.transcription ?? tJson;
          console.log('Transcription object keys:', Object.keys(t));
          console.log('user_id:', t.user_id);
          console.log('created_by_id:', t.created_by_id);
          console.log('owner_id:', t.owner_id);
          console.log('user:', truncate(t.user));
          console.log('created_by:', truncate(t.created_by));
        }
      }
    } else {
      console.log('No transcriptions in list');
    }
  }
  console.log('');

  const { getConversationTranscript } = await import('../salesloftSimple.js');
  const full = await getConversationTranscript(key, CONV_ID);
  console.log('getConversationTranscript result rep:', full.rep);
  console.log('getConversationTranscript result account:', full.account);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
