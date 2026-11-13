import { useEffect, useState } from 'react';
import { fmtValue } from '../domain/format';
import { DB_NUTRIENTS, NUTRIENTS, NUTRIENT_META } from '../domain/types';
import { searchFoods, type FoodMatch } from '../services/usda';

export function FoodSearch({ initialQuery, usdaKey, onPick, onCancel }: {
  initialQuery: string;
  usdaKey: string;
  onPick: (m: FoodMatch) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<FoodMatch[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError('');
    try {
      setResults(await searchFoods(q, usdaKey));
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          aria-label="Search the USDA food database"
          placeholder="e.g. rice white cooked"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="notice warn" role="alert">{error}</p>}
      {results && results.length === 0 && <p className="muted">No matches. Try simpler words, or enter the values by hand.</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((m) => (
            <li key={m.fdcId}>
              <button className="result" onClick={() => onPick(m)}>
                <span className="result-name">{m.description}</span>
                <span className="result-meta">
                  {m.dataType} · per 100 g:{' '}
                  {NUTRIENTS.map((k) => `${NUTRIENT_META[k].short} ${fmtValue(m.per100g[k].value, k, false)}`).join(' · ')}
                  {m.completeness < DB_NUTRIENTS.length && <em> · some values missing</em>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
