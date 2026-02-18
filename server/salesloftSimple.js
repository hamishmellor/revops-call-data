/**
 * Minimal Salesloft integration: list recorded conversations in date range.
 * Uses /v2/conversations (recordings of conversations), not activity_histories (call attempts).
 * Returns id, date, title only. Proves we can access Salesloft recordings.
 */

const SALESLOFT_BASE = 'https://api.salesloft.com/v2';
const PER_PAGE = 100;

/**
 * Fetch recorded conversations from Salesloft in date range. Returns [{ id, date, title }].
 * Uses GET /v2/conversations so we get actual conversation recordings, not call attempts (no answer, wrong number).
 * @param {string} apiKey
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
export async function listCalls(apiKey, startDate, endDate) {
  const key = (apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  if (!key) throw new Error('Salesloft API key required');

  const gte = `${startDate}T00:00:00.000Z`;
  const lte = `${endDate}T23:59:59.999Z`;
  const all = [];
  let page = 1;
  let useDateFilter = true;

  while (true) {
    const url = new URL(`${SALESLOFT_BASE}/conversations`);
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));
    if (useDateFilter) {
      url.searchParams.set('updated_at[gte]', gte);
      url.searchParams.set('updated_at[lte]', lte);
    }

    console.log('[salesloft] GET', url.toString());

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) throw new Error('Invalid Salesloft API key (401). Check .env');
      if (res.status === 422 && useDateFilter) {
        useDateFilter = false;
        page = 1;
        continue;
      }
      throw new Error(`Salesloft API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const list = json.data ?? json.results ?? json.conversations ?? [];
    const items = Array.isArray(list) ? list : [];

    for (const c of items) {
      const dateStr = (c.updated_at ?? c.created_at ?? c.occurred_at ?? '').toString().slice(0, 10);
      if (!dateStr || dateStr < startDate || dateStr > endDate) continue;
      const title =
        c.title ??
        c.summary?.toString().slice(0, 80) ??
        (c.subject && c.subject.toString().slice(0, 80)) ??
        `Conversation ${c.id} on ${dateStr}`;
      all.push({
        id: String(c.id),
        date: dateStr,
        title: String(title).trim() || `Conversation on ${dateStr}`,
      });
    }

    if (items.length < PER_PAGE) break;
    page += 1;
    if (page > 20) break;
  }

  console.log('[salesloft] Listed', all.length, 'recorded conversations');
  return all;
}

/**
 * Fetch conversation by ID and resolve rep, account, and deal stage from API.
 * GET /v2/conversations/:id then resolve user (rep), account, person_stage (deal stage).
 * @returns {{ rep?: string, account?: string, deal_stage?: string }}
 */
export async function getConversationMetadata(apiKey, conversationId) {
  const key = (apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  if (!key) throw new Error('Salesloft API key required');

  try {
    const res = await fetch(`${SALESLOFT_BASE}/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return {};

    const json = await res.json();
    const c = json.data ?? json.conversation ?? json;

    const ownerId = c.owner_id ?? c.user_guid ?? c.created_by_id ?? c.user_id ?? null;
    let rep =
      c.created_by?.display_name ??
      c.user?.display_name ??
      c.creator?.display_name ??
      (ownerId != null ? await fetchUserDisplayName(key, ownerId) : null) ??
      (c.created_by_id != null ? await fetchUserDisplayName(key, c.created_by_id) : null) ??
      (c.user_id != null ? await fetchUserDisplayName(key, c.user_id) : null) ??
      null;

    let account =
      c.account?.name ??
      c.account?.display_name ??
      c.company?.name ??
      (c.account_id != null ? await fetchAccountName(key, c.account_id) : null) ??
      null;

    const personId = c.person_id ?? c.person?.id ?? null;
    const accountId = c.account_id ?? c.account?.id ?? null;
    let deal_stage = null;

    if (personId != null) {
      const personMeta = await fetchPersonAccountAndStage(key, personId);
      if (!account && personMeta.accountName) account = personMeta.accountName;
      if (!rep && personMeta.repName) rep = personMeta.repName;
      if (personMeta.dealStage) deal_stage = personMeta.dealStage;
    }

    if (!deal_stage && personId != null) {
      deal_stage = await fetchPersonDealStage(key, personId);
    }
    // Do not use account_stages here: that endpoint returns stage definitions (Open, Disqualified, etc.), not the account's current stage. Use opportunity stage in getConversationTranscript when conversation has an opportunity.

    return {
      rep: rep ?? undefined,
      account: account ?? undefined,
      deal_stage: deal_stage ?? undefined,
    };
  } catch (_) {
    return {};
  }
}

/** Extract rep display name from extensive conversation: owner_email + invitees[].full_name. */
function repFromInviteesAndOwner(data) {
  const ownerEmail = (data.owner_email ?? data.owner?.email ?? '').toString().trim().toLowerCase();
  if (!ownerEmail) return null;
  const invitees = data.invitees ?? data.attendees ?? [];
  const arr = Array.isArray(invitees) ? invitees : [];
  const match = arr.find((inv) => (inv.email ?? '').toString().trim().toLowerCase() === ownerEmail);
  return match && (match.full_name ?? match.display_name ?? match.name) ? String(match.full_name ?? match.display_name ?? match.name).trim() : null;
}

async function fetchUserDisplayName(apiKey, userId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const u = json.data ?? json.user ?? json;
    return u.display_name ?? u.name ?? (u.first_name && u.last_name ? `${u.first_name} ${u.last_name}`.trim() : null) ?? null;
  } catch (_) {
    return null;
  }
}

async function fetchAccountName(apiKey, accountId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const a = json.data ?? json.account ?? json;
    return a.name ?? a.display_name ?? null;
  } catch (_) {
    return null;
  }
}

/** Fetch person once and return account name, rep (owner) name, and deal stage from person object or nested stage. */
async function fetchPersonAccountAndStage(apiKey, personId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/people/${encodeURIComponent(personId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { accountName: null, repName: null, dealStage: null };
    const json = await res.json();
    const p = json.data ?? json.person ?? json;

    let accountName = null;
    const acc = p.account ?? p.primary_account ?? p.company;
    if (acc && typeof acc === 'object') accountName = acc.name ?? acc.display_name ?? null;
    if (!accountName && p.account_id != null) accountName = await fetchAccountName(apiKey, p.account_id);

    let repName = null;
    const owner = p.owner ?? p.assigned_to ?? p.user;
    if (owner && typeof owner === 'object') repName = owner.display_name ?? owner.name ?? null;
    if (!repName && p.owner_id != null) repName = await fetchUserDisplayName(apiKey, p.owner_id);

    let dealStage = null;
    const stageObj = p.current_stage ?? p.stage ?? p.person_stage ?? p.stage_name;
    if (stageObj != null) {
      if (typeof stageObj === 'string') dealStage = stageObj;
      else if (typeof stageObj === 'object') dealStage = stageObj.name ?? stageObj.display_name ?? stageObj.stage ?? null;
    }

    return { accountName, repName, dealStage };
  } catch (_) {
    return { accountName: null, repName: null, dealStage: null };
  }
}

async function fetchPersonAccountName(apiKey, personId) {
  const meta = await fetchPersonAccountAndStage(apiKey, personId);
  return meta.accountName;
}

async function fetchPersonRepName(apiKey, personId) {
  const meta = await fetchPersonAccountAndStage(apiKey, personId);
  return meta.repName;
}

async function fetchPersonDealStage(apiKey, personId) {
  try {
    const url = new URL(`${SALESLOFT_BASE}/person_stages`);
    url.searchParams.set('per_page', '25');
    url.searchParams.set('person_id', String(personId));
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json.data ?? json.results ?? json.person_stages ?? [];
    const arr = Array.isArray(list) ? list : [];
    const current = arr.find((s) => s.current === true) ?? arr[0];
    if (current) {
      const stage = current.stage ?? current.name ?? current.display_name;
      if (stage && typeof stage === 'object') return stage.name ?? stage.display_name ?? null;
      return stage ? String(stage) : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/** GET /v2/opportunities/:id and return stage_name (e.g. "SAO"). This is the deal stage for the conversation. */
async function fetchOpportunityStage(apiKey, opportunityId) {
  try {
    const res = await fetch(`${SALESLOFT_BASE}/opportunities/${encodeURIComponent(opportunityId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const o = json.data ?? json.opportunity ?? json;
    const name = o.stage_name ?? o.stage?.name ?? o.stage?.display_name ?? null;
    return name ? String(name).trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Get transcript and optional rep/account/deal_stage for a single conversation.
 * Fetches metadata (rep, account, deal_stage) from conversation API, then transcript from extensive/transcriptions.
 * @returns {{ transcript: string | null, rep?: string, account?: string, deal_stage?: string }}
 */
export async function getConversationTranscript(apiKey, conversationId) {
  const key = (apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  if (!key) throw new Error('Salesloft API key required');

  const metadata = await getConversationMetadata(apiKey, conversationId);
  let rep = metadata.rep ?? null;
  let account = metadata.account ?? null;
  let deal_stage = metadata.deal_stage ?? null;

  try {
    const extRes = await fetch(`${SALESLOFT_BASE}/conversations/${encodeURIComponent(conversationId)}/extensive`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (extRes.ok) {
      const ext = await extRes.json();
      const data = ext.data ?? ext.conversation ?? ext;
      const repFromExtensive = repFromInviteesAndOwner(data);
      if (repFromExtensive) rep = repFromExtensive;
      if (!account && data.account?.id) account = await fetchAccountName(key, data.account.id);
      if (!account) account = data.account?.name ?? data.company_name ?? data.account_name ?? null;
      const opportunityId = data.opportunity?.id ?? data.opportunity_id ?? null;
      if (opportunityId != null) {
        const oppStage = await fetchOpportunityStage(key, opportunityId);
        if (oppStage) deal_stage = oppStage;
      }
      const transcript =
        data.transcript ?? data.transcript_text ?? data.text ?? data.content ?? null;
      if (transcript && String(transcript).trim()) {
        if (!rep) rep = data.user?.display_name ?? data.rep ?? data.user_name ?? null;
        return { transcript: String(transcript).trim(), rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
      const summary = data.summary ?? data.summary_text ?? null;
      if (summary && typeof summary === 'object' && summary.text && String(summary.text).trim().length > 100) {
        return { transcript: `[Summary only]\n${String(summary.text).trim()}`, rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
      if (summary && typeof summary === 'string' && summary.trim().length > 100) {
        return { transcript: `[Summary only]\n${String(summary).trim()}`, rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
      const transId = data.transcription?.id ?? data.transcription_id ?? (data.transcription && typeof data.transcription === 'object' && data.transcription.id) ?? null;
      if (transId) {
        const fromTrans = await fetchTranscriptById(key, transId);
        if (fromTrans) return { transcript: fromTrans, rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
    }
  } catch (_) {}

  try {
    const listUrl = new URL(`${SALESLOFT_BASE}/transcriptions`);
    listUrl.searchParams.set('per_page', '100');
    listUrl.searchParams.set('conversation_id', String(conversationId));
    const listRes = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (listRes.ok) {
      const listJson = await listRes.json();
      const list = listJson.data ?? listJson.results ?? listJson.transcriptions ?? [];
      const arr = Array.isArray(list) ? list : [];
      const trans = arr.find((t) => String(t.conversation_id ?? t.conversation?.id ?? '') === String(conversationId)) ?? arr[0];
      if (trans && (trans.id ?? trans.transcription_id)) {
        const tid = String(trans.id ?? trans.transcription_id);
        const text = await fetchTranscriptById(key, tid);
        if (text) return { transcript: text, rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
    }
  } catch (_) {}

  try {
    const listUrl = new URL(`${SALESLOFT_BASE}/transcriptions`);
    listUrl.searchParams.set('per_page', '100');
    const listRes = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (listRes.ok) {
      const listJson = await listRes.json();
      const list = listJson.data ?? listJson.results ?? listJson.transcriptions ?? [];
      const arr = Array.isArray(list) ? list : [];
      const trans = arr.find((t) => String(t.conversation_id ?? t.conversation?.id ?? '') === String(conversationId));
      if (trans && (trans.id ?? trans.transcription_id)) {
        const tid = String(trans.id ?? trans.transcription_id);
        const text = await fetchTranscriptById(key, tid);
        if (text) return { transcript: text, rep: rep ?? undefined, account: account ?? undefined, deal_stage: deal_stage ?? undefined };
      }
    }
  } catch (_) {}

  return { transcript: null, rep: undefined, account: undefined, deal_stage: deal_stage ?? undefined };
}

async function fetchTranscriptById(apiKey, transcriptionId) {
  const key = (apiKey || process.env.SALESLOFT_API_KEY || '').trim();
  try {
    const res = await fetch(`${SALESLOFT_BASE}/transcriptions/${encodeURIComponent(transcriptionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const json = await res.json();
      const data = json.data ?? json.transcription ?? json;
      const text = data.transcript ?? data.text ?? data.content ?? data.body ?? null;
      if (text && String(text).trim()) return String(text).trim();
    }
    const sentRes = await fetch(`${SALESLOFT_BASE}/transcriptions/${encodeURIComponent(transcriptionId)}/sentences`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (sentRes.ok) {
      const sentJson = await sentRes.json();
      const list = sentJson.data ?? sentJson.results ?? sentJson.sentences ?? [];
      const arr = Array.isArray(list) ? list : [];
      const parts = arr.map((s) => s.text ?? s.content ?? s.value ?? '').filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
  } catch (_) {}
  return null;
}

/**
 * Fetch recorded conversations with transcripts for run-analysis.
 * Returns same shape as old fetchCalls: [{ id, date, rep, account, transcript }].
 * Uses listCalls then getConversationTranscript for each.
 */
export async function fetchConversationsWithTranscripts(apiKey, startDate, endDate, options = {}) {
  const max = options.maxConversations ?? 50;
  const list = await listCalls(apiKey, startDate, endDate);
  const capped = list.slice(0, max);
  if (list.length > max) {
    console.log(`[salesloft] Capping to ${max} conversations (found ${list.length})`);
  }
  const results = [];
  for (let i = 0; i < capped.length; i++) {
    const c = capped[i];
    if (capped.length > 5 && i > 0 && i % 10 === 0) {
      console.log(`[salesloft] Transcript progress: ${i}/${capped.length}`);
    }
    const { transcript, rep, account, deal_stage } = await getConversationTranscript(apiKey, c.id);
    const text = (transcript && transcript.trim()) ? transcript.trim() : '[No transcript]';
    results.push({
      id: c.id,
      app_call_id: null,
      date: c.date,
      rep: (rep || '').trim(),
      account: (account || '').trim(),
      deal_stage: (deal_stage || '').trim() || null,
      transcript: text,
    });
  }
  const withTranscript = results.filter((r) => r.transcript !== '[No transcript]').length;
  console.log(`[salesloft] Returning ${results.length} conversations (${withTranscript} with transcript)`);
  return results;
}
