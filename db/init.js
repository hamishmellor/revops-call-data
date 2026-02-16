/**
 * SQLite DB init and migration for pricing_insights table.
 * Uses :memory: by default; set DB_PATH env var for a file-based DB.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || ':memory:';
const isMemory = DB_PATH === ':memory:';

/**
 * Opens the DB (memory or file) and runs migrations.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  const db = new Database(DB_PATH);
  if (!isMemory) {
    const dir = path.dirname(DB_PATH);
    try {
      require('fs').mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }
  runMigrations(db);
  return db;
}

/**
 * Create pricing_insights table if it doesn't exist.
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesloft_call_id TEXT,
      date TEXT,
      rep TEXT,
      account TEXT,
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
}

module.exports = { getDb, runMigrations };
