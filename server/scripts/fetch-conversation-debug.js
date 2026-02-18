/**
 * One-off: fetch conversation 36f73019-db6e-4471-b408-db0c9109a58c and log full response
 * so we can see where rep "Nathan Macdonald" lives in the API.
 * Run from project root: node server/scripts/fetch-conversation-debug.js
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

const CONV_ID = '36f73019-db6e-4471-b408-db0c9109a58c';
const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const key = (process.env.SALESLOFT_API_KEY || '').trim();
if (!key) {
  console.error('No SALESLOFT_API_KEY in .env');
  process.exit(1);
}

async function main() {
  console.log('Fetching GET /v2/conversations/' + CONV_ID + ' ...\n');

  const res = await fetch(`${SALESLOFT_BASE}/conversations/${CONV_ID}`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });

  console.log('Status:', res.status);
  const json = await res.json();

  // Log full structure (truncate long strings for readability)
  function truncate(obj, maxLen = 120) {
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

  console.log('Response (truncated long strings):');
  console.log(JSON.stringify(truncate(json), null, 2));

  // Also try extensive
  console.log('\n--- GET /v2/conversations/:id/extensive ---\n');
  const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${CONV_ID}/extensive`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  console.log('Extensive status:', extRes.status);
  const extJson = await extRes.json();
  console.log('Extensive response (truncated):');
  console.log(JSON.stringify(truncate(extJson), null, 2));
}

async function proveRep() {
  const { getConversationMetadata, getConversationTranscript } = await import('../salesloftSimple.js');
  console.log('\n--- Proving rep resolution via getConversationMetadata + getConversationTranscript ---\n');
  const meta = await getConversationMetadata(key, CONV_ID);
  console.log('getConversationMetadata result:', meta);
  const full = await getConversationTranscript(key, CONV_ID);
  console.log('getConversationTranscript result (rep, account, deal_stage):', {
    rep: full.rep,
    account: full.account,
    deal_stage: full.deal_stage,
    hasTranscript: !!full.transcript,
  });
  if (full.rep && full.rep.toLowerCase().includes('nathan')) {
    console.log('\n✓ Rep found: "' + full.rep + '"');
  } else {
    console.log('\n✗ Rep not found or wrong (expected Nathan Macdonald)');
  }
  if (full.deal_stage === 'SAO') {
    console.log('✓ Deal stage correct: "' + full.deal_stage + '"');
  } else {
    console.log('✗ Deal stage wrong (got "' + (full.deal_stage || '') + '", expected SAO)');
  }
}

async function debugDealStage() {
  console.log('\n--- Debug deal stage (expected SAO, we were getting Disqualified) ---\n');
  const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${CONV_ID}/extensive`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  const extJson = await extRes.json();
  const data = extJson.data ?? extJson;
  const opportunityId = data.opportunity?.id ?? data.opportunity_id;
  const accountId = data.account?.id ?? data.account_id;

  if (opportunityId) {
    console.log('GET /v2/opportunities/' + opportunityId);
    const oppRes = await fetch(`${SALESLOFT_BASE}/opportunities/${opportunityId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const oppJson = await oppRes.json();
    console.log('Opportunity response:', JSON.stringify(oppJson, null, 2));
  }

  if (accountId) {
    console.log('\nGET /v2/account_stages?account_id=' + accountId);
    const asRes = await fetch(`${SALESLOFT_BASE}/account_stages?per_page=50&account_id=${accountId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const asJson = await asRes.json();
    console.log('Account stages response:', JSON.stringify(asJson, null, 2));
  }

  console.log('\nGET /v2/person_stages (first page, no filter)');
  const psRes = await fetch(`${SALESLOFT_BASE}/person_stages?per_page=5`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const psJson = await psRes.json();
  console.log('Person stages (sample):', JSON.stringify(psJson, null, 2));
}

main()
  .then(() => proveRep())
  .then(() => debugDealStage())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
