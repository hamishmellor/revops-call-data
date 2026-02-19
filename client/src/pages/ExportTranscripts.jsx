import { useState } from 'react';

const today = new Date().toISOString().slice(0, 10);
const defaultStart = today;
const defaultEnd = today;

function buildTxtFromList(list, startDate, endDate) {
  const lines = [];
  list.forEach((c, i) => {
    lines.push(`=== Conversation ${i + 1} ===`);
    lines.push(`Date: ${c.date || '—'}`);
    lines.push(`Title: ${c.title || '—'}`);
    lines.push(`Rep: ${c.rep || '—'}`);
    lines.push(`Account: ${c.account || '—'}`);
    lines.push(`Deal stage: ${c.deal_stage || '—'}`);
    lines.push(`Words: ${c.word_count ?? 0} | Chars: ${c.char_count ?? 0}`);
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
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [minWords, setMinWords] = useState('');
  const [maxWords, setMaxWords] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [dealStageFilter, setDealStageFilter] = useState('');

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
      const arr = Array.isArray(data) ? data : [];
      setList(arr);
      setSelectedIds(new Set(arr.map((c) => c.conversationId || c.id)));
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Fetch failed');
      setFetchStatus('error');
    }
  };

  const downloadTxt = () => {
    if (!list || list.length === 0) return;
    const toExport = selectedIds.size > 0
      ? list.filter((c) => selectedIds.has(c.conversationId || c.id))
      : list;
    if (toExport.length === 0) return;
    const body = buildTxtFromList(toExport, startDate, endDate);
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

  const filteredList =
    list &&
    list.filter((c) => {
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
      if (repFilter.trim()) {
        if (!rep.includes(repFilter.trim().toLowerCase())) return false;
      }
      if (accountFilter.trim()) {
        if (!account.includes(accountFilter.trim().toLowerCase())) return false;
      }
      if (dealStageFilter.trim()) {
        if (!dealStage.includes(dealStageFilter.trim().toLowerCase())) return false;
      }
      return true;
    });

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set((filteredList || list || []).map((c) => c.conversationId || c.id)));
  const deselectAll = () => setSelectedIds(new Set());

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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={downloadTxt}
            disabled={!list || list.length === 0 || (selectedIds.size === 0 && list.length > 0)}
          >
            2) Download .txt {selectedIds.size > 0 ? `(${selectedIds.size} selected)` : ''}
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
            <h2>Pre-screen transcripts</h2>
            <p>
              {list.length} conversation{list.length !== 1 ? 's' : ''} with transcripts. Filter by word count, then choose which to include in the download. Only selected rows are exported.
            </p>
          </div>
          <div className="controls" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="control-group">
              <label>Rep</label>
              <input
                type="text"
                placeholder="Filter by rep…"
                value={repFilter}
                onChange={(e) => setRepFilter(e.target.value)}
                style={{ width: '10rem' }}
              />
            </div>
            <div className="control-group">
              <label>Account</label>
              <input
                type="text"
                placeholder="Filter by account…"
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                style={{ width: '10rem' }}
              />
            </div>
            <div className="control-group">
              <label>Deal stage</label>
              <input
                type="text"
                placeholder="Filter by deal stage…"
                value={dealStageFilter}
                onChange={(e) => setDealStageFilter(e.target.value)}
                style={{ width: '10rem' }}
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
                style={{ width: '6rem' }}
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
                style={{ width: '6rem' }}
              />
            </div>
            <div className="control-group" style={{ alignSelf: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={selectAll}>
                Select all visible
              </button>
              <button type="button" className="btn btn-secondary" onClick={deselectAll}>
                Deselect all
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '2.5rem' }}>Include</th>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Rep</th>
                  <th>Account</th>
                  <th>Deal stage</th>
                  <th style={{ textAlign: 'right' }}>Words</th>
                  <th style={{ textAlign: 'right' }}>Chars</th>
                  <th className="mono">Conversation ID</th>
                </tr>
              </thead>
              <tbody>
                {(filteredList || list).map((c, i) => {
                  const id = c.conversationId || c.id;
                  const checked = selectedIds.has(id);
                  return (
                    <tr key={id || i}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(id)}
                          aria-label={`Include ${id} in export`}
                        />
                      </td>
                      <td>{c.date ?? '—'}</td>
                      <td title={c.title || ''} style={{ maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.title ?? '—'}
                      </td>
                      <td>{c.rep ?? '—'}</td>
                      <td>{c.account ?? '—'}</td>
                      <td>{c.deal_stage ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{(c.word_count ?? 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{(c.char_count ?? 0).toLocaleString()}</td>
                      <td className="mono" style={{ fontSize: '0.85em' }}>{id ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredList && filteredList.length < list.length && (
            <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Showing {filteredList.length} of {list.length} (filtered by criteria above).
            </p>
          )}
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
