import { useState, useRef, useEffect } from 'react';
import { apiUrl } from '../api';

const today = new Date().toISOString().slice(0, 10);

export default function TranscriptRAGPage() {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [list, setList] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle');
  const [fetchError, setFetchError] = useState(null);
  const [fetchProgress, setFetchProgress] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [ragStatus, setRagStatus] = useState({ built: false, chunkCount: 0, builtAt: null });
  const [buildStatus, setBuildStatus] = useState('idle');
  const [buildError, setBuildError] = useState(null);
  /** Chunk count from the last build done from the current transcript list (null if not built from this list yet) */
  const [lastBuildChunks, setLastBuildChunks] = useState(null);
  /** Chunk stats from last build (for verifying chunking strategy) */
  const [lastBuildChunkStats, setLastBuildChunkStats] = useState(null);
  const [chatModel, setChatModel] = useState('gpt-4o-mini');
  const [chatModelCustom, setChatModelCustom] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [chatStatus, setChatStatus] = useState('idle');
  const [chatError, setChatError] = useState(null);
  const messagesEndRef = useRef(null);
  const streamCompletedRef = useRef(false);

  useEffect(() => {
    fetch(apiUrl('/rag/status'))
      .then((r) => r.json())
      .then(setRagStatus)
      .catch(() => setRagStatus({ built: false, chunkCount: 0, builtAt: null }));
  }, [buildStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const fetchTranscripts = () => {
    setFetchError(null);
    setFetchStatus('running');
    setList(null);
    setLastBuildChunks(null);
    setLastBuildChunkStats(null);
    setFetchProgress({ current: 0, total: 0 });
    streamCompletedRef.current = false;
    const params = new URLSearchParams({ startDate, endDate });
    const es = new EventSource(apiUrl(`/export-transcripts-stream?${params}`));
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setFetchProgress({ current: data.current, total: data.total });
        } else if (data.type === 'done') {
          streamCompletedRef.current = true;
          const arr = Array.isArray(data.conversations) ? data.conversations : [];
          setList(arr);
          const withTranscript = arr.filter(
            (c) => (c.word_count ?? 0) > 0 || (c.transcript && c.transcript !== '[No transcript]')
          );
          setSelectedIds(new Set(withTranscript.map((c) => c.conversationId || c.id)));
          setFetchStatus('done');
          setFetchProgress(null);
          es.close();
        } else if (data.type === 'error') {
          streamCompletedRef.current = true;
          setFetchError(data.error || 'Fetch failed');
          setFetchStatus('error');
          setFetchProgress(null);
          es.close();
        }
      } catch (e) {
        streamCompletedRef.current = true;
        setFetchError(e.message || 'Invalid response');
        setFetchStatus('error');
        setFetchProgress(null);
        es.close();
      }
    };
    es.onerror = () => {
      es.close();
      if (streamCompletedRef.current) return;
      setFetchError('Connection lost or server error');
      setFetchStatus('error');
      setFetchProgress(null);
    };
  };

  const buildRag = async () => {
    if (!list || selectedIds.size === 0) return;
    const transcripts = list
      .filter((c) => selectedIds.has(c.conversationId || c.id))
      .filter((c) => (c.transcript || '').trim() && c.transcript !== '[No transcript]')
      .map((c) => ({
        id: c.conversationId || c.id,
        conversationId: c.conversationId || c.id,
        title: c.title ?? '',
        date: c.date ?? '',
        rep: c.rep ?? '',
        account: c.account ?? '',
        deal_stage: c.deal_stage ?? '',
        word_count: c.word_count ?? 0,
        char_count: c.char_count ?? 0,
        transcript: c.transcript,
      }));
    if (transcripts.length === 0) {
      setBuildError('No transcripts with content selected.');
      return;
    }
    setBuildError(null);
    setBuildStatus('running');
    try {
      const res = await fetch(apiUrl('/rag/build'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcripts }),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setBuildError(
          res.ok
            ? 'Invalid response from server.'
            : `Build failed (${res.status}): server returned non-JSON. Check the terminal running the server for errors.`
        );
        setBuildStatus('error');
        return;
      }
      if (!res.ok) {
        const errMsg = data.error || data.message || 'Build failed';
        setBuildError(errMsg);
        setBuildStatus('error');
        return;
      }
      setRagStatus({ built: true, chunkCount: data.chunks });
      setLastBuildChunks(data.chunks);
      setLastBuildChunkStats(data.chunkStats || null);
      setBuildStatus('done');
    } catch (err) {
      const msg = err.message || 'Build failed';
      const isNetwork =
        msg === 'Failed to fetch' ||
        msg.includes('NetworkError') ||
        msg.includes('Load failed');
      setBuildError(
        isNetwork
          ? 'Could not reach the server. Run npm run dev from the project root (starts both server and client).'
          : msg
      );
      setBuildStatus('error');
    }
  };

  const sendMessage = async () => {
    const msg = (message || '').trim();
    if (!msg) return;
    if (!ragStatus.built) {
      setChatError('Build RAG first (fetch transcripts, select, then Build RAG).');
      return;
    }
    setChatError(null);
    setMessage('');
    const userTurn = { role: 'user', content: msg };
    setHistory((h) => [...h, userTurn]);
    setChatStatus('running');
    try {
      const res = await fetch(apiUrl('/rag/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          model: chatModel === 'other' ? (chatModelCustom.trim() || 'gpt-4o-mini') : chatModel,
        }),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setChatError('Server returned non-JSON. Is the backend running on port 3001?');
        setHistory((h) => [...h, { role: 'assistant', content: 'Error: could not parse server response.' }]);
        setChatStatus('idle');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setHistory((h) => [...h, { role: 'assistant', content: data.reply }]);
      setChatStatus('idle');
    } catch (err) {
      setChatError(err.message || 'Chat failed');
      setHistory((h) => [...h, { role: 'assistant', content: `Error: ${err.message}` }]);
      setChatStatus('idle');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllWithTranscript = () => {
    if (!list) return;
    const ids = list
      .filter((c) => (c.word_count ?? 0) > 0 || (c.transcript && c.transcript !== '[No transcript]'))
      .map((c) => c.conversationId || c.id);
    setSelectedIds(new Set(ids));
  };

  const selectedWithContent = list
    ? list.filter(
        (c) =>
          selectedIds.has(c.conversationId || c.id) &&
          (c.transcript || '').trim() &&
          c.transcript !== '[No transcript]'
      ).length
    : 0;

  return (
    <div className="rag-page">
      <section className="card">
        <div className="card-header">
          <h2>RAG: Search transcripts with an LLM</h2>
          <p>
            Fetch transcripts from Salesloft (same tool as Export), build a searchable index, then chat with an AI that uses only those transcripts as context.
          </p>
          <div
            className="rag-status-line"
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius)',
              background: ragStatus.built ? 'var(--modulr-blue-light)' : 'var(--modulr-surface)',
              borderLeft: `4px solid ${ragStatus.built ? 'var(--modulr-blue)' : 'var(--modulr-border)'}`,
              fontSize: '0.875rem',
              color: 'var(--modulr-text)',
            }}
          >
            {ragStatus.built ? (
              <>
                <strong>RAG available</strong>
                {ragStatus.builtAt && (
                  <> — built {new Date(ragStatus.builtAt).toLocaleString()}</>
                )}
                {ragStatus.chunkCount != null && ragStatus.chunkCount > 0 && (
                  <> ({ragStatus.chunkCount} chunks)</>
                )}
                . Fetch and build again to replace.
              </>
            ) : (
              <>No RAG built yet. Fetch transcripts, then select and build to create one.</>
            )}
          </div>
        </div>

        <div className="controls" style={{ padding: '1.25rem' }}>
          <div className="control-group">
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="control-group">
            <label>End date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={fetchTranscripts}
            disabled={fetchStatus === 'running'}
          >
            {fetchStatus === 'running' ? 'Fetching…' : 'Fetch transcripts'}
          </button>
        </div>
        {fetchError && <div className="alert alert-error" style={{ margin: '0 1.25rem 1rem' }}>{fetchError}</div>}
        {fetchStatus === 'running' && (
          <div style={{ margin: '0 1.25rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} aria-hidden />
            <span>Loading: {fetchProgress?.current ?? 0} / {fetchProgress?.total ?? '…'}</span>
          </div>
        )}
      </section>

      {list && list.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Select transcripts for RAG</h2>
            <p>
              {list.length} conversation{list.length !== 1 ? 's' : ''} fetched. Select which to include in the search index. Only conversations with transcript content are useful.
            </p>
          </div>
          <div style={{ padding: '1.25rem 1.25rem 1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={selectAllWithTranscript}>
              Select all with transcript
            </button>
          </div>
          <div className="table-wrap" style={{ margin: '0 1.25rem 1.25rem' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Include</th>
                  <th>Date</th>
                  <th>Title / Account</th>
                  <th>Rep</th>
                  <th>Words</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const id = c.conversationId || c.id;
                  const hasContent = (c.word_count ?? 0) > 0 || (c.transcript && c.transcript !== '[No transcript]');
                  return (
                    <tr key={id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(id)}
                          onChange={() => toggleSelect(id)}
                          disabled={!hasContent}
                          aria-label={`Include ${c.title || id}`}
                        />
                      </td>
                      <td>{c.date || '—'}</td>
                      <td>{c.title || c.account || '—'}</td>
                      <td>{c.rep || '—'}</td>
                      <td className="mono">{c.word_count ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '1rem 1.25rem 1.25rem', borderTop: '1px solid var(--modulr-border)' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => buildRag()}
              disabled={buildStatus === 'running' || selectedWithContent === 0}
              title={selectedWithContent === 0 ? 'Select one or more transcripts with content above' : undefined}
            >
              {buildStatus === 'running' ? 'Building RAG…' : 'Build RAG'}
            </button>
            {buildError && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{buildError}</div>}
            {ragStatus.built && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--modulr-success)' }}>
                <p>
                  {lastBuildChunks != null
                    ? `RAG ready (${lastBuildChunks} chunks) from the selected transcripts above. You can chat below.`
                    : `A RAG is already loaded (${ragStatus.chunkCount} chunks). Build RAG above to replace it with your selection, then chat below.`}
                </p>
                {lastBuildChunkStats && (
                  <p style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--modulr-text-muted)' }}>
                    Chunking: {lastBuildChunkStats.totalChunks} chunks from {lastBuildChunkStats.transcriptCount} transcript{lastBuildChunkStats.transcriptCount !== 1 ? 's' : ''}; avg length {lastBuildChunkStats.avgChunkLength} chars (min {lastBuildChunkStats.minChunkLength}, max {lastBuildChunkStats.maxChunkLength}). Strategy: 800 chars with 200 overlap.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {ragStatus.built && (
      <section className="card">
        <div className="card-header">
          <h2>Chat over your transcripts</h2>
          <p>
            Ask questions in natural language. The AI will use only the transcript chunks you indexed, so answers are grounded in your Salesloft calls.
          </p>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="rag-chat-model" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem', color: 'var(--modulr-text-muted)' }}>Model</label>
            <select
              id="rag-chat-model"
              className="input-field"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              disabled={chatStatus === 'running'}
              style={{ minWidth: 200, marginBottom: chatModel === 'other' ? '0.5rem' : 0 }}
            >
              <optgroup label="GPT-5">
                <option value="gpt-5.2">gpt-5.2</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-5-nano">gpt-5-nano</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </optgroup>
              <optgroup label="GPT-4">
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
              </optgroup>
              <option value="other">Other (enter model ID)</option>
            </select>
            {chatModel === 'other' && (
              <input
                type="text"
                className="input-field"
                placeholder="e.g. gpt-4.1 or o4-mini"
                value={chatModelCustom}
                onChange={(e) => setChatModelCustom(e.target.value)}
                disabled={chatStatus === 'running'}
                style={{ minWidth: 200 }}
              />
            )}
            <p style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--modulr-text-muted)' }}>
              Which models you can use depends on your OpenAI account. List yours at <a href="https://platform.openai.com/docs/models" target="_blank" rel="noopener noreferrer">platform.openai.com/docs/models</a> or via the API.
            </p>
          </div>
          <div
            className="rag-chat-history"
            style={{
              minHeight: 200,
              maxHeight: 400,
              overflowY: 'auto',
              border: '1px solid var(--modulr-border)',
              borderRadius: 'var(--radius)',
              padding: '1rem',
              marginBottom: '1rem',
              background: 'var(--modulr-bg)',
            }}
          >
            {history.length === 0 && (
              <p style={{ color: 'var(--modulr-text-muted)', fontSize: '0.875rem' }}>
                Ask something like: “What pricing objections came up?” or “Which accounts mentioned budget constraints?”
              </p>
            )}
            {history.map((m, i) => (
              <div
                key={i}
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius)',
                  background: m.role === 'user' ? 'var(--modulr-surface)' : 'var(--modulr-blue-light)',
                  borderLeft: m.role === 'user' ? 'none' : '4px solid var(--modulr-blue)',
                }}
              >
                <strong style={{ fontSize: '0.75rem', color: 'var(--modulr-text-muted)' }}>{m.role === 'user' ? 'You' : 'Assistant'}</strong>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.35rem' }}>{m.content}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {chatError && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{chatError}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <textarea
              className="input-field"
              placeholder="Ask about your transcripts…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={2}
              style={{ flex: 1, resize: 'vertical' }}
              disabled={!ragStatus.built || chatStatus === 'running'}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={!ragStatus.built || chatStatus === 'running' || !message.trim()}
            >
              {chatStatus === 'running' ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
