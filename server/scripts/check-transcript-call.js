/**
 * Check that the transcript for a given call starts and ends with expected text.
 * Run from project root: node server/scripts/check-transcript-call.js
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getConversationTranscript } from '../salesloftSimple.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  const raw = readFileSync(rootEnv, 'utf8').replace(/^\uFEFF/, '');
  Object.assign(process.env, dotenv.parse(raw));
}

const CONV_ID = 'a7b8c222-7dc4-4c45-bba3-e687d50e3cf7';
const EXPECTED_FIRST = 'Pretty busy busy.';
const EXPECTED_LAST = 'Alright, thanks, bye bye.';

const key = (process.env.SALESLOFT_API_KEY || '').trim();
if (!key) {
  console.error('No SALESLOFT_API_KEY in .env');
  process.exit(1);
}

async function main() {
  console.log('Fetching transcript for conversation:', CONV_ID);
  const { transcript, rep, account } = await getConversationTranscript(key, CONV_ID);

  if (!transcript || !transcript.trim()) {
    console.log('\nResult: NO TRANSCRIPT returned.');
    process.exit(1);
  }

  const t = transcript.trim();
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const firstLine = lines.length ? lines[0] : t.slice(0, 80);
  const lastLine = lines.length > 1 ? lines[lines.length - 1] : (lines.length === 1 ? lines[0] : t.slice(-80));

  // Check start/end of full text (in case there are no newlines)
  const startsOk = t.startsWith(EXPECTED_FIRST) || firstLine.startsWith(EXPECTED_FIRST);
  const endsOk = t.endsWith(EXPECTED_LAST) || lastLine.endsWith(EXPECTED_LAST);

  console.log('\n--- First line (or start) ---');
  console.log(firstLine.slice(0, 120) + (firstLine.length > 120 ? '...' : ''));
  console.log('\n--- Last line (or end) ---');
  console.log((lastLine.length > 120 ? '...' : '') + lastLine.slice(-120));
  console.log('\n--- Check ---');
  console.log('Expected first:', JSON.stringify(EXPECTED_FIRST));
  console.log('Starts with expected:', startsOk ? 'YES' : 'NO');
  console.log('Expected last:', JSON.stringify(EXPECTED_LAST));
  console.log('Ends with expected:', endsOk ? 'YES' : 'NO');
  console.log('Transcript length (chars):', t.length);

  if (!startsOk || !endsOk) process.exit(1);
  console.log('\nTranscript for this call starts and ends as expected.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
