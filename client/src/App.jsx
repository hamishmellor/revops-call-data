import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/Home';
import PricingInsightPage from './pages/PricingInsight';
import ExportTranscriptsPage from './pages/ExportTranscripts';

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <NavLink to="/" className="app-header-logo-link" onClick={() => setMenuOpen(false)}>
          <img src="/modulr-logo.png" alt="Modulr" className="app-header-logo" />
        </NavLink>
        <nav className={`app-nav-pill ${menuOpen ? 'is-open' : ''}`}>
          <NavLink to="/" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')} end onClick={() => setMenuOpen(false)}>
            Home
          </NavLink>
          <NavLink to="/pricing" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')} onClick={() => setMenuOpen(false)}>
            Pricing insight
          </NavLink>
          <NavLink to="/transcripts" className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')} onClick={() => setMenuOpen(false)}>
            Export transcripts
          </NavLink>
        </nav>
        <div className="app-header-actions">
          <button
            type="button"
            className="app-header-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
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
