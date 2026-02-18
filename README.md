# revops-call-data

**Salesloft Pricing Signal Extractor** — Local, single-user, ephemeral app that fetches Salesloft call transcripts, extracts structured pricing insights via OpenAI, and displays them in a simple table.

## Flow

**Salesloft → OpenAI → SQLite (in-memory) → Browser table**

- No manual editing or export.
- No persistence beyond the in-memory DB unless `DB_PATH` is set.

## Prerequisites

- **Node.js 18+** (includes npm)

### If npm doesn’t work

Node and npm must be installed and on your PATH.

**Option A – Install Node from nodejs.org**

1. Go to [https://nodejs.org](https://nodejs.org) and download the LTS installer for macOS.
2. Run the installer, then **open a new terminal**.
3. Check: `node -v` and `npm -v` should print versions.

**Option B – Homebrew (macOS)**

```bash
brew install node
```

Then open a new terminal and run `node -v` and `npm -v`.

**Option C – nvm (Node Version Manager)**

```bash
# Install nvm (see https://github.com/nvm-sh/nvm#installing-and-updating)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# Restart terminal, then:
nvm install 20
nvm use 20
node -v
npm -v
```

**If npm is installed but “command not found”**

- Use a new terminal after installing Node.
- If you use nvm/fnm, run `nvm use 20` (or your version) in this terminal, or add their init to your `~/.zshrc`.

## Setup

1. **Install dependencies (root + server + client):**

   ```bash
   npm run install:all
   ```

   Or manually:

   ```bash
   npm install
   cd server && npm install
   cd ../client && npm install
   ```

2. **Environment variables (recommended – no need to paste keys in the UI)**

   Copy `.env.example` to `.env` in the **project root** and add your keys:

   ```
   SALESLOFT_API_KEY=your_actual_key_here
   OPENAI_API_KEY=your_actual_key_here
   ```

   The server loads `.env` from the project root, so you only set them once. You can leave the key fields empty in the app when using .env.

   - `SALESLOFT_API_KEY` – for live Salesloft fetch; omit to use mock mode.
   - `OPENAI_API_KEY` – for real extraction; omit in mock mode for hardcoded results.
   - `DB_PATH` – optional; e.g. `./data/pricing.db` for file-based SQLite.

## Run locally

From the project root:

```bash
npm run dev
```

This starts:

- **Server** at `http://localhost:3001`
- **Client** at `http://localhost:5173` (Vite)

Then open `http://localhost:5173`, pick a date range, click **Run Analysis**, and view the insights table.

## API endpoints

| Method | Path            | Description |
|--------|-----------------|-------------|
| POST   | `/run-analysis` | Body: `{ startDate, endDate }`. Clears table, fetches calls, runs OpenAI extraction, inserts insights. Returns `{ totalCalls, processed, errors }`. |
| GET    | `/insights`     | Returns all rows from `pricing_insights`. |
| DELETE | `/insights`     | Clears the `pricing_insights` table. |

## Mock / fallback mode

If `SALESLOFT_API_KEY` is **not** set:

- The server does **not** call the Salesloft API.
- It uses 2–3 sample transcripts from `server/test-data/sample-transcripts.json`.
- If `OPENAI_API_KEY` is also unset, extraction uses **hardcoded mock results** so no external APIs are called (handy for demos and CI).

To run the pipeline end-to-end with mocks:

1. Start the server in one terminal: `npm run dev:server` (or `npm run dev` for server + client).
2. In another terminal, from the project root: `npm run test:integration`.

This runs `server/scripts/run-mock-analysis.js`, which calls `POST /run-analysis` with a date range and prints the summary. With no API keys set, the server uses mock transcripts and mock extraction (no external API calls).

## Project structure

```
/server     – Node.js + Express, Salesloft + OpenAI services, DB access
/client     – React + Vite single page
/db         – SQLite init and migrations (table: pricing_insights)
```

## Table columns (stored and displayed)

Date, Rep, Account, Pricing Discussed, Conversation Type, Discount %, Objection Category, Competitor, Sentiment, Confidence. No transcript storage; only extracted fields.

## Troubleshooting

**Run takes a long time** — The app caps at 50 calls per run (and 5 pages when listing) so a run finishes in a few minutes. To process more, edit `server/salesloftService.js`: increase `MAX_CALLS` and/or `MAX_PAGES`.

**401 Invalid Bearer token** — Salesloft is rejecting your API key. In `.env`: use the **full** key from Salesloft (Settings → API), with no extra spaces, newlines, or quotes. Create a new key in Salesloft if needed.

**No data when using Salesloft API key** — The app fetches from Salesloft’s Activity History (`GET /v2/activities/calls`) and only includes calls that have a transcript. Check:

1. **Date range** — Use a range where calls actually exist (e.g. last 30 days).
2. **Server logs** — In the terminal where the server runs, look for `[salesloft]` lines: “List returned N call(s)” vs “No calls in date range”. If you see “N calls, 0 with transcript”, Salesloft is returning calls but transcripts aren’t available (e.g. transcriptions may be on a different endpoint or plan).
3. **API key scope** — The key must have access to read Activities/Calls (and optionally Transcriptions). In Salesloft: Settings → API to confirm scopes.

**`Error: listen EADDRINUSE: address already in use :::3001`** — Something is already using port 3001 (e.g. a previous server run). Free it with:

```bash
lsof -ti :3001 | xargs kill -9
```

Then run `npm run dev` again.
