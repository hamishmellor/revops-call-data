/**
 * Call-by-call analysis: ask one question per transcript, return a short answer per call.
 * Uses OpenAI chat with fetch (no SDK). Truncates transcript to 20k chars per call.
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_TRANSCRIPT_LENGTH = 20_000;
const DELAY_MS = 200;
const DEFAULT_MODEL = 'gpt-4o-mini';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build prompt for one call: question + transcript, request JSON { answer, quote? }.
 */
function buildPrompt(question, transcript) {
  const truncated =
    transcript.length > MAX_TRANSCRIPT_LENGTH
      ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) + '\n[...truncated]'
      : transcript;
  const system = `You answer a single question about a sales call transcript. Reply with only valid JSON, no markdown or explanation.
Schema: { "answer": "<short answer in 1-3 sentences>", "quote": "<optional short quote from transcript or null>" }
Be concise. Use "quote" only if the transcript clearly supports your answer (one short sentence).`;

  const user = `Question: ${question}\n\nTranscript:\n\`\`\`\n${truncated}\n\`\`\`\n\nReturn JSON with "answer" and optionally "quote".`;

  return { system, user };
}

/**
 * Parse LLM response into { answer, quote }.
 */
function parseResponse(content) {
  let jsonStr = (content || '').trim();
  const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1].trim();
  try {
    const parsed = JSON.parse(jsonStr);
    const answer = typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim().slice(0, 500) : '—';
    const quote = typeof parsed.quote === 'string' && parsed.quote.trim() ? parsed.quote.trim().slice(0, 300) : null;
    return { answer, quote };
  } catch (_) {
    return { answer: content.slice(0, 500) || '—', quote: null };
  }
}

/**
 * Analyze one transcript: call OpenAI, return { answer, quote }.
 */
async function analyzeOneCall(transcript, question, apiKey, model) {
  const { system, user } = buildPrompt(question, transcript);
  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: 256,
      temperature: 0.2,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? `HTTP ${res.status}`);
  const content = body.choices?.[0]?.message?.content ?? '';
  return parseResponse(content);
}

/**
 * Run call-by-call analysis.
 * @param {Array<{ id?: string, conversationId?: string, title?: string, date?: string, rep?: string, account?: string, transcript: string }>} transcripts
 * @param {string} question
 * @param {{ openaiApiKey?: string, model?: string }} [options]
 * @returns {Promise<{ results: Array<{ conversationId: string, title?: string, date?: string, rep?: string, account?: string, answer: string, quote?: string | null }>, summary: { total: number } }>}
 */
export async function analyzeCalls(transcripts, question, options = {}) {
  const apiKey = (options.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OpenAI API key required. Set OPENAI_API_KEY in .env or pass openaiApiKey.');
  const q = (question || '').trim();
  if (!q) throw new Error('Question is required.');
  const list = Array.isArray(transcripts) ? transcripts : [];
  const withTranscript = list.filter(
    (t) => (t.transcript || '').trim() && t.transcript !== '[No transcript]'
  );
  if (withTranscript.length === 0) {
    return { results: [], summary: { total: 0 } };
  }

  const model = (options.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const results = [];

  for (let i = 0; i < withTranscript.length; i++) {
    if (i > 0) await delay(DELAY_MS);
    const t = withTranscript[i];
    const id = t.conversationId ?? t.id ?? '';
    try {
      const { answer, quote } = await analyzeOneCall((t.transcript || '').trim(), q, apiKey, model);
      results.push({
        conversationId: id,
        title: t.title,
        date: t.date,
        rep: t.rep,
        account: t.account,
        answer,
        quote: quote || null,
      });
    } catch (err) {
      results.push({
        conversationId: id,
        title: t.title,
        date: t.date,
        rep: t.rep,
        account: t.account,
        answer: `Error: ${err.message}`,
        quote: null,
      });
      console.error(`[callAnalysis] Call ${id} failed:`, err.message);
    }
  }

  return {
    results,
    summary: { total: results.length },
  };
}
