import { useState, useRef, useMemo } from 'react';
import JSZip from 'jszip';

const today = new Date().toISOString().slice(0, 10);
const defaultStart = today;
const defaultEnd = today;

const MAX_TRANSCRIPT_FILES = 17; // 17 transcript files + 1 summary = 18 files max for LLM

const DEFAULT_SME_REPS = [
  'Joe Lines',
  'Alex Patt',
  'Chinyere Hatton',
  'Robin McMichael',
  'Zara Tarfiee',
];

function transcriptFileName(index) {
  return `transcript-${index + 1}.txt`;
}

/** Build summary.txt: lists every call and which transcript file it's in. */
function buildSummaryTxt(calls, fileIndexForCall, numTranscriptFiles, isSmeCall) {
  const lines = [
    'Transcript export summary',
    `Total calls: ${calls.length}`,
    `Transcript files: ${numTranscriptFiles} (transcript-1.txt through transcript-${numTranscriptFiles}.txt)`,
    '',
    'Each call is listed below with its transcript file. SME = Small/Medium Enterprise call (by rep).',
    '',
  ];
  calls.forEach((c, i) => {
    const file = transcriptFileName(fileIndexForCall(i));
    const sme = isSmeCall ? isSmeCall(c) : false;
    lines.push('---');
    lines.push(`File: ${file}`);
    lines.push(`SME: ${sme ? 'Yes' : 'No'}`);
    lines.push(`Date: ${c.date || '—'}`);
    lines.push(`Title: ${c.title || '—'}`);
    lines.push(`Rep: ${c.rep || '—'}`);
    lines.push(`Account: ${c.account || '—'}`);
    lines.push(`Deal stage: ${c.deal_stage || '—'}`);
    lines.push(`Words: ${c.word_count ?? 0}`);
    lines.push(`Chars: ${c.char_count ?? 0}`);
    lines.push(`Conversation ID: ${c.conversationId || c.id || '—'}`);
    lines.push('');
  });
  return lines.join('\n');
}

/** Content for one call (header + transcript) for inclusion in a batched file. */
function buildOneCallBlock(c, conversationNumber, isSme) {
  const lines = [];
  lines.push(`=== Conversation ${conversationNumber} ===`);
  lines.push(`SME: ${isSme ? 'Yes' : 'No'}`);
  lines.push(`Date: ${c.date || '—'}`);
  lines.push(`Title: ${c.title || '—'}`);
  lines.push(`Rep: ${c.rep || '—'}`);
  lines.push(`Account: ${c.account || '—'}`);
  lines.push(`Deal stage: ${c.deal_stage || '—'}`);
  lines.push(`Conversation ID: ${c.conversationId || c.id || '—'}`);
  lines.push('');
  const transcript = c.transcript && c.transcript !== '[No transcript]' ? c.transcript : '[No transcript]';
  lines.push(transcript);
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
  const [fetchProgress, setFetchProgress] = useState(null);
  const [smeRepList, setSmeRepList] = useState(() => [...DEFAULT_SME_REPS]);
  const [smeRepCustomInput, setSmeRepCustomInput] = useState('');
  const [smeFilter, setSmeFilter] = useState('all'); // 'all' | 'sme' | 'non-sme'

  const streamCompletedRef = useRef(false);

  const smeRepSet = useMemo(() => {
    return new Set(smeRepList.map((s) => s.trim().toLowerCase()).filter(Boolean));
  }, [smeRepList]);

  const addSmeRep = (name) => {
    const n = (name || '').trim();
    if (!n) return;
    const lower = n.toLowerCase();
    if (smeRepList.some((r) => r.trim().toLowerCase() === lower)) return;
    setSmeRepList((prev) => [...prev, n]);
    setSmeRepCustomInput('');
  };

  const removeSmeRep = (index) => {
    setSmeRepList((prev) => prev.filter((_, i) => i !== index));
  };

  const isSmeCall = (c) => smeRepSet.has((c.rep ?? '').trim().toLowerCase());

  const fetchTranscripts = () => {
    setFetchError(null);
    setFetchStatus('running');
    setList(null);
    setFetchProgress({ current: 0, total: 0 });
    streamCompletedRef.current = false;
    const params = new URLSearchParams({ startDate, endDate });
    const es = new EventSource(`/export-transcripts-stream?${params}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setFetchProgress({ current: data.current, total: data.total });
        } else if (data.type === 'done') {
          streamCompletedRef.current = true;
          const arr = Array.isArray(data.conversations) ? data.conversations : [];
          setList(arr);
          setSelectedIds(new Set(arr.map((c) => c.conversationId || c.id)));
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

  const downloadZip = async () => {
    if (!list || list.length === 0) return;
    const toExport =
      selectedIds.size > 0 ? list.filter((c) => selectedIds.has(c.conversationId || c.id)) : list;
    if (toExport.length === 0) return;

    const n = toExport.length;
    const numTranscriptFiles = Math.min(MAX_TRANSCRIPT_FILES, n);
    const chunkSize = Math.ceil(n / numTranscriptFiles);
    const fileIndexForCall = (callIndex) => Math.min(Math.floor(callIndex / chunkSize), numTranscriptFiles - 1);

    const zip = new JSZip();
    zip.file('summary.txt', buildSummaryTxt(toExport, fileIndexForCall, numTranscriptFiles, isSmeCall), { createFolders: false });

    for (let f = 0; f < numTranscriptFiles; f++) {
      const start = f * chunkSize;
      const end = Math.min(start + chunkSize, n);
      const chunk = toExport.slice(start, end);
      const parts = chunk.map((c, i) => buildOneCallBlock(c, start + i + 1, isSmeCall(c)));
      const content = parts.join('\n\n');
      zip.file(transcriptFileName(f), content, { createFolders: false });
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripts-${startDate}-to-${endDate}.zip`;
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
      if (smeFilter === 'sme' && !isSmeCall(c)) return false;
      if (smeFilter === 'non-sme' && isSmeCall(c)) return false;
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
          <p>Two steps: 1) Fetch transcripts for the date range and review the list. 2) Download a .zip containing summary.txt (index of all calls) and one .txt file per call (easy for LLMs to parse). No pricing analysis.</p>
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
            onClick={downloadZip}
            disabled={!list || list.length === 0 || (selectedIds.size === 0 && list.length > 0)}
          >
            2) Download .zip {selectedIds.size > 0 ? `(${selectedIds.size} selected)` : ''}
          </button>
        </div>
        {fetchError && <div className="alert alert-error">{fetchError}</div>}
        {fetchStatus === 'running' && (
          <div className="fetch-progress" style={{ marginTop: '1rem', marginBottom: '1rem', marginLeft: '1.25rem', marginRight: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} aria-hidden />
              <span>
                Loading transcripts: {fetchProgress?.current ?? 0} / {fetchProgress?.total ?? '…'}
              </span>
            </div>
            {fetchProgress?.total > 0 && (
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'var(--border, #e0e0e0)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round((100 * (fetchProgress.current || 0)) / fetchProgress.total)}%`,
                    backgroundColor: 'var(--primary, #2563eb)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            )}
          </div>
        )}
        {downloadDone && (
          <div className="alert alert-info" style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}>
            Downloaded. Check your downloads folder (.zip with summary.txt and one .txt per call).
          </div>
        )}
      </section>

      {list && list.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Pre-screen transcripts</h2>
            <p>
              {list.length} conversation{list.length !== 1 ? 's' : ''} in date range.
              {(() => {
                const withTranscript = list.filter((c) => (c.word_count ?? 0) > 0 || (c.transcript && c.transcript !== '[No transcript]')).length;
                return withTranscript < list.length
                  ? ` ${withTranscript} with transcript, ${list.length - withTranscript} without (metadata only).`
                  : ' Set SME reps, filter, then choose which to include. Only selected rows are exported.';
              })()}
            </p>
          </div>
          <div className="prescreen-options">
            <div className="prescreen-section">
              <h3 className="prescreen-section-title">SME / Non-SME</h3>
              <div className="prescreen-row" style={{ alignItems: 'flex-start' }}>
                <div className="sme-reps-block">
                  <label className="sme-reps-label">SME reps (calls with these reps = SME)</label>
                  <div className="sme-reps-chips">
                    {smeRepList.map((name, i) => (
                      <span key={`${name}-${i}`} className="sme-rep-chip">
                        <span className="sme-rep-chip-name">{name}</span>
                        <button
                          type="button"
                          className="sme-rep-chip-remove"
                          onClick={() => removeSmeRep(i)}
                          aria-label={`Remove ${name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="sme-reps-add">
                    <select
                      className="sme-reps-dropdown"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) addSmeRep(v);
                        e.target.value = '';
                      }}
                      aria-label="Add SME rep"
                    >
                      <option value="">Add rep…</option>
                      {DEFAULT_SME_REPS.filter((n) => !smeRepSet.has(n.toLowerCase())).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="sme-reps-add-custom">
                      <input
                        type="text"
                        placeholder="Or type name"
                        value={smeRepCustomInput}
                        onChange={(e) => setSmeRepCustomInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addSmeRep(smeRepCustomInput);
                          }
                        }}
                        className="sme-reps-custom-input"
                        aria-label="Add custom rep name"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary sme-reps-add-btn"
                        onClick={() => addSmeRep(smeRepCustomInput)}
                      >
                        Add
                      </button>
                    </span>
                  </div>
                </div>
                <div className="control-group">
                  <label>Show</label>
                  <select
                    value={smeFilter}
                    onChange={(e) => setSmeFilter(e.target.value)}
                    style={{ minWidth: '10rem' }}
                  >
                    <option value="all">All calls</option>
                    <option value="sme">SME only</option>
                    <option value="non-sme">Non-SME only</option>
                  </select>
                </div>
              </div>
            </div>
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
            <div className="prescreen-actions">
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
                  <th>SME</th>
                  <th>Transcript</th>
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
                  const sme = isSmeCall(c);
                  const hasTranscript = (c.word_count ?? 0) > 0 || (c.transcript && c.transcript !== '[No transcript]');
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
                      <td>{sme ? 'Yes' : 'No'}</td>
                      <td>{hasTranscript ? 'Yes' : 'No'}</td>
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
