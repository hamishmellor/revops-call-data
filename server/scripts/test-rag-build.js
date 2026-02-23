/**
 * Test RAG build with one minimal transcript to see the actual error.
 * Run from project root: node server/scripts/test-rag-build.js
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
console.log('OPENAI_API_KEY set:', !!key, '(length:', key.length, ')');

const transcripts = [
  {
    id: 'test-1',
    conversationId: 'test-1',
    title: 'Test call',
    date: '2025-01-01',
    rep: 'Test Rep',
    account: 'Test Account',
    transcript: 'This is a short test transcript for RAG build. It has a few words to chunk.',
  },
];

async function main() {
  const { buildRag } = await import('../rag.js');
  console.log('Calling buildRag with', transcripts.length, 'transcript(s)...');
  try {
    const result = await buildRag(transcripts, key || undefined);
    console.log('Success. Chunks:', result.chunks);
  } catch (err) {
    console.error('buildRag failed:');
    console.error('  message:', err?.message);
    console.error('  status:', err?.status);
    console.error('  error:', err?.error);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
