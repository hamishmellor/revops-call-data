/**
 * Fetches call transcripts from Salesloft API by date range.
 * When SALESLOFT_API_KEY is missing, returns empty array (caller should use mock data).
 */

const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const PER_PAGE = 100;

/**
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {{ apiKey?: string }} [options] - Optional API key (else uses SALESLOFT_API_KEY from env)
 * @returns {Promise<Array<{ id: string, date: string, rep: string, account: string, transcript: string }>>}
 */
export async function fetchCalls(startDate, endDate, options = {}) {
  const apiKey = (options.apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Salesloft API key required. Add it in the UI or set SALESLOFT_API_KEY in .env');
  }

  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    // Salesloft activities/calls list; adjust path if your API version differs
    const url = new URL(`${SALESLOFT_BASE}/activities/calls`);
    url.searchParams.set('per_page', PER_PAGE);
    url.searchParams.set('page', page);
    url.searchParams.set('updated_at_start', startDate);
    url.searchParams.set('updated_at_end', endDate);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Salesloft API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const items = json.data ?? json.results ?? [];
    if (!Array.isArray(items)) throw new Error('Salesloft API did not return an array of calls');

    for (const call of items) {
      const transcript = await getTranscriptForCall(call.id, apiKey);
      if (!transcript || !transcript.trim()) continue;

      const date = call.created_at ?? call.updated_at ?? call.date ?? '';
      const rep = call.user?.display_name ?? call.person?.display_name ?? call.rep ?? '';
      const account = call.account?.name ?? call.company?.name ?? call.account_name ?? '';

      results.push({
        id: String(call.id),
        date: date.slice(0, 10),
        rep,
        account,
        transcript: transcript.trim(),
      });
    }

    hasMore = items.length === PER_PAGE;
    page += 1;
  }

  return results;
}

/**
 * Fetches transcript for a single call. Adjust endpoint to match Salesloft docs.
 */
async function getTranscriptForCall(callId, apiKey) {
  try {
    const url = `${SALESLOFT_BASE}/activities/calls/${callId}/transcript`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.transcript ?? data.text ?? data.content ?? null;
  } catch {
    return null;
  }
}
