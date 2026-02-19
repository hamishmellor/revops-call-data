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
          <span className="home-link-desc">Fetch Salesloft conversations, run analysis, and view pricing insights from recorded calls.</span>
        </Link>
        <Link to="/transcripts" className="home-link">
          <span className="home-link-title">Export transcripts</span>
          <span className="home-link-desc">Download raw conversation transcripts as a text file for a date range (e.g. for use with an LLM).</span>
        </Link>
      </div>
    </section>
  );
}
