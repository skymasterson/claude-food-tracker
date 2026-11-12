import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { DateSwitcher } from '../components/DateSwitcher';
import { NutrientBar } from '../components/NutrientBar';
import { backupDue } from '../db/backup';
import { db } from '../db/db';
import { getDay } from '../db/repo';
import { fmtTime, prettyDay } from '../domain/dates';
import { fmtTotal } from '../domain/format';
import { sumAll } from '../domain/nutrients';
import { NUTRIENTS, NUTRIENT_META } from '../domain/types';
import { setDraft, useDay, useSettings } from '../store';
import { cap, newEntry } from '../util';

export function Today() {
  const { day, setDay } = useDay();
  const settings = useSettings();
  const nav = useNavigate();
  const data = useLiveQuery(() => getDay(day), [day]);
  const drafts = useLiveQuery(() => db.drafts.count(), []);
  const oldest = useLiveQuery(async () => (await db.entries.orderBy('time').first())?.time ?? null, []);

  if (!settings || !data) return <p className="muted">Loading…</p>;
  const totals = sumAll(data.items);
  const needBackup = backupDue(settings.lastBackupAt, oldest ?? null);

  return (
    <>
      <DateSwitcher day={day} onChange={setDay} />

      {needBackup && (
        <p className="notice warn">
          No backup in over 30 days. Your log lives only on this phone. <Link to="/export">Back up now</Link>
        </p>
      )}
      {!!drafts && (
        <p className="notice">
          {drafts} photo{drafts > 1 ? 's' : ''} waiting to be analysed. <Link to="/capture?drafts=1">Review {drafts > 1 ? 'them' : 'it'}</Link>
        </p>
      )}

      <section className="card" aria-label={`Totals for ${prettyDay(day)}`}>
        {NUTRIENTS.map((k) => <NutrientBar key={k} nutrient={k} total={totals[k]} target={settings.targets[k]} />)}
      </section>

      <Link className="btn camera" to="/capture">
        <span aria-hidden="true">📷</span> Photograph a meal
      </Link>
      <div className="row actions">
        <Link className="btn" to="/describe">Describe it instead</Link>
        <button
          className="btn"
          onClick={() => {
            setDraft({ entry: newEntry(day, 'manual'), items: [], warnings: [] });
            nav('/review');
          }}
        >
          Add manually
        </button>
      </div>

      <h2>{prettyDay(day)}'s entries</h2>
      {data.entries.length === 0 && <p className="muted">Nothing logged for this day.</p>}
      <ul className="entries">
        {data.entries.map((e) => {
          const t = sumAll(data.items.filter((i) => i.entryId === e.id));
          return (
            <li key={e.id}>
              <Link className="entry" to={`/entry/${e.id}`}>
                {e.thumbnail ? <img src={e.thumbnail} alt="" /> : <span className="thumb-ph" aria-hidden="true">🍽</span>}
                <span className="entry-body">
                  <strong>{e.title}</strong>
                  <span className="muted small">
                    {cap(e.mealType)} · {fmtTime(e.time)}
                    {e.isRestaurant ? ' · restaurant' : ''}
                  </span>
                  <span className="small entry-nums">
                    {NUTRIENTS.map((k) => `${NUTRIENT_META[k].short} ${fmtTotal(t[k], k)}`).join(' · ')}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
