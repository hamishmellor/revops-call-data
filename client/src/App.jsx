import { useState, useCallback, useEffect } from 'react';

const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const defaultEnd = new Date().toISOString().slice(0, 10);

// Base URL for "View in Salesloft" links (override with VITE_SALESLOFT_APP_CALLS_BASE in .env)
const SALESLOFT_CALL_BASE = import.meta.env.VITE_SALESLOFT_APP_CALLS_BASE || 'https://app.salesloft.com/app/calls';

export default function App() {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [salesloftApiKey, setSalesloftApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState([]);
  const [error, setError] = useState(null);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch(`/insights`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setInsights(data);
    } catch {
      setInsights([]);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const runAnalysis = async () => {
    setError(null);
    setSummary(null);
    setStatus('running');
    try {
      const body = { startDate, endDate };
      if (salesloftApiKey.trim()) body.salesloftApiKey = salesloftApiKey.trim();
      if (openaiApiKey.trim()) body.openaiApiKey = openaiApiKey.trim();
      const res = await fetch('/run-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || data.error || res.statusText);
        setStatus('error');
        return;
      }
      setSummary(data);
      setStatus('done');
      await fetchInsights();
    } catch (e) {
      setError(e.message || 'Request failed');
      setStatus('error');
    }
  };

  return (
    <div>
      <h1>Salesloft Pricing Signal Extractor</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ marginLeft: '0.5rem' }}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ marginLeft: '0.5rem' }}
            />
          </label>
          <button onClick={runAnalysis} disabled={status === 'running'}>
            Run Analysis
          </button>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ minWidth: '200px' }}>
            Salesloft API key
            <input
              type="password"
              placeholder="Paste key for live calls (or use .env)"
              value={salesloftApiKey}
              onChange={(e) => setSalesloftApiKey(e.target.value)}
              style={{ marginLeft: '0.5rem', width: '280px' }}
              autoComplete="off"
            />
          </label>
          <label style={{ minWidth: '200px' }}>
            OpenAI API key
            <input
              type="password"
              placeholder="Optional – for real extraction (or use .env)"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              style={{ marginLeft: '0.5rem', width: '280px' }}
              autoComplete="off"
            />
          </label>
        </div>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        {status === 'running' && <span>Running…</span>}
        {status === 'done' && summary && (
          <span>
            Done: {summary.processed} processed, {summary.totalCalls} total calls
            {summary.errors?.length > 0 && `, ${summary.errors.length} errors`}.
          </span>
        )}
        {status === 'error' && <span style={{ color: 'crimson' }}>{error}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Date</th>
              <th style={{ padding: '0.5rem' }}>Rep</th>
              <th style={{ padding: '0.5rem' }}>Account</th>
              <th style={{ padding: '0.5rem' }}>Call</th>
              <th style={{ padding: '0.5rem' }}>Pricing Discussed</th>
              <th style={{ padding: '0.5rem' }}>Conversation Type</th>
              <th style={{ padding: '0.5rem' }}>Discount %</th>
              <th style={{ padding: '0.5rem' }}>Objection Category</th>
              <th style={{ padding: '0.5rem' }}>Competitor</th>
              <th style={{ padding: '0.5rem' }}>Sentiment</th>
              <th style={{ padding: '0.5rem' }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {insights.length === 0 && (
              <tr>
                <td colSpan={11} style={{ padding: '1rem', color: '#666' }}>
                  No insights yet. Select a date range and click Run Analysis.
                </td>
              </tr>
            )}
            {insights.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{row.date ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.rep ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.account ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>
                  {row.salesloft_call_id ? (
                    <a href={`${SALESLOFT_CALL_BASE}/${row.salesloft_call_id}`} target="_blank" rel="noopener noreferrer">
                      View in Salesloft
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>{row.pricing_discussed ? 'Yes' : 'No'}</td>
                <td style={{ padding: '0.5rem' }}>{row.conversation_type ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.discount_requested_percent != null ? row.discount_requested_percent : '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.objection_category ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.competitor_mentioned ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.pricing_sentiment ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{row.confidence_score != null ? Number(row.confidence_score).toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
