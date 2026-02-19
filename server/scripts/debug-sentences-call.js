/**
 * Debug: fetch raw sentences for a conversation and show first/last and whether expected text appears.
 * Run: node server/scripts/debug-sentences-call.js
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  Object.assign(process.env, dotenv.parse(readFileSync(rootEnv, 'utf8').replace(/^\uFEFF/, '')));
}

const CONV_ID = 'a7b8c222-7dc4-4c45-bba3-e687d50e3cf7';
const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const key = (process.env.SALESLOFT_API_KEY || '').trim();
if (!key) {
  console.error('No SALESLOFT_API_KEY');
  process.exit(1);
}

async function getTranscriptionId() {
  const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${encodeURIComponent(CONV_ID)}/extensive`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!extRes.ok) throw new Error(`extensive ${extRes.status}`);
  const ext = await extRes.json();
  const data = ext.data ?? ext.conversation ?? ext;
  const transId = data.transcription?.id ?? data.transcription_id ?? data.transcription?.id ?? null;
  if (transId) return transId;
  const listRes = await fetch(
    `${SALESLOFT_BASE}/transcriptions?conversation_id=${encodeURIComponent(CONV_ID)}&per_page=10`,
    { headers: { Authorization: `Bearer ${key}` } }
  );
  if (!listRes.ok) throw new Error(`list transcriptions ${listRes.status}`);
  const listJson = await listRes.json();
  const list = listJson.data ?? listJson.results ?? [];
  const t = list.find((x) => String(x.conversation_id ?? x.conversation?.id ?? '') === CONV_ID) ?? list[0];
  return t?.id ?? t?.transcription_id ?? null;
}

async function main() {
  const transId = await getTranscriptionId();
  if (!transId) {
    console.error('No transcription id for conversation', CONV_ID);
    process.exit(1);
  }
  console.log('Transcription id:', transId);

  const all = [];
  let page = 1;
  const perPage = 100;
  let totalPages = null;
  while (page <= 100) {
    const url = `${SALESLOFT_BASE}/transcriptions/${transId}/sentences?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      console.log('Sentences response', res.status);
      break;
    }
    const json = await res.json();
    const meta = json.metadata ?? json;
    if (totalPages == null && meta.total_pages != null) totalPages = Number(meta.total_pages);
    const list = json.data ?? json.results ?? json.sentences ?? [];
    if (list.length === 0) break;
    all.push(...list);
    const nextPage = meta.next_page ?? json.next_page;
    if (nextPage != null && nextPage > page) page = nextPage;
    else if (totalPages != null && page < totalPages) page += 1;
    else break;
  }

  console.log('Total sentences:', all.length, 'total_pages:', totalPages);
  const texts = all.map((s) => (s.text ?? s.content ?? s.value ?? '').trim()).filter(Boolean);
  if (texts.length === 0) {
    console.log('No sentence texts found. Sample keys:', all[0] ? Object.keys(all[0]) : []);
    return;
  }

  console.log('\n--- First 5 sentence texts ---');
  texts.slice(0, 5).forEach((t, i) => console.log((i + 1) + '.', t.slice(0, 100) + (t.length > 100 ? '...' : '')));
  console.log('\n--- Last 5 sentence texts ---');
  texts.slice(-5).forEach((t, i) => console.log((texts.length - 4 + i) + '.', t.slice(0, 100) + (t.length > 100 ? '...' : '')));

  const hasFirst = texts.some((t) => t.includes('Pretty busy busy') || t.startsWith('Pretty busy busy'));
  const hasLast = texts.some((t) => t.includes('Alright, thanks, bye bye') || t.includes('bye bye'));
  console.log('\nContains "Pretty busy busy":', hasFirst);
  console.log('Contains "Alright, thanks, bye bye":', hasLast);

  if (all[0]) {
    console.log('\nFirst sentence object keys:', Object.keys(all[0]));
    console.log('First sentence sample:', JSON.stringify({ ...all[0], text: (all[0].text || '').slice(0, 80) }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
