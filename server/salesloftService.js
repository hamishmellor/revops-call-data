/**
 * Fetches call transcripts from Salesloft API by date range.
 *
 * Tries multiple endpoints (many orgs only have access to one):
 * 1. GET /v2/activity_histories with type=call — "past activities" / Activity Feed (often works)
 * 2. GET /v2/activities/calls — dedicated list calls
 * 3. GET /v2/call_data_records — Dialer call records (last year only)
 *
 * Transcript: from call detail, transcriptions API, or call note_content as fallback.
 */

const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const PER_PAGE = 100;
const MAX_PAGES = 5;
const MAX_CALLS = 50;
let loggedCallDetailShape = false;

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

  const occurredAtGte = `${startDate}T00:00:00.000Z`;
  const occurredAtLte = `${endDate}T23:59:59.999Z`;

  let items = [];

  // 1) Activity Histories — "all past activities" / Activity Feed (type=call)
  items = await fetchActivityHistories(apiKey, startDate, endDate, occurredAtGte, occurredAtLte);
  if (items.length > 0) {
    console.log(`[salesloft] Got ${items.length} call(s) from /v2/activity_histories (type=call)`);
  }

  // 2) Dedicated activities/calls list
  if (items.length === 0) {
    items = await fetchActivitiesCalls(apiKey, occurredAtGte, occurredAtLte);
    if (items.length > 0) {
      console.log(`[salesloft] Got ${items.length} call(s) from /v2/activities/calls`);
    }
  }

  // 3) Call Data Records (Dialer; last year only)
  if (items.length === 0) {
    items = await fetchCallDataRecords(apiKey, startDate, endDate);
    if (items.length > 0) {
      console.log(`[salesloft] Got ${items.length} call(s) from /v2/call_data_records`);
    }
  }

  if (items.length === 0) {
    console.log('[salesloft] All endpoints returned 0 calls. Check API key scopes (Activity Histories, Activities, or Call Data Records) and date range.');
  }

  // Strict date filter: API may ignore or widen date range
  const dateFiltered = items.filter((a) => {
    const d = (a.occurred_at ?? a.created_at ?? a.updated_at ?? a.start_time ?? '').toString().slice(0, 10);
    return d >= startDate && d <= endDate;
  });
  if (dateFiltered.length < items.length) {
    console.log(`[salesloft] Date filter: ${items.length} -> ${dateFiltered.length} (${startDate} to ${endDate})`);
  }
  items = dateFiltered;

  const capped = items.slice(0, MAX_CALLS);
  if (items.length > MAX_CALLS) {
    console.log(`[salesloft] Capping to first ${MAX_CALLS} calls (found ${items.length}). Set MAX_CALLS in salesloftService.js to process more.`);
  }

  // Debug: log what the first activity actually contains (once)
  if (capped.length > 0) {
    const first = capped[0];
    const topKeys = Object.keys(first);
    const dynKeys = first.dynamic_data ? Object.keys(first.dynamic_data) : [];
    console.log(`[salesloft] First activity keys: ${topKeys.join(', ')}; dynamic_data: ${dynKeys.length ? dynKeys.join(', ') : 'none'}`);
  }

  const results = [];
  for (let i = 0; i < capped.length; i++) {
    const call = capped[i];
    if (i > 0 && i % 10 === 0) console.log(`[salesloft] Processing: ${i}/${capped.length}...`);
    const { transcript: rawTranscript, rep: detailRep, account: detailAccount } = await getTranscriptAndMetadata(call, apiKey);
    const transcript = (rawTranscript && rawTranscript.trim()) ? rawTranscript.trim() : '[No transcript]';

    const date = call.occurred_at ?? call.created_at ?? call.updated_at ?? call.start_time ?? '';
    let rep = detailRep ?? getRepFromActivity(call);
    let account = detailAccount ?? getAccountFromActivity(call);
    if (call.resource_id != null && String(call.resource_type || '').toLowerCase() === 'person') {
      const personMeta = await fetchPersonMetadata(apiKey, call.resource_id);
      if (personMeta) {
        if (!rep) rep = personMeta.display_name ?? '';
        if (!account) account = personMeta.account_name ?? '';
      }
    }
    const appCallId = call.static_data?.call_id != null ? String(call.static_data.call_id) : null;

    results.push({
      id: String(call.id),
      app_call_id: appCallId,
      date: typeof date === 'string' ? date.slice(0, 10) : '',
      rep: (rep || '').trim(),
      account: (account || '').trim(),
      transcript,
    });
  }

  const withTranscript = results.filter((r) => r.transcript !== '[No transcript]').length;
  console.log(`[salesloft] Returning ${results.length} calls (${withTranscript} with transcript) from ${items.length} total`);
  return results;
}

/** Try every possible path for rep name from an activity object. */
function getRepFromActivity(call) {
  const d = call.dynamic_data || {};
  return (
    d.user_name ??
    d.User_Name ??
    d.userName ??
    call.user?.display_name ??
    call.person?.display_name ??
    call.user_name ??
    call.created_by?.display_name ??
    call.owner?.display_name ??
    (call.user_guid && `User ${call.user_guid}`) ??
    ''
  );
}

/** Try every possible path for account/company name from an activity object. */
function getAccountFromActivity(call) {
  const d = call.dynamic_data || {};
  return (
    d.account_name ??
    d.company_name ??
    d.Account_Name ??
    call.account?.name ??
    call.company?.name ??
    call.account?.display_name ??
    call.company?.display_name ??
    ''
  );
}

/**
 * GET /v2/activity_histories — past activities, filter type=call and date range.
 */
async function fetchActivityHistories(apiKey, startDate, endDate, occurredAtGte, occurredAtLte) {
  const all = [];
  const paramSets = [
    { type: 'type', typeVal: 'call', gte: 'occurred_at[gte]', lte: 'occurred_at[lte]', gteVal: occurredAtGte, lteVal: occurredAtLte },
    { type: 'type', typeVal: 'call', gte: 'occurred_at_gte', lte: 'occurred_at_lte', gteVal: occurredAtGte, lteVal: occurredAtLte },
    { type: 'type', typeVal: 'call', gte: 'updated_at_start', lte: 'updated_at_end', gteVal: startDate, lteVal: endDate },
  ];

  for (const params of paramSets) {
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= MAX_PAGES) {
      const url = new URL(`${SALESLOFT_BASE}/activity_histories`);
      url.searchParams.set('per_page', String(PER_PAGE));
      url.searchParams.set('page', String(page));
      url.searchParams.set(params.type, params.typeVal);
      url.searchParams.set(params.gte, params.gteVal);
      url.searchParams.set(params.lte, params.lteVal);
      console.log(`[salesloft] GET ${url.toString()}`);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('[salesloft] activity_histories:', res.status, errText.slice(0, 300));
        if (res.status === 401) {
          throw new Error('Invalid Salesloft API key (401). Check .env: use the full key from Salesloft (Settings → API), no extra spaces or newlines.');
        }
        break;
      }
      const json = await res.json();
      const list = json.data ?? json.results ?? json.activity_histories ?? [];
      const items = Array.isArray(list) ? list : [];
      const onlyCalls = items.filter((a) => (a.type || '').toLowerCase() === 'call');
      all.push(...onlyCalls);
      if (items.length > 0) console.log(`[salesloft] activity_histories page ${page}: ${items.length} activities, ${onlyCalls.length} calls`);
      if (all.length >= MAX_CALLS) break;
      hasMore = items.length === PER_PAGE;
      page += 1;
      if (items.length === 0) break;
    }
    if (all.length > 0) return all;
  }
  return all;
}

/**
 * GET /v2/activities/calls with date params.
 */
async function fetchActivitiesCalls(apiKey, occurredAtGte, occurredAtLte) {
  const paramSets = [
    { gteKey: 'occurred_at[gte]', lteKey: 'occurred_at[lte]', gteVal: occurredAtGte, lteVal: occurredAtLte },
    { gteKey: 'updated_at_start', lteKey: 'updated_at_end', gteVal: occurredAtGte.slice(0, 10), lteVal: occurredAtLte.slice(0, 10) },
  ];
  for (const params of paramSets) {
    const url = new URL(`${SALESLOFT_BASE}/activities/calls`);
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', '1');
    url.searchParams.set(params.gteKey, params.gteVal);
    url.searchParams.set(params.lteKey, params.lteVal);
    console.log(`[salesloft] GET ${url.toString()}`);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401) throw new Error('Invalid Salesloft API key (401). Check .env: use the full key from Salesloft (Settings → API), no extra spaces or newlines.');
      if (res.status === 422) continue;
      console.error('[salesloft] activities/calls:', res.status, errText.slice(0, 300));
      return [];
    }
    const json = await res.json();
    const items = json.data ?? json.results ?? [];
    if (Array.isArray(items) && items.length > 0) return items;
  }
  return [];
}

/**
 * GET /v2/call_data_records — Dialer calls (last year). Try date params.
 */
async function fetchCallDataRecords(apiKey, startDate, endDate) {
  const url = new URL(`${SALESLOFT_BASE}/call_data_records`);
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', '1');
  url.searchParams.set('created_at_start', startDate);
  url.searchParams.set('created_at_end', endDate);
  console.log(`[salesloft] GET ${url.toString()}`);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 401) throw new Error('Invalid Salesloft API key (401). Check .env: use the full key from Salesloft (Settings → API), no extra spaces or newlines.');
    console.error('[salesloft] call_data_records:', res.status, errText.slice(0, 300));
    return [];
  }
  const json = await res.json();
  const items = json.data ?? json.results ?? [];
  return Array.isArray(items) ? items : [];
}

/** Fetch person by resource_id for display_name and account name. */
async function fetchPersonMetadata(apiKey, personId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/people/${personId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 403) console.warn('[salesloft] People API 403 – add people:read scope to your API key for Rep/Account metadata.');
      return null;
    }
    const json = await res.json();
    const p = json.data ?? json;
    let accountName = '';
    const account = p.account ?? p.company ?? p.primary_account;
    if (account && typeof account === 'object') {
      accountName = account.name ?? account.display_name ?? account.account_name ?? '';
    } else if (p.account_id != null) {
      accountName = await fetchAccountName(apiKey, p.account_id);
    }
    const displayName =
      p.display_name ??
      p.full_name ??
      ([p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || '');
    return { display_name: displayName, account_name: accountName };
  } catch {
    return null;
  }
}

/** Fetch account name by account id. */
async function fetchAccountName(apiKey, accountId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/accounts/${accountId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 403) console.warn('[salesloft] Accounts API 403 – add accounts:read scope for Account metadata.');
      return '';
    }
    const json = await res.json();
    const a = json.data ?? json;
    return a.name ?? a.display_name ?? a.account_name ?? '';
  } catch {
    return '';
  }
}

/**
 * Get transcript and optional rep/account from call detail. Returns { transcript, rep, account }.
 */
async function getTranscriptAndMetadata(call, apiKey) {
  const callId = call.id;
  let rep = null;
  let account = null;

  const noteContent = call.static_data?.note_content ?? call.note_content ?? call.notes ?? '';
  if (noteContent && String(noteContent).trim().length > 50) {
    return { transcript: String(noteContent).trim(), rep, account };
  }

  try {
    const callRes = await fetch(`${SALESLOFT_BASE}/activities/calls/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (callRes.ok) {
      const callData = await callRes.json();
      if (!loggedCallDetailShape) {
        loggedCallDetailShape = true;
        const top = Object.keys(callData);
        const data = callData.data ?? callData.record ?? callData.activity ?? callData;
        const dataKeys = data && typeof data === 'object' ? Object.keys(data) : [];
        const dynKeys = data?.dynamic_data && typeof data.dynamic_data === 'object' ? Object.keys(data.dynamic_data) : [];
        console.log('[salesloft] Call detail response keys:', top.join(', '), '| data:', dataKeys.join(', '), '| dynamic_data:', dynKeys.join(', '));
      }
      const data = callData.data ?? callData.record ?? callData.activity ?? callData;
      const dyn = data?.dynamic_data || {};
      rep = dyn.user_name ?? dyn.User_Name ?? data?.user?.display_name ?? data?.person?.display_name ?? data?.user_name ?? null;
      account = dyn.account_name ?? dyn.company_name ?? data?.account?.name ?? data?.company?.name ?? data?.account?.display_name ?? null;
      const transcript = data?.transcript ?? data?.static_data?.transcript ?? data?.transcript_text ?? data?.text ?? data?.content ?? null;
      if (transcript && String(transcript).trim()) return { transcript: String(transcript).trim(), rep, account };
      const note = data?.static_data?.note_content ?? data?.note_content ?? '';
      if (note && String(note).trim().length > 50) return { transcript: String(note).trim(), rep, account };
    }
  } catch {
    // ignore
  }

  try {
    const transUrl = new URL(`${SALESLOFT_BASE}/transcriptions`);
    transUrl.searchParams.set('per_page', '25');
    transUrl.searchParams.set('page', '1');
    const transRes = await fetch(transUrl.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
    if (transRes.ok) {
      const transJson = await transRes.json();
      const list = transJson.data ?? transJson.results ?? [];
      const match = list.find((t) => t.call_id === callId || t.activity_id === callId || t.conversation_id === call?.static_data?.conversation_id);
      if (match && (match.transcript ?? match.text ?? match.content)) {
        return { transcript: match.transcript ?? match.text ?? match.content, rep, account };
      }
    }
  } catch {
    // ignore
  }

  return { transcript: null, rep, account };
}
