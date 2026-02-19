import { useState } from 'react';

const defaultStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const defaultEnd = new Date().toISOString().slice(0, 10);

function buildTxtFromList(list, startDate, endDate) {
  const lines = [];
  list.forEach((c, i) => {
    lines.push(`=== Conversation ${i + 1} ===`);
    lines.push(`Date: ${c.date || '—'}`);
    lines.push(`Rep: ${c.rep || '—'}`);
    lines.push(`Account: ${c.account || '—'}`);
    lines.push(`Deal stage: ${c.deal_stage || '—'}`);
    lines.push(`Conversation ID: ${c.conversationId || c.id || '—'}`);
    lines.push('');
    const transcript = c.transcript && c.transcript !== '[No transcript]' ? c.transcript : '[No transcript]';
    lines.push(transcript);
    lines.push('');
  });
  return lines.join('\n');
}

export default function ExportTranscriptsPage() {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [list, setList] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle');
  const [fetchError, setFetchError] = useState(null);
  const [downloadDone, setDownloadDone] = useState(false);

  const fetchTranscripts = async () => {
    setFetchError(null);
    setFetchStatus('running');
    setList(null);
    try {
      const params = new URLSearchParams({ startDate, endDate, format: 'json', attachment: '0' });
      const res = await fetch(`/export-transcripts?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFetchError(data.error || res.statusText);
        setFetchStatus('error');
        return;
      }
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Fetch failed');
      setFetchStatus('error');
    }
  };

  const downloadTxt = () => {
    if (!list || list.length === 0) return;
    const body = buildTxtFromList(list, startDate, endDate);
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripts-${startDate}-to-${endDate}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadDone(true);
    setTimeout(() => setDownloadDone(false), 4000);
  };

  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2>Export raw transcripts</h2>
          <p>Two steps: 1) Fetch transcripts for the date range and review the list. 2) Download the full raw transcripts as a plain-text file (ideal for LLMs). No pricing analysis.</p>
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
          <button type="button" className="btn btn-primary" onClick={fetchTranscripts} disabled={fetchStatus === 'running'}>
            {fetchStatus === 'running' ? 'Fetching…' : '1) Fetch transcripts'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={downloadTxt} disabled={!list || list.length === 0}>
            2) Download .txt
          </button>
        </div>
        {fetchError && <div className="alert alert-error">{fetchError}</div>}
        {downloadDone && (
          <div className="alert alert-info" style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}>
            Downloaded. Check your downloads folder (full raw transcripts in .txt).
          </div>
        )}
      </section>

      {list && list.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Retrieved calls</h2>
            <p>{list.length} conversation{list.length !== 1 ? 's' : ''} with transcripts. Download above to get the full raw transcript in a .txt file.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Conversation ID</th>
                  <th>Rep</th>
                  <th>Account</th>
                  <th>Deal stage</th>
                  <th>Transcript</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={c.conversationId || c.id || i}>
                    <td>{c.date ?? '—'}</td>
                    <td className="mono">{c.conversationId ?? c.id ?? '—'}</td>
                    <td>{c.rep ?? '—'}</td>
                    <td>{c.account ?? '—'}</td>
                    <td>{c.deal_stage ?? '—'}</td>
                    <td>
                      {c.transcript && c.transcript !== '[No transcript]'
                        ? `${c.transcript.length} chars`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {list && list.length === 0 && fetchStatus === 'done' && (
        <div className="alert alert-info" style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}>
          No conversations with transcripts found for this date range.
        </div>
      )}
    </>
  );
}
