/**
 * Salesloft Pricing Signal Extractor — Express server.
 * POST /run-analysis, GET /insights, DELETE /insights
 */

import 'dotenv/config';
import express from 'express';
import { getDbInstance, clearInsights, insertInsight, getAllInsights } from './db.js';
import { fetchCalls } from './salesloftService.js';
import { extractPricingInsights, delayBetweenCalls } from './pricingExtractor.js';
import { getMockInsight } from './mockExtractor.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

/** Load mock calls when SALESLOFT_API_KEY is not set */
function getMockCalls() {
  const path = join(__dirname, 'test-data', 'sample-transcripts.json');
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/** POST /run-analysis — clear table, fetch calls, extract, insert, return summary */
app.post('/run-analysis', async (req, res) => {
  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate required in body' });
  }

  const useMockCalls = !process.env.SALESLOFT_API_KEY?.trim();
  const useMockExtractor = !process.env.OPENAI_API_KEY?.trim();

  if (useMockCalls) {
    console.log('[server] Using mock calls (no SALESLOFT_API_KEY)');
  }
  if (useMockExtractor) {
    console.log('[server] Using mock extractor (no OPENAI_API_KEY)');
  }

  clearInsights();
  let calls = [];

  try {
    if (useMockCalls) {
      calls = getMockCalls();
    } else {
      calls = await fetchCalls(startDate, endDate);
    }
  } catch (err) {
    console.error('[server] Fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to fetch calls', detail: err.message });
  }

  const totalCalls = calls.length;
  const errors = [];
  let processed = 0;

  for (const call of calls) {
    try {
      let insight;
      if (useMockExtractor) {
        insight = getMockInsight();
      } else {
        await delayBetweenCalls();
        insight = await extractPricingInsights(call.transcript);
      }
      insertInsight({
        salesloft_call_id: call.id,
        date: call.date,
        rep: call.rep,
        account: call.account,
        ...insight,
      });
      processed += 1;
    } catch (err) {
      console.error(`[server] Extract failed for call ${call.id}:`, err.message);
      errors.push({ callId: call.id, error: err.message });
    }
  }

  console.log(`[server] Run complete: totalCalls=${totalCalls}, processed=${processed}, errors=${errors.length}`);
  res.json({ totalCalls, processed, errors });
});

/** GET /insights — return all rows */
app.get('/insights', (req, res) => {
  const rows = getAllInsights();
  res.json(rows);
});

/** DELETE /insights — clear table */
app.delete('/insights', (req, res) => {
  clearInsights();
  console.log('[server] Insights table cleared');
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
