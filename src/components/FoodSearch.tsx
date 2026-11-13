import { useEffect, useState } from 'react';
import type { Settings } from '../db/repo';
import { fmtValue } from '../domain/format';
import { DB_NUTRIENTS, NUTRIENT_META } from '../domain/types';
import { getFatSecretFood, relayConfigured, searchFatSecret, type FsHit } from '../services/fatsecret';
import { searchFoods, type FoodMatch } from '../services/usda';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Search failed.');

export function FoodSearch({ initialQuery, settings, onPick, onCancel }: {
  initialQuery: string;
  settings: Settings;
  onPick: (m: FoodMatch) => void;
  onCancel: () => void;
}) {
  const useFs = relayConfigured(settings);
  const [query, setQuery] = useState(initialQuery);
  const [usda, setUsda] = useState<FoodMatch[] | null>(null);
  const [fs, setFs] = useState<FsHit[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setErrors([]);
    // Both databases are searched together; one failing does not hide the other's results.
    const [u, f] = await Promise.allSettled([searchFoods(q, settings.usdaKey), useFs ? searchFatSecret(q, settings) : Promise.resolve(null)]);
    setUsda(u.status === 'fulfilled' ? u.value : null);
    setFs(f.status === 'fulfilled' ? f.value : null);
    setErrors([u, f].flatMap((r) => (r.status === 'rejected' ? [message(r.reason)] : [])));
    setBusy(false);
  }
  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFs(hit: FsHit) {
    setBusy(true);
    try {
      onPick(await getFatSecretFood(hit.foodId, settings));
    } catch (e) {
      setErrors([message(e)]);
      setBusy(false);
    }
  }

  const searched = usda !== null || fs !== null;
  const nothing = searched && (usda?.length ?? 0) === 0 && (fs?.length ?? 0) === 0;

  return (
    <div className="panel search-panel">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <input
          type="search"
          aria-label="Search the food databases"
          placeholder="e.g. rice white cooked, or a brand"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {errors.map((e) => <p className="notice warn" role="alert" key={e}>{e}</p>)}
      {nothing && <p className="muted">No matches. Try simpler words, or enter the values by hand.</p>}
      {usda && usda.length > 0 && (
        <>
          {useFs && <p className="results-head">USDA — foods and typical dishes</p>}
          <ul className="results" data-testid="usda-results">
            {usda.map((m) => (
              <li key={m.fdcId}>
                <button className="result" onClick={() => onPick(m)} disabled={busy}>
                  <span className="result-name">{m.description}</span>
                  <span className="result-meta">
                    {m.dataType} · per 100 g:{' '}
                    {DB_NUTRIENTS.map((k) => `${NUTRIENT_META[k].short} ${fmtValue(m.per100g[k].value, k, false)}`).join(' · ')}
                    {m.completeness < DB_NUTRIENTS.length && <em> · some values missing</em>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {fs && fs.length > 0 && (
        <>
          <p className="results-head">FatSecret — brands and restaurant chains (no phosphorus)</p>
          <ul className="results" data-testid="fatsecret-results">
            {fs.map((h) => (
              <li key={h.foodId}>
                <button className="result" onClick={() => pickFs(h)} disabled={busy}>
                  <span className="result-name">{h.brand ? `${h.brand} — ` : ''}{h.name}</span>
                  <span className="result-meta">{h.summary}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small"><a href="https://www.fatsecret.com" target="_blank" rel="noreferrer">Powered by fatsecret</a></p>
        </>
      )}
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
