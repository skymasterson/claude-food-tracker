import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ItemsEditor } from '../components/ItemsEditor';
import { NutrientBar } from '../components/NutrientBar';
import { deleteEntry, getDay, getEntry, saveEntry, saveFavourite } from '../db/repo';
import { fromTimeInput, prettyDay, toTimeInput } from '../domain/dates';
import { fmtTotal, fmtValue } from '../domain/format';
import { sumAll, toTemplate } from '../domain/nutrients';
import { targetStatus } from '../domain/targets';
import { MEAL_TYPES, NUTRIENTS, NUTRIENT_META, type MealType } from '../domain/types';
import { getDraft, setDraft, useSettings, type MealDraft } from '../store';
import { cap, titleFromItems } from '../util';

/** Review a new meal before saving it (draft held in memory). */
export function ReviewNew() {
  const [draft] = useState(getDraft);
  if (!draft) return <Navigate to="/" replace />;
  return <MealEditor initial={draft} />;
}

/** Edit an entry that is already saved. */
export function ReviewExisting() {
  const { id } = useParams();
  const [loaded, setLoaded] = useState<MealDraft | null | undefined>(undefined);
  useEffect(() => {
    void getEntry(Number(id)).then((r) => setLoaded(r ? { entry: r.entry, items: r.items.map(toTemplate), warnings: [] } : null));
  }, [id]);
  if (loaded === undefined) return <p className="muted">Loading…</p>;
  if (loaded === null) return <Navigate to="/" replace />;
  return <MealEditor initial={loaded} />;
}

function MealEditor({ initial }: { initial: MealDraft }) {
  const settings = useSettings();
  const nav = useNavigate();
  const [entry, setEntry] = useState(initial.entry);
  const [items, setItems] = useState(initial.items);
  const [favName, setFavName] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const dayData = useLiveQuery(() => getDay(entry.day), [entry.day]);
  const isExisting = entry.id !== undefined;

  if (!settings || !dayData) return <p className="muted">Loading…</p>;

  const others = dayData.items.filter((i) => i.entryId !== entry.id);
  const mealTotals = sumAll(items);
  const dayTotals = sumAll([...others, ...items]);
  const exceeded = NUTRIENTS.filter((k) => targetStatus(dayTotals[k], settings.targets[k]).state === 'over');
  const anyEstimate = NUTRIENTS.some((k) => mealTotals[k].hasEstimate);
  const anyUnknown = NUTRIENTS.some((k) => mealTotals[k].hasUnknown);
  const keepTitle = (entry.origin === 'favourite' || entry.origin === 'recipe') && entry.title;

  async function save() {
    await saveEntry({ ...entry, title: keepTitle ? entry.title : titleFromItems(items) }, items);
    setDraft(null);
    nav('/');
  }
  async function remove() {
    if (entry.id !== undefined && confirm('Delete this entry?')) {
      await deleteEntry(entry.id);
      nav('/');
    }
  }
  async function addFavourite() {
    if (!favName?.trim()) return;
    await saveFavourite({ name: favName.trim(), items, isRestaurant: entry.isRestaurant, createdAt: Date.now() });
    setFavName(null);
    setMessage(`Saved “${favName.trim()}” to favourites.`);
  }

  return (
    <>
      <h1>{isExisting ? 'Edit entry' : 'Review meal'}</h1>
      <p className="muted">{prettyDay(entry.day)}{keepTitle ? ` · ${entry.title}` : ''}</p>

      {initial.warnings.map((w) => <p className="notice warn" key={w}>{w}</p>)}
      {entry.isRestaurant && (
        <p className="notice warn" data-testid="restaurant-note">
          <strong>Restaurant meal:</strong> sodium and phosphorus are likely underestimated. Added salt and phosphate additives can't be seen in a photo or found in a database.
        </p>
      )}

      <section className="card meta">
        {entry.thumbnail && <img className="thumb-lg" src={entry.thumbnail} alt="" />}
        <div className="row">
          <label>
            Meal
            <select value={entry.mealType} onChange={(e) => setEntry({ ...entry, mealType: e.target.value as MealType })}>
              {MEAL_TYPES.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
            </select>
          </label>
          <label>
            Time
            <input type="time" value={toTimeInput(entry.time)} onChange={(e) => setEntry({ ...entry, time: fromTimeInput(entry.day, e.target.value) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={entry.isRestaurant} onChange={(e) => setEntry({ ...entry, isRestaurant: e.target.checked })} />
          Restaurant or takeaway meal
        </label>
        <label>
          Note
          <input value={entry.note ?? ''} onChange={(e) => setEntry({ ...entry, note: e.target.value || undefined })} placeholder="optional" />
        </label>
      </section>

      <h2>Foods <span className="muted small">— check each amount</span></h2>
      <ItemsEditor items={items} onChange={setItems} usdaKey={settings.usdaKey} />
      {(anyEstimate || anyUnknown) && (
        <p className="legend small">
          {anyEstimate && <><span className="swatch src-ai-estimate">~12</span> AI estimate, not a database value. </>}
          {anyUnknown && <><span className="swatch src-unknown">?</span> Unknown — left out of totals, so totals read “at least”.</>}
        </p>
      )}

      <section className="card" aria-label="Totals">
        <h2>This meal</h2>
        <dl className="meal-totals">
          {NUTRIENTS.map((k) => (
            <div key={k}>
              <dt>{NUTRIENT_META[k].label}</dt>
              <dd>{fmtTotal(mealTotals[k], k)}</dd>
            </div>
          ))}
        </dl>
        <h2>{prettyDay(entry.day)} after saving</h2>
        {exceeded.length > 0 && (
          <p className="notice over" role="alert" data-testid="exceeded">
            <strong>✕ Saving this puts the day over:</strong>{' '}
            {exceeded.map((k) => `${NUTRIENT_META[k].label} (by ${fmtValue(dayTotals[k].total - (settings.targets[k].type === 'range' ? settings.targets[k].max ?? settings.targets[k].value : settings.targets[k].value), k)}${dayTotals[k].hasUnknown ? ' or more' : ''})`).join(', ')}
          </p>
        )}
        {NUTRIENTS.map((k) => <NutrientBar key={k} compact nutrient={k} total={dayTotals[k]} target={settings.targets[k]} />)}
      </section>

      {message && <p className="notice" role="status">{message}</p>}
      {favName !== null && (
        <form className="panel row" onSubmit={(e) => { e.preventDefault(); void addFavourite(); }}>
          <input aria-label="Favourite name" value={favName} onChange={(e) => setFavName(e.target.value)} placeholder="Name this meal" autoFocus />
          <button className="btn primary" type="submit">Save</button>
          <button className="btn ghost" type="button" onClick={() => setFavName(null)}>Cancel</button>
        </form>
      )}

      <div className="sticky-actions">
        <button className="btn primary big" onClick={save} disabled={items.length === 0}>
          {isExisting ? 'Save changes' : 'Save to log'}
        </button>
      </div>
      <div className="row">
          {favName === null && <button className="btn" onClick={() => setFavName(keepTitle ? entry.title : titleFromItems(items))} disabled={items.length === 0}>★ Save as favourite</button>}
          {isExisting && <button className="btn danger" onClick={remove}>Delete entry</button>}
          <button className="btn ghost" onClick={() => { setDraft(null); nav('/'); }}>Cancel</button>
      </div>
    </>
  );
}
