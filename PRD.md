Project: Salesloft Pricing Signal Extractor
Mode: Local, single-user, ephemeral
Goal: Automatically convert call transcripts into structured pricing intelligence and display them.

What It Does

Fetches call transcripts from Salesloft (date range)

Sends each transcript to OpenAI

Receives structured pricing insights

Stores them in an in-memory DB

Displays a simple table of results

If you close the app → data disappears. That’s fine.

System Architecture (Ultra Minimal)

Frontend:

React (Vite)

Single page

Backend:

Node + Express

DB:

SQLite in-memory (:memory:)

Services:

salesloftService.js

pricingExtractor.js

Flow:

Click "Run Analysis"
→ Fetch calls
→ For each transcript:
→ Call OpenAI
→ Store result in DB
→ Refresh table

That’s it.

Data Model (Single Table Only)

Table: pricing_insights

Columns:

id (PK)

salesloft_call_id

date

rep

account

pricing_discussed (boolean)

conversation_type (text)

discount_requested_percent (real)

budget_mentioned (text)

competitor_mentioned (text)

objection_category (text)

pricing_sentiment (text)

key_quotes (text JSON)

confidence_score (real)

No raw transcript stored.
No caching.
No deduping logic.
No secondary tables.

OpenAI Extraction (Core Engine)

This is the critical piece.

System Prompt

You are a senior B2B pricing strategy analyst.

Your job is to extract structured pricing insights from sales call transcripts.

Return strictly valid JSON.
No commentary.
No markdown.
No explanations.

If pricing is not discussed, return:

pricing_discussed = false

conversation_type = "None"

Only extract what is explicitly stated.

User Prompt Template

Analyze the following B2B sales call transcript.

Extract pricing-related intelligence.

Return JSON matching this schema exactly:

{
"pricing_discussed": boolean,
"conversation_type": "Initial Quote | Negotiation | Objection | Renewal | Expansion | None",
"discount_requested_percent": number | null,
"budget_mentioned": string | null,
"competitor_mentioned": string | null,
"objection_category": "Too Expensive | Budget Freeze | Needs Approval | Comparing Vendors | Value Misalignment | None",
"pricing_sentiment": "Positive | Neutral | Negative",
"key_quotes": [string],
"confidence_score": number
}

Rules:

discount_requested_percent must be numeric if present

confidence_score must be between 0 and 1

If not mentioned, return null

Do not infer aggressively

Transcript:
"""
{{TRANSCRIPT}}
"""

Model settings:

Temperature: 0.1

Use structured JSON mode if available

Backend Endpoints

Only 3 endpoints needed:

POST /run-analysis

Body:
{
startDate,
endDate
}

Flow:

Fetch calls from Salesloft

Loop through transcripts

Call OpenAI

Insert rows into pricing_insights

Return summary count

GET /insights

Returns all rows

DELETE /insights

Clears table (optional but useful for reruns)

Frontend (Single Page)

Elements:

Date range selector

"Run Analysis" button

Status indicator (Running / Complete / Error)

Table with columns:

Date

Rep

Account

Pricing Discussed

Conversation Type

Discount %

Objection Category

Competitor

Sentiment

Confidence

No drilldown.
No modal.
No editing.