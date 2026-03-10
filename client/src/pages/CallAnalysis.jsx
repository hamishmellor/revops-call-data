import { useState, useRef, useMemo } from 'react';
import { apiUrl } from '../api';

const today = new Date().toISOString().slice(0, 10);

const DEFAULT_SME_REPS = [
  'Joe Lines',
  'Alex Patt',
  'Chinyere Hatton',
  'Robin McMichael',
  'Zara Tarfiee',
];

export default function CallAnalysisPage() {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [list, setList] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle');
  const [fetchError, setFetchError] = useState(null);
  const [fetchProgress, setFetchProgress] = useState(null);
  const [minWords, setMinWords] = useState('');
  const [maxWords, setMaxWords] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [dealStageFilter, setDealStageFilter] = useState('');
  const [smeFilter, setSmeFilter] = useState('all');
  const [smeRepList, setSmeRepList] = useState(() => [...DEFAULT_SME_REPS]);
  const [smeRepCustomInput, setSmeRepCustomInput] = useState('');
  const [question, setQuestion] = useState('');
  const [runStatus, setRunStatus] = useState('idle');
  const [runError, setRunError] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [callsListOpen, setCallsListOpen] = useState(false);
  const [copiedConvId, setCopiedConvId] = useState(null);
  const streamCompletedRef = useRef(false);

  const smeRepSet = useMemo(
    () => new Set(smeRepList.map((s) => s.trim().toLowerCase()).filter(Boolean)),
    [smeRepList]
  );
  const isSmeCall = (c) => smeRepSet.has((c.rep ?? '').trim().toLowerCase());

  const filteredList = useMemo(() => {
    if (!list) return null;
    return list.filter((c) => {
      const w = c.word_count ?? 0;
      if (minWords !== '' && minWords != null) {
        const min = Number(minWords);
        if (!Number.isNaN(min) && w < min) return false;
      }
      if (maxWords !== '' && maxWords != null) {
        const max = Number(maxWords);
        if (!Number.isNaN(max) && w > max) return false;
      }
      const rep = (c.rep ?? '').toLowerCase();
      const account = (c.account ?? '').toLowerCase();
      const dealStage = (c.deal_stage ?? '').toLowerCase();
      if (repFilter.trim() && !rep.includes(repFilter.trim().toLowerCase())) return false;
      if (accountFilter.trim() && !account.includes(accountFilter.trim().toLowerCase())) return false;
      if (dealStageFilter.trim() && !dealStage.includes(dealStageFilter.trim().toLowerCase())) return false;
      if (smeFilter === 'sme' && !isSmeCall(c)) return false;
      if (smeFilter === 'non-sme' && isSmeCall(c)) return false;
      return true;
    });
  }, [list, minWords, maxWords, repFilter, accountFilter, dealStageFilter, smeFilter, smeRepSet]);

  const addSmeRep = (name) => {
    const n = (name || '').trim();
    if (!n || smeRepList.some((r) => r.trim().toLowerCase() === n.toLowerCase())) return;
    setSmeRepList((prev) => [...prev, n]);
    setSmeRepCustomInput('');
  };
  const removeSmeRep = (index) => setSmeRepList((prev) => prev.filter((_, i) => i !== index));

  const fetchTranscripts = () => {
    setFetchError(null);
    setFetchStatus('running');
    setList(null);
    setAnalysisResult(null);
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
          setFetchStatus('done');
          setFetchProgress(null);
          es.close();
        } else if (data.type === 'error') {
          streamCompletedRef.current = true;
          setFetchError(data.error || 'Fetch failed');
          setFetchStatus('error');
          es.close();
        }
      } catch (_) {}
    };
    es.onerror = () => {
      if (!streamCompletedRef.current) {
        setFetchError('Connection lost');
        setFetchStatus('error');
        es.close();
      }
    };
  };

  const runAnalysis = async () => {
    const source = filteredList ?? list ?? [];
    const withTranscript = source.filter(
      (c) => (c.transcript || '').trim() && c.transcript !== '[No transcript]'
    );
    if (withTranscript.length === 0) {
      setRunError('No transcripts with content. Fetch transcripts first and ensure some have transcript text.');
      return;
    }
    if (!question.trim()) {
      setRunError('Enter a question to ask each call.');
      return;
    }
    setRunError(null);
    setAnalysisResult(null);
    setRunStatus('running');
    try {
      const res = await fetch(apiUrl('/analyze-calls'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcripts: withTranscript,
          question: question.trim(),
        }),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        throw new Error(res.ok ? 'Invalid response from server' : (text || `Request failed (${res.status})`));
      }
      if (!res.ok) throw new Error(data?.error || text || 'Analysis failed');
      if (!data || !Array.isArray(data.results)) throw new Error('Invalid response shape');
      setAnalysisResult(data);
      setRunStatus('idle');
    } catch (err) {
      setRunError(err.message || 'Analysis failed');
      setRunStatus('idle');
    }
  };

  const withTranscriptCount = (filteredList ?? list)
    ? (filteredList ?? list).filter((c) => (c.transcript || '').trim() && c.transcript !== '[No transcript]').length
    : 0;
  const totalWithTranscript = list
    ? list.filter((c) => (c.transcript || '').trim() && c.transcript !== '[No transcript]').length
    : 0;

  const copyTableToClipboard = async () => {
    if (!analysisResult?.results?.length) return;
    const escape = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim() || '—';
    const header = ['Date', 'Title', 'Rep', 'Answer', 'Quote'].join('\t');
    const rows = analysisResult.results.map((r) =>
      [escape(r.date), escape(r.title), escape(r.rep), escape(r.answer), escape(r.quote)].join('\t')
    );
    const tsv = [header, ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (_) {
      setCopySuccess(false);
    }
  };

  return (
    <div className="call-analysis-page" style={{ paddingBottom: '2rem' }}>
      <section className="card">
        <div className="card-header">
          <h2>Call-by-call analysis</h2>
          <p>
            Ask one question per call and get a short answer for each. Fetch transcripts by date, then run analysis.
          </p>
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
        {fetchStatus === 'running' && fetchProgress && (
          <div style={{ margin: '0 1.25rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} aria-hidden />
            <span>Loading: {fetchProgress.current} / {fetchProgress.total || '…'}</span>
          </div>
        )}
        {list != null && (
          <p style={{ margin: '0 1.25rem 1rem', fontSize: '0.875rem', color: 'var(--modulr-text-muted)' }}>
            {list.length} conversation{list.length !== 1 ? 's' : ''} fetched. {totalWithTranscript} with transcript content.
          </p>
        )}
      </section>

      {list != null && list.length > 0 && (
        <section className="card">
          <div
            className="card-header"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setCallsListOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCallsListOpen((o) => !o); } }}
            aria-expanded={callsListOpen}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', marginTop: '0.25rem' }} aria-hidden>
                {callsListOpen ? '▼' : '▶'}
              </span>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>View calls</h2>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem' }}>
                  {filteredList?.length ?? list.length} call{(filteredList?.length ?? list.length) !== 1 ? 's' : ''} (expand to see list with date, title, rep, account, deal stage, ID).
                </p>
              </div>
            </div>
          </div>
          {callsListOpen && (
            <div style={{ padding: '1rem 1.25rem', overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)', whiteSpace: 'nowrap' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Title</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Rep</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Account</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Deal stage</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>SME</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredList ?? list).map((c) => {
                    const id = c.conversationId || c.id;
                    const sme = isSmeCall(c);
                    return (
                      <tr key={id} style={{ borderBottom: '1px solid var(--modulr-border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>{c.date ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', maxWidth: '24rem', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.title || ''}>{c.title ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', maxWidth: '8rem', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.rep || ''}>{c.rep ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.account || ''}>{c.account ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{c.deal_stage ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{sme ? 'Yes' : 'No'}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {id ? (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(id).then(() => {
                                  setCopiedConvId(id);
                                  setTimeout(() => setCopiedConvId(null), 1500);
                                });
                              }}
                              title="Click to copy full ID"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                color: 'inherit',
                                font: 'inherit',
                                fontSize: '0.85em',
                                fontFamily: 'monospace',
                                textDecoration: copiedConvId === id ? 'none' : 'underline',
                                textDecorationStyle: 'dotted',
                              }}
                            >
                              {copiedConvId === id ? 'Copied!' : (id.length <= 4 ? id : `${String(id).slice(0, 4)}…`)}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {list != null && list.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Filter calls</h2>
            <p>Optionally narrow which calls to analyze. Analysis runs only on the filtered set that have transcript content.</p>
          </div>
          <div style={{ padding: '1.25rem 1.25rem 0', marginBottom: '0.5rem' }}>
            <div className="prescreen-section">
              <h3 className="prescreen-section-title">Filters</h3>
              <div className="prescreen-row">
                <div className="control-group">
                  <label>Rep</label>
                  <input
                    type="text"
                    placeholder="Filter by rep…"
                    value={repFilter}
                    onChange={(e) => setRepFilter(e.target.value)}
                    style={{ width: '11rem' }}
                  />
                </div>
                <div className="control-group">
                  <label>Account</label>
                  <input
                    type="text"
                    placeholder="Filter by account…"
                    value={accountFilter}
                    onChange={(e) => setAccountFilter(e.target.value)}
                    style={{ width: '11rem' }}
                  />
                </div>
                <div className="control-group">
                  <label>Deal stage</label>
                  <input
                    type="text"
                    placeholder="Filter by deal stage…"
                    value={dealStageFilter}
                    onChange={(e) => setDealStageFilter(e.target.value)}
                    style={{ width: '11rem' }}
                  />
                </div>
                <div className="control-group">
                  <label>Min words</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Any"
                    value={minWords}
                    onChange={(e) => setMinWords(e.target.value)}
                    style={{ width: '5.5rem' }}
                  />
                </div>
                <div className="control-group">
                  <label>Max words</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Any"
                    value={maxWords}
                    onChange={(e) => setMaxWords(e.target.value)}
                    style={{ width: '5.5rem' }}
                  />
                </div>
              </div>
            </div>
            <div className="prescreen-section">
              <h3 className="prescreen-section-title">SME / Non-SME</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--modulr-text-muted)' }}>SME reps</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                  {smeRepList.map((name, i) => (
                    <span
                      key={name}
                      className="sme-rep-chip"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        padding: '0.25rem 0.5rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--modulr-surface)',
                        border: '1px solid var(--modulr-border)',
                        fontSize: '0.8125rem',
                      }}
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => removeSmeRep(i)}
                        aria-label={`Remove ${name}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--modulr-text-muted)', fontSize: '1.1em' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <select
                    className="input-field"
                    value=""
                    onChange={(e) => { const v = e.target.value; if (v) addSmeRep(v); e.target.value = ''; }}
                    style={{ width: '5.5rem', fontSize: '0.8125rem' }}
                    aria-label="Add SME rep"
                  >
                    <option value="">Add…</option>
                    {DEFAULT_SME_REPS.filter((n) => !smeRepSet.has(n.toLowerCase())).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Or type name"
                    value={smeRepCustomInput}
                    onChange={(e) => setSmeRepCustomInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSmeRep(smeRepCustomInput); } }}
                    style={{ width: '7rem', fontSize: '0.8125rem' }}
                    aria-label="Add custom rep name"
                  />
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }} onClick={() => addSmeRep(smeRepCustomInput)}>
                    Add
                  </button>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--modulr-text-muted)' }}>Show</span>
                  <select
                    className="input-field"
                    value={smeFilter}
                    onChange={(e) => setSmeFilter(e.target.value)}
                    style={{ width: 'auto', minWidth: '8rem', fontSize: '0.8125rem', padding: '0.4rem 0.6rem' }}
                  >
                    <option value="all">All calls</option>
                    <option value="sme">SME only</option>
                    <option value="non-sme">Non-SME only</option>
                  </select>
                </span>
              </div>
            </div>
            <div style={{ padding: '0 1.25rem 1rem', fontSize: '0.875rem', color: 'var(--modulr-text-muted)', display: 'flex', justifyContent: 'flex-end' }}>
              {filteredList && filteredList.length < list.length ? (
                <>Showing {filteredList.length} of {list.length} · {withTranscriptCount} with transcript</>
              ) : (
                <>{withTranscriptCount} with transcript (will be analyzed)</>
              )}
            </div>
          </div>
        </section>
      )}

      {list != null && list.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Question</h2>
            <p>Each call will be asked this question. The model returns a short answer per call.</p>
          </div>
          <div style={{ padding: '1.25rem' }}>
            <div className="control-group" style={{ marginBottom: '1rem' }}>
              <label htmlFor="ca-question">Question to ask each call</label>
              <textarea
                id="ca-question"
                className="input-field"
                placeholder="e.g. What was the main pricing objection?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={5}
                style={{ width: '100%', resize: 'vertical' }}
                disabled={runStatus === 'running'}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runAnalysis}
              disabled={runStatus === 'running' || withTranscriptCount === 0}
            >
              {runStatus === 'running' ? 'Analyzing… (may take a while)' : `Run analysis (${withTranscriptCount} calls)`}
            </button>
            {runError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{runError}</div>}
          </div>
        </section>
      )}

      {analysisResult && (
        <section className="card">
          <div className="card-header">
            <h2>Results</h2>
            <p>{analysisResult.summary.total} call{analysisResult.summary.total !== 1 ? 's' : ''} analyzed.</p>
          </div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={copyTableToClipboard}
              >
                {copySuccess ? 'Copied!' : 'Copy table (Excel / Sheets)'}
              </button>
              {copySuccess && <span style={{ fontSize: '0.875rem', color: 'var(--modulr-success)' }}>Paste into Excel or Google Sheets</span>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Title</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Rep</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Answer</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--modulr-border)' }}>Quote</th>
                  </tr>
                </thead>
                <tbody>
                  {analysisResult.results.map((r, i) => (
                    <tr key={r.conversationId || i} style={{ borderBottom: '1px solid var(--modulr-border)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>{r.date ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', maxWidth: '16rem', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.title || ''}>{r.title ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{r.rep ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', maxWidth: '24rem' }}>{r.answer ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', maxWidth: '20rem', fontSize: '0.875rem', color: 'var(--modulr-text-muted)' }}>{r.quote ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
