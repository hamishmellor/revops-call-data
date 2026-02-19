import { useState, useEffect } from 'react';

const defaultStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const defaultEnd = new Date().toISOString().slice(0, 10);

export default function PricingInsightPage() {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [status, setStatus] = useState('idle');
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState(null);

  const [insights, setInsights] = useState([]);
  const [runStatus, setRunStatus] = useState('idle');
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState(null);
  const [quoteTooltip, setQuoteTooltip] = useState({ text: null, x: 0, y: 0 });

  const fetchInsights = async () => {
    try {
      const res = await fetch('/insights');
      const data = await res.json().catch(() => []);
      setInsights(Array.isArray(data) ? data : []);
    } catch (_) {
      setInsights([]);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchSalesloftCalls = async () => {
    setError(null);
    setStatus('running');
    setCalls([]);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`/salesloft-calls?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || res.statusText);
        setStatus('error');
        return;
      }
      setCalls(Array.isArray(data) ? data : []);
      setStatus('done');
    } catch (e) {
      setError(e.message || 'Request failed');
      setStatus('error');
    }
  };

  const runAnalysis = async () => {
    setRunError(null);
    setRunStatus('running');
    setRunResult(null);
    try {
      const res = await fetch('/run-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(data.detail || data.error || res.statusText);
        setRunStatus('error');
        return;
      }
      setRunResult(data);
      setRunStatus('done');
      await fetchInsights();
    } catch (e) {
      setRunError(e.message || 'Request failed');
      setRunStatus('error');
    }
  };

  const pricingInsights = insights.filter((row) => row.pricing_discussed);

  const formatQuotes = (v) => {
    if (v == null) return '—';
    if (typeof v === 'string') {
      try {
        const arr = JSON.parse(v);
        return Array.isArray(arr) ? arr.join(' | ') : v;
      } catch (_) {
        return v;
      }
    }
    return Array.isArray(v) ? v.join(' | ') : String(v);
  };

  const sentimentClass = (s) => {
    if (!s) return '';
    const lower = String(s).toLowerCase();
    if (lower === 'positive') return 'sentiment-positive';
    if (lower === 'negative') return 'sentiment-negative';
    return 'sentiment-neutral';
  };

  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2>Conversations &amp; analysis</h2>
          <p>Fetch recorded Salesloft conversations by date range, then run analysis to extract pricing insights (uses .env keys).</p>
        </div>
        <div className="controls">
          <div className="control-group">
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="control-group">
            <label>End date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button type="button" className="btn btn-secondary" onClick={fetchSalesloftCalls} disabled={status === 'running'}>
            {status === 'running' ? 'Fetching…' : 'Fetch conversations'}
          </button>
          <button type="button" className="btn btn-primary" onClick={runAnalysis} disabled={runStatus === 'running'}>
            {runStatus === 'running' ? 'Running analysis…' : 'Run analysis'}
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {runError && <div className="alert alert-error">{runError}</div>}
        {status === 'done' && (
          <div className="alert alert-info" style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}>
            Found <strong>{calls.length}</strong> recorded conversation{calls.length !== 1 ? 's' : ''}.
          </div>
        )}
        {runStatus === 'done' && runResult && (
          <div className="alert alert-info" style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}>
            Analysis: <strong>{runResult.processed}</strong> processed, <strong>{runResult.errors?.length ?? 0}</strong> errors.
            {runResult.hint && <span style={{ marginLeft: '0.5rem' }}>{runResult.hint}</span>}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Recorded conversations</h2>
          <p>Conversations in the selected date range. Pick a date range and click &quot;Fetch conversations&quot;.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Conversation ID</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {calls.length === 0 && status !== 'running' && (
                <tr>
                  <td colSpan={3} className="empty-state">
                    No conversations loaded. Select dates and click &quot;Fetch conversations&quot;.
                  </td>
                </tr>
              )}
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>{c.date}</td>
                  <td className="mono">{c.id}</td>
                  <td>{c.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Pricing insights</h2>
          <p>Only conversations where pricing was discussed. Run analysis to refresh.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Rep</th>
                <th>Account</th>
                <th>Deal stage</th>
                <th>Sentiment</th>
                <th>Key quotes</th>
              </tr>
            </thead>
            <tbody>
              {pricingInsights.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    {insights.length === 0 ? 'No insights yet. Run analysis above to extract pricing metadata.' : 'No insights where pricing was discussed.'}
                  </td>
                </tr>
              )}
              {pricingInsights.map((row) => (
                <tr key={row.id}>
                  <td>{row.date ?? '—'}</td>
                  <td>{row.rep ?? '—'}</td>
                  <td>{row.account ?? '—'}</td>
                  <td>{row.deal_stage ?? row.conversation_type ?? '—'}</td>
                  <td>
                    <span className={`sentiment ${sentimentClass(row.pricing_sentiment)}`}>
                      {row.pricing_sentiment ?? '—'}
                    </span>
                  </td>
                  <td
                    className="key-quotes"
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setQuoteTooltip({ text: formatQuotes(row.key_quotes), x: rect.left, y: rect.bottom });
                    }}
                    onMouseLeave={() => setQuoteTooltip((t) => ({ ...t, text: null }))}
                  >
                    {formatQuotes(row.key_quotes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {quoteTooltip.text != null && (
        <div
          className="quote-tooltip"
          style={{ left: quoteTooltip.x, top: quoteTooltip.y }}
          role="tooltip"
        >
          {quoteTooltip.text}
        </div>
      )}
    </>
  );
}
