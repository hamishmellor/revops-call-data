import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/Home';
import PricingInsightPage from './pages/PricingInsight';
import ExportTranscriptsPage from './pages/ExportTranscripts';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <div className="app-header-inner">
            <div>
              <h1>Sales Call Transcripts Tool</h1>
              <p className="tagline">Modulr · Sales conversation recorded calls tool</p>
            </div>
            <nav className="app-nav">
              <NavLink to="/" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')} end>
                Home
              </NavLink>
              <NavLink to="/pricing" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}>
                Pricing insight
              </NavLink>
              <NavLink to="/transcripts" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}>
                Export transcripts
              </NavLink>
            </nav>
            <div className="app-header-logo-wrap">
              <img src="/modulr-logo.png" alt="Modulr" className="app-header-logo" />
            </div>
          </div>
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/pricing" element={<PricingInsightPage />} />
            <Route path="/transcripts" element={<ExportTranscriptsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
