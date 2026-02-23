/**
 * Debug why "Modulr x Vu Jade Accountancy - 4465057c-b8fe-4657-84ac-dc22fb73c1af"
 * has a transcript in Salesloft but the app doesn't pull it.
 * Run from project root: node server/scripts/debug-vu-jade-call.js
 *
 * Usage: CONV_ID=4465057c-b8fe-4657-84ac-dc22fb73c1af node server/scripts/debug-vu-jade-call.js
 *        (or edit CONV_ID below)
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

const CONV_ID = process.env.CONV_ID || '4465057c-b8fe-4657-84ac-dc22fb73c1af';
const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const key = (process.env.SALESLOFT_API_KEY || '').trim();
if (!key) {
  console.error('No SALESLOFT_API_KEY in .env');
  process.exit(1);
}

function truncate(obj, maxLen = 200) {
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
  console.log('=== Debug transcript for conversation:', CONV_ID, '===\n');

  // 1) GET /conversations/:id — does it exist?
  console.log('1) GET /v2/conversations/' + CONV_ID);
  const convRes = await fetch(`${SALESLOFT_BASE}/conversations/${encodeURIComponent(CONV_ID)}`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  console.log('   Status:', convRes.status);
  if (!convRes.ok) {
    const text = await convRes.text();
    console.log('   Body:', text.slice(0, 500));
    console.log('\n   If 404: this ID might be a call/activity ID, not a conversation ID.');
    return;
  }
  const convJson = await convRes.json();
  const conv = convJson.data ?? convJson.conversation ?? convJson;
  const updatedAt = conv.updated_at ?? conv.created_at ?? conv.occurred_at;
  console.log('   updated_at:', updatedAt);
  console.log('   created_at:', conv.created_at);
  console.log('   occurred_at:', conv.occurred_at);
  console.log('   title:', (conv.title || '').slice(0, 80));

  // 2) GET /conversations/:id/extensive — transcription id and inline transcript
  console.log('\n2) GET /v2/conversations/' + CONV_ID + '/extensive');
  const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${encodeURIComponent(CONV_ID)}/extensive`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  console.log('   Status:', extRes.status);
  if (!extRes.ok) {
    console.log('   Body:', (await extRes.text()).slice(0, 400));
    return;
  }
  const extJson = await extRes.json();
  const data = extJson.data ?? extJson.conversation ?? extJson;
  const transId = data.transcription?.id ?? data.transcription_id ?? (data.transcription && typeof data.transcription === 'object' && data.transcription.id) ?? null;
  console.log('   transcription.id / transcription_id:', transId);
  const inlineTranscript = data.transcript ?? data.transcript_text ?? data.text ?? data.content ?? null;
  console.log('   inline transcript (length):', inlineTranscript ? String(inlineTranscript).length : 0);
  if (data.summary && (data.summary.text || data.summary)) {
    console.log('   summary present: yes');
  }

  // 3) GET /transcriptions?conversation_id=X
  console.log('\n3) GET /v2/transcriptions?conversation_id=' + CONV_ID);
  const listUrl = new URL(`${SALESLOFT_BASE}/transcriptions`);
  listUrl.searchParams.set('per_page', '100');
  listUrl.searchParams.set('conversation_id', String(CONV_ID));
  const listRes = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${key}` } });
  console.log('   Status:', listRes.status);
  const listJson = await listRes.ok ? await listRes.json() : null;
  const list = listJson ? (listJson.data ?? listJson.results ?? listJson.transcriptions ?? []) : [];
  const arr = Array.isArray(list) ? list : [];
  console.log('   Transcriptions returned:', arr.length);
  if (arr.length > 0) {
    arr.forEach((t, i) => {
      const tid = t.id ?? t.transcription_id;
      const cid = t.conversation_id ?? t.conversation?.id ?? '';
      console.log('   [' + i + '] id=', tid, 'conversation_id=', cid, 'match=', String(cid) === String(CONV_ID));
    });
  } else if (listJson && listJson.metadata) {
    console.log('   metadata:', truncate(listJson.metadata));
  }

  // 4) fetchTranscriptById if we have a transcription id
  const tidToUse = transId || (arr[0] && (arr[0].id ?? arr[0].transcription_id));
  if (tidToUse) {
    console.log('\n4) Fetch transcript by id:', tidToUse);
    const sentUrl = `${SALESLOFT_BASE}/transcriptions/${encodeURIComponent(tidToUse)}/sentences?per_page=100&page=1`;
    const sentRes = await fetch(sentUrl, { headers: { Authorization: `Bearer ${key}` } });
    console.log('   GET .../sentences Status:', sentRes.status);
    if (sentRes.ok) {
      const sentJson = await sentRes.json();
      const sentences = sentJson.data ?? sentJson.results ?? sentJson.sentences ?? [];
      const meta = sentJson.metadata ?? sentJson;
      console.log('   Sentences count:', sentences.length, 'total_pages:', meta.total_pages);
      if (sentences.length > 0) {
        const texts = sentences.map((s) => s.text ?? s.content ?? s.value ?? '').filter(Boolean);
        console.log('   First sentence (first 80 chars):', (texts[0] || '').slice(0, 80));
      }
    } else {
      console.log('   Body:', (await sentRes.text()).slice(0, 300));
    }

    const artifactRes = await fetch(`${SALESLOFT_BASE}/transcriptions/${encodeURIComponent(tidToUse)}/artifact`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    console.log('   GET .../artifact Status:', artifactRes.status);

    const mainRes = await fetch(`${SALESLOFT_BASE}/transcriptions/${encodeURIComponent(tidToUse)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    console.log('   GET .../transcriptions/:id Status:', mainRes.status);
  } else {
    console.log('\n4) No transcription id available — cannot call sentences/artifact.');
  }

  // 5) Run the real getConversationTranscript and report
  console.log('\n5) getConversationTranscript(apiKey, CONV_ID)');
  const { getConversationTranscript } = await import('../salesloftSimple.js');
  const result = await getConversationTranscript(key, CONV_ID);
  console.log('   transcript length:', result.transcript ? result.transcript.length : 0);
  console.log('   rep:', result.rep);
  console.log('   account:', result.account);
  if (!result.transcript || !result.transcript.trim()) {
    console.log('\n   >>> No transcript returned. Likely causes:');
    console.log('   - extensive did not return transcription id and no inline transcript/summary');
    console.log('   - GET /transcriptions?conversation_id=... returned 0 or no matching conversation_id');
    console.log('   - sentences/artifact/GET transcription all returned empty');
  } else {
    console.log('\n   >>> Transcript found (first 150 chars):', result.transcript.slice(0, 150) + '...');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
