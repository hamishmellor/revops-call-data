/**
 * Extracts structured pricing insights from a transcript using OpenAI.
 * Uses exact schema and prompts from PRD. Truncates to 20k chars, 75ms delay, retry on parse failure.
 */

import OpenAI from 'openai';

const MAX_TRANSCRIPT_LENGTH = 20_000;
const DELAY_MS = 75;
const TEMPERATURE = 0.1;

const SYSTEM_PROMPT = `You are a senior B2B pricing strategy analyst. Your job is to extract structured pricing insights from sales call transcripts. You must return strictly valid JSON that adheres to the schema provided. Do not add any explanation, markdown, or commentary — only output the JSON.`;

const USER_PROMPT_TEMPLATE = `Analyze the following B2B sales call transcript. Extract only pricing-related intelligence. Return JSON exactly matching this schema:

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
- Only extract what is explicitly stated in the transcript.
- If not mentioned, return null.
- discount_requested_percent must be numeric if present.
- confidence_score must be between 0 and 1.
- If pricing not discussed, set pricing_discussed=false and conversation_type='None'.

Transcript:
\`\`\`
{{TRANSCRIPT}}
\`\`\`

Use temperature 0.1. Return only JSON.`;

/**
 * @param {string} transcript
 * @param {{ apiKey?: string }} [options] - Optional API key (else uses OPENAI_API_KEY from env)
 * @returns {Promise<{ pricing_discussed: boolean, conversation_type: string, discount_requested_percent: number|null, budget_mentioned: string|null, competitor_mentioned: string|null, objection_category: string, pricing_sentiment: string, key_quotes: string[], confidence_score: number }>}
 */
export async function extractPricingInsights(transcript, options = {}) {
  const apiKey = (options.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OpenAI API key required. Add it in the UI or set OPENAI_API_KEY in .env');
  }

  const truncated = transcript.length > MAX_TRANSCRIPT_LENGTH
    ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) + '\n[...truncated]'
    : transcript;
  const userPrompt = USER_PROMPT_TEMPLATE.replace('{{TRANSCRIPT}}', truncated);

  const openai = new OpenAI({ apiKey: apiKey });

  const run = async () => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: TEMPERATURE,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const choice = res.choices?.[0];
    const content = choice?.message?.content?.trim() || '';
    const usage = res.usage;
    if (usage) {
      const total = usage.total_tokens ?? (usage.prompt_tokens + usage.completion_tokens) ?? 0;
      console.log(`[extractor] Token usage (approx): ${total} for call`);
    }

    // Strip markdown code block if present
    let jsonStr = content;
    const codeMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) jsonStr = codeMatch[1].trim();
    const parsed = JSON.parse(jsonStr);
    return normalizeResult(parsed);
  };

  try {
    return await run();
  } catch (e) {
    if (e instanceof SyntaxError) {
      await delay(DELAY_MS);
      return await run();
    }
    throw e;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Enforce schema types and nulls */
function normalizeResult(obj) {
  return {
    pricing_discussed: Boolean(obj.pricing_discussed),
    conversation_type: obj.conversation_type ?? 'None',
    discount_requested_percent: typeof obj.discount_requested_percent === 'number' ? obj.discount_requested_percent : null,
    budget_mentioned: obj.budget_mentioned != null ? String(obj.budget_mentioned) : null,
    competitor_mentioned: obj.competitor_mentioned != null ? String(obj.competitor_mentioned) : null,
    objection_category: obj.objection_category ?? 'None',
    pricing_sentiment: obj.pricing_sentiment ?? 'Neutral',
    key_quotes: Array.isArray(obj.key_quotes) ? obj.key_quotes.map(String) : [],
    confidence_score: typeof obj.confidence_score === 'number' ? Math.max(0, Math.min(1, obj.confidence_score)) : 0.5,
  };
}

/** Call before each extract call to avoid rate spikes */
export function delayBetweenCalls() {
  return delay(DELAY_MS);
}
