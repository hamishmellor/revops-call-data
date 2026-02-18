/**
 * SQLite DB for pricing_insights. Uses :memory: by default; DB_PATH env for file.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || ':memory:';

function getDb() {
  if (DB_PATH !== ':memory:') {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesloft_call_id TEXT,
      salesloft_app_call_id TEXT,
      date TEXT,
      rep TEXT,
      account TEXT,
      deal_stage TEXT,
      pricing_discussed INTEGER,
      conversation_type TEXT,
      discount_requested_percent REAL,
      budget_mentioned TEXT,
      competitor_mentioned TEXT,
      objection_category TEXT,
      pricing_sentiment TEXT,
      key_quotes TEXT,
      confidence_score REAL
    );
  `);
  try {
    const cols = db.prepare(`PRAGMA table_info(pricing_insights)`).all();
    const hasAppCallId = cols.some((c) => c.name === 'salesloft_app_call_id');
    if (!hasAppCallId) {
      db.exec(`ALTER TABLE pricing_insights ADD COLUMN salesloft_app_call_id TEXT`);
    }
    const hasDealStage = cols.some((c) => c.name === 'deal_stage');
    if (!hasDealStage) {
      db.exec(`ALTER TABLE pricing_insights ADD COLUMN deal_stage TEXT`);
    }
  } catch (_) {}
  return db;
}

let dbInstance = null;

export function getDbInstance() {
  if (!dbInstance) dbInstance = getDb();
  return dbInstance;
}

/** Clear all rows from pricing_insights */
export function clearInsights() {
  const db = getDbInstance();
  db.prepare('DELETE FROM pricing_insights').run();
}

/** Insert one insight row */
export function insertInsight(row) {
  const db = getDbInstance();
  db.prepare(`
    INSERT INTO pricing_insights (
      salesloft_call_id, salesloft_app_call_id, date, rep, account, deal_stage,
      pricing_discussed, conversation_type, discount_requested_percent,
      budget_mentioned, competitor_mentioned, objection_category,
      pricing_sentiment, key_quotes, confidence_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.salesloft_call_id ?? null,
    row.salesloft_app_call_id ?? null,
    row.date ?? null,
    row.rep ?? null,
    row.account ?? null,
    row.deal_stage ?? null,
    row.pricing_discussed != null ? (row.pricing_discussed ? 1 : 0) : null,
    row.conversation_type ?? null,
    row.discount_requested_percent ?? null,
    row.budget_mentioned ?? null,
    row.competitor_mentioned ?? null,
    row.objection_category ?? null,
    row.pricing_sentiment ?? null,
    typeof row.key_quotes === 'string' ? row.key_quotes : (row.key_quotes ? JSON.stringify(row.key_quotes) : null),
    row.confidence_score ?? null
  );
}

/** Return all insights */
export function getAllInsights() {
  const db = getDbInstance();
  return db.prepare('SELECT * FROM pricing_insights ORDER BY id').all();
}
