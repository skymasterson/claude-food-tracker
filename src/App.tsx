import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { setSetting } from './db/repo';
import { Capture } from './screens/Capture';
import { Export } from './screens/Export';
import { RecipeEdit } from './screens/RecipeEdit';
import { ReviewExisting, ReviewNew } from './screens/Review';
import { Saved } from './screens/Saved';
import { DISCLAIMER, Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { DayProvider, useSettings } from './store';

// The charting library is only loaded when Trends is opened.
const Trends = lazy(() => import('./screens/Trends').then((m) => ({ default: m.Trends })));

const TABS = [
  { to: '/', label: 'Today', icon: '◉' },
  { to: '/saved', label: 'Saved', icon: '★' },
  { to: '/trends', label: 'Trends', icon: '▮' },
  { to: '/export', label: 'Export', icon: '⇩' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function FirstLaunch() {
  const settings = useSettings();
  if (!settings || settings.seenNotice) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="dialog">
        <h1 id="welcome-title">Picture Food Tracker</h1>
        <p>{DISCLAIMER}</p>
        <ul>
          <li>Every number shows where it came from: USDA database, AI estimate, or entered by you.</li>
          <li>Missing values are shown as “?” and never counted as zero. Totals that include them read “at least”.</li>
          <li>Animal protein is worked out from each food's type; for mixed dishes it is an estimate you can correct.</li>
          <li>Your log is stored only on this phone. Back it up from the Export tab.</li>
        </ul>
        <button className="btn primary big" onClick={() => setSetting('seenNotice', true)}>I understand</button>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <DayProvider>
        <ScrollTop />
        <main>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/capture" element={<Capture mode="photo" />} />
            <Route path="/describe" element={<Capture mode="text" />} />
            <Route path="/review" element={<ReviewNew />} />
            <Route path="/entry/:id" element={<ReviewExisting />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/recipe/:id" element={<RecipeEdit />} />
            <Route path="/trends" element={<Suspense fallback={<p className="muted">Loading…</p>}><Trends /></Suspense>} />
            <Route path="/export" element={<Export />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Today />} />
          </Routes>
        </main>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'}>
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <FirstLaunch />
      </DayProvider>
    </HashRouter>
  );
}
