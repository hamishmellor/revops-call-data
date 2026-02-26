/**
 * RAG (Retrieval-Augmented Generation) for Salesloft transcripts.
 * Uses fetch() only for OpenAI (no SDK) to avoid SDK heap OOM on load.
 */

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
/** Number of chunks to retrieve in the first stage (vector similarity). */
const FIRST_STAGE_K = 60;
/** Number of chunks to keep after reranking (passed to the LLM). */
const RERANK_TOP_N = 15;
const MAX_CONTEXT_CHARS = 12000;

/** Structured metadata keys we store per chunk (Salesloft fields). All stored as strings except word_count/char_count. */
const META_KEYS = [
  'conversationId',
  'title',
  'date',
  'rep',
  'account',
  'deal_stage',
  'word_count',
  'char_count',
];

/**
 * Normalize transcript object into a strict meta object (only META_KEYS, safe types).
 * @param {object} t - Transcript item from client
 * @returns {object} Meta object for chunking
 */
function buildChunkMeta(t) {
  const meta = {};
  const id = t.id ?? t.conversationId ?? '';
  meta.conversationId = String(id).trim();
  meta.title = t.title != null ? String(t.title).trim() : '';
  meta.date = t.date != null ? String(t.date).trim() : '';
  meta.rep = t.rep != null ? String(t.rep).trim() : '';
  meta.account = t.account != null ? String(t.account).trim() : '';
  meta.deal_stage = t.deal_stage != null ? String(t.deal_stage).trim() : '';
  meta.word_count = typeof t.word_count === 'number' && Number.isFinite(t.word_count) ? t.word_count : (t.word_count != null ? Number(t.word_count) : 0);
  meta.char_count = typeof t.char_count === 'number' && Number.isFinite(t.char_count) ? t.char_count : (t.char_count != null ? Number(t.char_count) : 0);
  return meta;
}

let store = {
  chunks: [],
  builtAt: null,
};

function chunkText(text, meta = {}) {
  const chunks = [];
  let start = 0;
  const str = String(text || '').trim();
  if (!str) return chunks;
  while (start < str.length) {
    const end = Math.min(start + CHUNK_SIZE, str.length);
    let slice = str.slice(start, end);
    if (end < str.length) {
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > CHUNK_SIZE / 2) {
        slice = slice.slice(0, lastSpace + 1);
        start += lastSpace + 1;
      } else {
        start = end;
      }
    } else {
      start = str.length;
    }
    if (slice.trim()) {
      chunks.push({
        text: slice.trim(),
        meta: { ...meta },
      });
    }
    if (end >= str.length) break; // reached end of text; don't apply overlap
    start = Math.max(start - CHUNK_OVERLAP, start - 1);
    if (start >= str.length) break;
  }
  return chunks;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build RAG index from transcripts. Replaces existing index.
 * @param {Array<{ id: string, title?: string, date?: string, rep?: string, account?: string, transcript: string }>} transcripts
 * @param {string} openaiApiKey
 * @returns {Promise<{ chunks: number }>}
 */
/** Call OpenAI embeddings API with fetch to avoid SDK heap usage. */
async function fetchEmbeddings(apiKey, texts) {
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? JSON.stringify(body);
    throw new Error(`OpenAI embeddings failed (HTTP ${res.status}): ${msg}`);
  }
  const data = body.data ?? [];
  return data.map((d) => d.embedding).filter(Boolean);
}

export async function buildRag(transcripts, openaiApiKey) {
  const key = (openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('OpenAI API key required to build RAG');

  const allChunks = [];

  for (const t of transcripts) {
    const transcript = (t.transcript || '').trim();
    if (!transcript || transcript === '[No transcript]') continue;
    const meta = buildChunkMeta(t);
    const pieces = chunkText(transcript, meta);
    for (const p of pieces) allChunks.push(p);
  }

  if (allChunks.length === 0) {
    store = { chunks: [], builtAt: null };
    return { chunks: 0 };
  }

  const texts = allChunks.map((c) => c.text);
  const batchSize = 25;
  const embeddings = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vecs = await fetchEmbeddings(key, batch);
    embeddings.push(...vecs);
  }

  store = {
    chunks: allChunks.map((c, i) => ({
      text: c.text,
      embedding: embeddings[i] || [],
      meta: c.meta,
    })),
    builtAt: new Date().toISOString(),
  };

  const chunkLengths = texts.map((t) => t.length);
  const minLen = Math.min(...chunkLengths);
  const maxLen = Math.max(...chunkLengths);
  const avgLen = chunkLengths.reduce((a, b) => a + b, 0) / chunkLengths.length;
  const transcriptCount = transcripts.filter(
    (t) => (t.transcript || '').trim() && t.transcript !== '[No transcript]'
  ).length;
  const chunkStats = {
    transcriptCount,
    totalChunks: store.chunks.length,
    avgChunkLength: Math.round(avgLen),
    minChunkLength: minLen,
    maxChunkLength: maxLen,
  };
  console.log(
    `[rag] Built ${chunkStats.totalChunks} chunks from ${chunkStats.transcriptCount} transcripts (chunk length: avg ${chunkStats.avgChunkLength}, min ${chunkStats.minChunkLength}, max ${chunkStats.maxChunkLength} chars; strategy: size ${CHUNK_SIZE}, overlap ${CHUNK_OVERLAP})`
  );
  return { chunks: store.chunks.length, chunkStats };
}

/** Fetch a single query embedding via API (no SDK). */
async function fetchQueryEmbedding(apiKey, text) {
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? `HTTP ${res.status}`);
  const data = body.data ?? [];
  return (data[0] && data[0].embedding) ? data[0].embedding : [];
}

/**
 * Retrieve top-k chunks by semantic similarity to query (first-stage retrieval).
 */
export async function retrieveAsync(query, openaiApiKey, topK = FIRST_STAGE_K) {
  if (store.chunks.length === 0) return [];
  const q = (query && String(query).trim()) || '';
  if (!q) return [];

  const key = (openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    return store.chunks.slice(0, topK).map((c) => ({ text: c.text, meta: c.meta, score: 1 }));
  }

  const queryEmbedding = await fetchQueryEmbedding(key, q);
  if (queryEmbedding.length === 0) return store.chunks.slice(0, topK).map((c) => ({ text: c.text, meta: c.meta, score: 1 }));

  const scored = store.chunks.map((c) => ({
    text: c.text,
    meta: c.meta,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Rerank candidates by combining vector similarity with lexical overlap (query terms in chunk).
 * Returns top `topN` chunks. No extra API calls.
 */
function rerankChunks(candidates, query, topN = RERANK_TOP_N) {
  if (!candidates.length || !query || !query.trim()) return candidates.slice(0, topN);
  const queryTerms = new Set(
    query
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter((t) => t.length > 1)
  );
  if (queryTerms.size === 0) return candidates.slice(0, topN);

  const scored = candidates.map((c) => {
    const text = (c.text || '').toLowerCase();
    let overlap = 0;
    for (const term of queryTerms) {
      if (text.includes(term)) overlap += 1;
    }
    const lexicalScore = overlap / queryTerms.size;
    const simScore = typeof c.score === 'number' ? c.score : 0;
    const combined = 0.7 * simScore + 0.3 * lexicalScore;
    return { ...c, score: combined };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Chat with RAG context: retrieve relevant chunks, then call OpenAI with context.
 * @param {{ message: string, history?: Array<{ role: string, content: string }>, openaiApiKey?: string, model?: string }}
 * @returns {Promise<{ reply: string }>}
 */
export async function ragChat({ message, history = [], openaiApiKey, model }) {
  const key = (openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('OpenAI API key required for chat');

  if (store.chunks.length === 0) {
    return {
      reply:
        'There are no transcripts in the RAG index. Build RAG first: fetch transcripts, select the ones you want, then click Build RAG. If you already built it, the server may have restarted and cleared the index—build again.',
      chunks: [],
    };
  }

  const chatModel = (model || CHAT_MODEL).trim() || CHAT_MODEL;

  const candidates = await retrieveAsync(message, key, FIRST_STAGE_K);
  const chunks = rerankChunks(candidates, message, RERANK_TOP_N).filter((c) => (c.text || '').trim().length > 0);

  if (chunks.length === 0) {
    return {
      reply:
        'No relevant transcript chunks were found for your question. Try rephrasing, or check that your RAG was built from transcripts that contain relevant content.',
      chunks: [],
    };
  }

  let context = chunks
    .map((c) => {
      const m = c.meta || {};
      const parts = [];
      if (m.conversationId) parts.push(`Conversation: ${m.conversationId}`);
      if (m.title) parts.push(`Title: ${m.title}`);
      if (m.date) parts.push(`Date: ${m.date}`);
      if (m.rep) parts.push(`Rep: ${m.rep}`);
      if (m.account) parts.push(`Account: ${m.account}`);
      if (m.deal_stage) parts.push(`Deal stage: ${m.deal_stage}`);
      if (m.word_count != null && m.word_count > 0) parts.push(`Words: ${m.word_count}`);
      const header = parts.length ? parts.join(' | ') : '';
      return header ? `[${header}]\n${(c.text || '').trim()}` : (c.text || '').trim();
    })
    .join('\n\n---\n\n');
  if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS) + '\n[... truncated]';

  const contextTrimmed = context.trim();
  if (contextTrimmed.length < 20) {
    return {
      reply:
        'The retrieved transcript context was empty or too small. Try building RAG again with more transcripts, or rephrasing your question.',
      chunks: [],
    };
  }

  const systemContent =
    `You are a helpful assistant that answers questions using only the provided transcript excerpts from sales calls. ` +
    `Use the context below to answer the user's question. If the context does not contain enough information, say so. ` +
    `Do not make up details. Quote or paraphrase from the transcripts when relevant.\n\nContext from transcripts:\n\n${context}`;

  const messages = [
    { role: 'system', content: systemContent },
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: chatModel,
      messages,
      max_completion_tokens: 1024,
      temperature: 0.3,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? `HTTP ${res.status}`);
  const reply = body.choices?.[0]?.message?.content ?? '';
  const chunksForClient = chunks.map((c) => {
    const m = c.meta || {};
    const text = (c.text || '').trim();
    return {
      meta: {
        conversationId: m.conversationId,
        title: m.title,
        date: m.date,
        rep: m.rep,
        account: m.account,
        deal_stage: m.deal_stage,
      },
      snippet: text.length > 180 ? text.slice(0, 180) + '…' : text,
    };
  });
  return { reply: reply || '(No response)', chunks: chunksForClient };
}

export function getRagStatus() {
  return {
    built: store.chunks.length > 0,
    chunkCount: store.chunks.length,
    builtAt: store.builtAt,
  };
}
