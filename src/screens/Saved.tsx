import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { recentItems, saveEntry } from '../db/repo';
import { prettyDay } from '../domain/dates';
import { fmtTotal, parseNum } from '../domain/format';
import { scaleItems, sumAll } from '../domain/nutrients';
import { NUTRIENTS, NUTRIENT_META, type ItemTemplate, type Origin } from '../domain/types';
import { setDraft, useDay } from '../store';
import { newEntry } from '../util';

const summary = (items: ItemTemplate[]) => {
  const t = sumAll(items);
  return NUTRIENTS.map((k) => `${NUTRIENT_META[k].short} ${fmtTotal(t[k], k)}`).join(' · ');
};

export function Saved() {
  const { day } = useDay();
  const nav = useNavigate();
  const favourites = useLiveQuery(() => db.favourites.orderBy('name').toArray(), []);
  const recipes = useLiveQuery(() => db.recipes.orderBy('name').toArray(), []);
  const recents = useLiveQuery(() => recentItems(12), []);
  const [servings, setServings] = useState<Record<number, string>>({});

  async function logNow(title: string, items: ItemTemplate[], origin: Origin, isRestaurant = false) {
    await saveEntry(newEntry(day, origin, { title, isRestaurant }), items);
    nav('/');
  }
  function adjust(title: string, items: ItemTemplate[], origin: Origin, isRestaurant = false) {
    setDraft({ entry: newEntry(day, origin, { title, isRestaurant }), items, warnings: [] });
    nav('/review');
  }

  return (
    <>
      <h1>Saved</h1>
      <p className="muted">Logging to: {prettyDay(day)}</p>

      <h2>Favourites</h2>
      {favourites?.length === 0 && <p className="muted">No favourites yet. Open any logged meal and tap “Save as favourite”.</p>}
      <ul className="cards">
        {favourites?.map((f) => (
          <li className="card" key={f.id}>
            <strong>{f.name}</strong>
            <span className="muted small">{f.items.length} item{f.items.length === 1 ? '' : 's'} · {summary(f.items)}</span>
            <div className="row">
              <button className="btn primary" onClick={() => logNow(f.name, f.items, 'favourite', f.isRestaurant)}>Log now</button>
              <button className="btn" onClick={() => adjust(f.name, f.items, 'favourite', f.isRestaurant)}>Adjust first</button>
              <button className="btn danger small" aria-label={`Remove favourite ${f.name}`} onClick={() => confirm(`Remove “${f.name}” from favourites?`) && db.favourites.delete(f.id!)}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Recipes</h2>
      {recipes?.length === 0 && <p className="muted">Enter a home recipe once, then log it by the serving.</p>}
      <ul className="cards">
        {recipes?.map((r) => {
          const n = parseNum(servings[r.id!] ?? '1');
          const portion = scaleItems(r.ingredients, (n ?? 1) / r.servings);
          return (
            <li className="card" key={r.id}>
              <strong>{r.name}</strong>
              <span className="muted small">Makes {r.servings} serving{r.servings === 1 ? '' : 's'} · per {n ?? 1} serving{(n ?? 1) === 1 ? '' : 's'}: {summary(portion)}</span>
              <div className="row">
                <label className="inline">
                  Servings
                  <input inputMode="decimal" value={servings[r.id!] ?? '1'} onChange={(e) => setServings({ ...servings, [r.id!]: e.target.value })} />
                </label>
                <button className="btn primary" disabled={!n} onClick={() => logNow(r.name, portion, 'recipe')}>Log</button>
                <Link className="btn" to={`/recipe/${r.id}`}>Edit</Link>
              </div>
            </li>
          );
        })}
      </ul>
      <Link className="btn" to="/recipe/new">＋ New recipe</Link>

      <h2>Recently logged</h2>
      {recents?.length === 0 && <p className="muted">Foods you log will appear here as quick picks.</p>}
      <ul className="chips">
        {recents?.map((i) => (
          <li key={i.name}>
            <button className="chip" onClick={() => adjust('', [i], 'manual')}>
              {i.name} <span className="muted">{i.grams} g</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
