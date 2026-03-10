import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <section className="card home-card">
      <div className="card-header">
        <h2>Welcome</h2>
        <p>Sales call transcripts tool — choose what you want to do.</p>
      </div>
      <div className="home-links">
        <Link to="/pricing" className="home-link">
          <span className="home-link-title">Pricing insight</span>
          <span className="home-link-desc">Fetch Salesloft conversations by date, run an AI extractor over each transcript, and view structured pricing insights (discounts, objections, sentiment, key quotes) in a table. Results are stored so you can review and export them.</span>
        </Link>
        <Link to="/transcripts" className="home-link">
          <span className="home-link-title">Export transcripts</span>
          <span className="home-link-desc">Fetch conversations from Salesloft for a date range and download the raw transcripts as text files in a ZIP. Filter by rep, account, deal stage, or SME vs non-SME. Use the export for offline analysis or feeding into other tools.</span>
        </Link>
        <Link to="/rag" className="home-link">
          <span className="home-link-title">RAG chat</span>
          <span className="home-link-desc">Fetch transcripts, build a searchable index (chunked and embedded), then ask questions in natural language. The AI answers using only the retrieved transcript excerpts as context, so you can explore themes (e.g. pricing objections) across many calls in one conversation.</span>
        </Link>
        <Link to="/call-analysis" className="home-link">
          <span className="home-link-title">Call analysis</span>
          <span className="home-link-desc">Fetch transcripts, then ask a single question (e.g. “What was the main pricing objection?”). The AI answers that question for every call in turn. You get a table with one short answer (and optional quote) per call, easy to copy into Excel or Google Sheets for reporting.</span>
        </Link>
      </div>
    </section>
  );
}
