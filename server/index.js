/**
 * Salesloft Pricing Signal Extractor — Express server.
 * POST /run-analysis, GET /insights, DELETE /insights
 */

import dotenv from 'dotenv';
import express from 'express';
import { getDbInstance, clearInsights, insertInsight, getAllInsights } from './db.js';
import { listCalls, fetchConversationsWithTranscripts } from './salesloftSimple.js';
import { extractPricingInsights, delayBetweenCalls } from './pricingExtractor.js';
import { getMockInsight } from './mockExtractor.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env: try project root (parent of server/) then cwd; strip BOM so keys are read correctly
const rootEnv = resolve(__dirname, '..', '.env');
const cwdEnv = resolve(process.cwd(), '.env');
const cwdParentEnv = resolve(process.cwd(), '..', '.env');
const envPath = existsSync(rootEnv) ? rootEnv : existsSync(cwdParentEnv) ? cwdParentEnv : existsSync(cwdEnv) ? cwdEnv : null;
if (envPath) {
  const raw = readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = dotenv.parse(raw);
  Object.assign(process.env, parsed);
  console.log('[server] Loaded .env from', envPath);
} else {
  console.warn('[server] No .env found (tried root and cwd). Using env vars or paste keys in UI.');
}
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS for local Vite dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Initialize DB on startup
getDbInstance();
console.log('[server] DB initialized (DB_PATH=%s)', process.env.DB_PATH || ':memory:');

/** GET /salesloft-calls — minimal: just list call id, date, title from Salesloft (no OpenAI, no metadata). Proof of Salesloft access. */
app.get('/salesloft-calls', async (req, res) => {
  try {
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Query params startDate and endDate required (YYYY-MM-DD)' });
    }
    const apiKey = (req.query.apiKey || process.env.SALESLOFT_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'Salesloft API key required. Set in .env as SALESLOFT_API_KEY or pass apiKey in query.' });
    }
    const calls = await listCalls(apiKey, startDate, endDate);
    res.json(calls);
  } catch (err) {
    console.error('[server] /salesloft-calls error:', err.message);
    res.status(err.message.includes('401') ? 401 : 502).json({ error: err.message });
  }
});

/** GET /export-transcripts-stream — SSE stream: progress events then done with conversations. Used by client for loading indicator. */
app.get('/export-transcripts-stream', async (req, res) => {
  const startDate = req.query.startDate || '';
  const endDate = req.query.endDate || '';
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Query params startDate and endDate required (YYYY-MM-DD)' });
  }
  const apiKey = (req.query.apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(400).json({ error: 'Salesloft API key required. Set in .env as SALESLOFT_API_KEY.' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    const conversations = await fetchConversationsWithTranscripts(apiKey, startDate, endDate, {
      maxConversations: Infinity,
      onProgress(current, total) {
        send({ type: 'progress', current, total });
      },
    });
    send({ type: 'done', conversations });
  } catch (err) {
    console.error('[server] /export-transcripts-stream error:', err.message);
    send({ type: 'error', error: err.message || 'Fetch failed' });
  } finally {
    res.end();
  }
});

/** GET /export-transcripts — fetch raw transcripts for date range. ?format=txt (default, best for LLM) or ?format=json. */
app.get('/export-transcripts', async (req, res) => {
  try {
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const format = (req.query.format || 'txt').toLowerCase();
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Query params startDate and endDate required (YYYY-MM-DD)' });
    }
    const apiKey = (req.query.apiKey || process.env.SALESLOFT_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'Salesloft API key required. Set in .env as SALESLOFT_API_KEY.' });
    }
    const conversations = await fetchConversationsWithTranscripts(apiKey, startDate, endDate, { maxConversations: Infinity });

    if (format === 'json') {
      const exportData = conversations.map((c) => ({
        conversationId: c.id,
        id: c.id,
        date: c.date,
        title: c.title || null,
        rep: c.rep || null,
        account: c.account || null,
        deal_stage: c.deal_stage || null,
        word_count: c.word_count ?? 0,
        char_count: c.char_count ?? 0,
        transcript: c.transcript,
      }));
      res.setHeader('Content-Type', 'application/json');
      if (req.query.attachment !== '0') {
        const filename = `transcripts-${startDate}-to-${endDate}.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      return res.json(exportData);
    }

    // Plain text: one block per conversation, minimal tokens, ideal for pasting into an LLM
    const lines = [];
    conversations.forEach((c, i) => {
      lines.push(`=== Conversation ${i + 1} ===`);
      lines.push(`Date: ${c.date || '—'}`);
      lines.push(`Title: ${c.title || '—'}`);
      lines.push(`Rep: ${c.rep || '—'}`);
      lines.push(`Account: ${c.account || '—'}`);
      lines.push(`Deal stage: ${c.deal_stage || '—'}`);
      lines.push(`Words: ${c.word_count ?? 0} | Chars: ${c.char_count ?? 0}`);
      lines.push(`Conversation ID: ${c.id}`);
      lines.push('');
      lines.push(c.transcript && c.transcript !== '[No transcript]' ? c.transcript : '[No transcript]');
      lines.push('');
    });
    const body = lines.join('\n');
    const filename = `transcripts-${startDate}-to-${endDate}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    console.error('[server] /export-transcripts error:', err.message);
    res.status(err.message.includes('401') ? 401 : 502).json({ error: err.message });
  }
});

/** Load mock calls when SALESLOFT_API_KEY is not set */
function getMockCalls() {
  const path = join(__dirname, 'test-data', 'sample-transcripts.json');
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/** POST /run-analysis — clear table, fetch calls, extract, insert, return summary */
app.post('/run-analysis', async (req, res) => {
  try {
    const { startDate, endDate, salesloftApiKey, openaiApiKey } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required in body' });
    }

    const salesloftKey = (salesloftApiKey || process.env.SALESLOFT_API_KEY || '').trim();
    const openaiKey = (openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
    const useMockCalls = !salesloftKey;
    const useMockExtractor = !openaiKey;

    if (useMockCalls) {
      console.log('[server] Using mock calls (no Salesloft API key provided)');
    } else {
      console.log('[server] Using live Salesloft API');
    }
    if (useMockExtractor) {
      console.log('[server] Using mock extractor (no OpenAI API key provided)');
    } else {
      console.log('[server] Using live OpenAI extraction');
    }

    clearInsights();
    let calls = [];

    try {
      if (useMockCalls) {
        calls = getMockCalls();
      } else {
        calls = await fetchConversationsWithTranscripts(salesloftKey, startDate, endDate);
      }
    } catch (err) {
      console.error('[server] Fetch error:', err.message);
      return res.status(502).json({ error: 'Failed to fetch conversations', detail: err.message });
    }

    const totalCalls = calls.length;
    const errors = [];
    let processed = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (calls.length > 5 && i > 0 && i % 10 === 0) {
        console.log(`[server] Extraction progress: ${i}/${calls.length}`);
      }
      try {
        let insight;
        if (useMockExtractor) {
          insight = getMockInsight();
        } else {
          await delayBetweenCalls();
          insight = await extractPricingInsights(call.transcript, { apiKey: openaiKey });
        }
        insertInsight({
          salesloft_call_id: call.id,
          salesloft_app_call_id: call.app_call_id ?? null,
          date: call.date,
          rep: call.rep,
          account: call.account,
          deal_stage: call.deal_stage ?? null,
          ...insight,
        });
        processed += 1;
      } catch (err) {
        console.error(`[server] Extract failed for call ${call.id}:`, err.message);
        errors.push({ callId: call.id, error: err.message });
      }
    }

    console.log(`[server] Run complete: totalCalls=${totalCalls}, processed=${processed}, errors=${errors.length}`);
    const payload = { totalCalls, processed, errors };
    if (!useMockCalls && totalCalls === 0) {
      payload.hint = 'Salesloft returned 0 conversations. Check the date range and that your API key has access to Conversations. See server console for [salesloft] logs.';
    }
    res.json(payload);
  } catch (err) {
    console.error('[server] Internal error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

/** GET /insights — return all rows */
app.get('/insights', (req, res) => {
  try {
    const rows = getAllInsights();
    res.json(rows);
  } catch (err) {
    console.error('[server] GET /insights error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

/** DELETE /insights — clear table */
app.delete('/insights', (req, res) => {
  try {
    clearInsights();
    console.log('[server] Insights table cleared');
    res.status(204).send();
  } catch (err) {
    console.error('[server] DELETE /insights error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
