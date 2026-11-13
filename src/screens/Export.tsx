import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { exportBackup, restoreBackup } from '../db/backup';
import { getRange, setSetting } from '../db/repo';
import { dailyCsv, dailyRows, itemsCsv } from '../domain/csv';
import { addDays, dayKey, fmtTime, parseDay, rangeDays } from '../domain/dates';
import { fmtTarget, fmtTotal } from '../domain/format';
import { sumAll } from '../domain/nutrients';
import { isOver } from '../domain/targets';
import { NUTRIENTS, NUTRIENT_META } from '../domain/types';
import { useSettings } from '../store';
import { cap, download } from '../util';

export function Export() {
  const settings = useSettings();
  const today = dayKey();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [withMeals, setWithMeals] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(() => getRange(from, to), [from, to]);

  if (!settings || !data) return <p className="muted">Loading…</p>;
  const rows = dailyRows(rangeDays(from, to), data.items, data.entries).filter((r) => r.entries > 0);
  const long = (d: string) => parseDay(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  async function backup() {
    const b = await exportBackup();
    download(`food-tracker-backup-${today}.json`, JSON.stringify(b), 'application/json');
    await setSetting('lastBackupAt', Date.now());
    setError('');
    setMessage(`Backup downloaded: ${b.entries.length} entries. Keep the file somewhere off this phone (email, cloud drive). API keys are not included.`);
  }
  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMessage('');
    setError('');
    try {
      const json = JSON.parse(await f.text());
      if (!confirm('Restore this backup? It REPLACES all meals, favourites, recipes and targets on this phone.')) return;
      const r = await restoreBackup(json);
      setMessage(`Restored ${r.entries} entries and ${r.items} items.`);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Restore failed.');
    }
  }

  return (
    <>
      <div className="no-print">
        <h1>Export &amp; backup</h1>
        <section className="card">
          <h2>Date range</h2>
          <div className="row">
            <label>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
            <label>To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          </div>
          <p className="muted small">{data.entries.length} entries, {data.items.length} items on {rows.length} days in this range.</p>
          <button className="btn" disabled={!data.items.length} onClick={() => download(`food-log-items-${from}-to-${to}.csv`, itemsCsv(data.entries, data.items), 'text/csv')}>
            Download CSV (one row per item, with sources)
          </button>
          <button className="btn" disabled={!rows.length} onClick={() => download(`food-log-daily-${from}-to-${to}.csv`, dailyCsv(rows), 'text/csv')}>
            Download CSV (daily totals)
          </button>
          <label className="check">
            <input type="checkbox" checked={withMeals} onChange={(e) => setWithMeals(e.target.checked)} />
            Include each meal with its photo in the printed summary
          </label>
          <button className="btn" disabled={!rows.length} onClick={() => window.print()}>Print daily summary for care team</button>
          <p className="muted small">To send it as a file, choose “Save as PDF” as the printer.</p>
        </section>

        <section className="card">
          <h2>Backup</h2>
          <p className="muted small">
            Your log is stored only on this phone. {settings.lastBackupAt ? `Last backup: ${new Date(settings.lastBackupAt).toLocaleDateString()}.` : 'No backup made yet.'}
          </p>
          <button className="btn primary" onClick={backup}>Download full backup (JSON)</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={restore} data-testid="restore-input" />
          <button className="btn" onClick={() => fileRef.current?.click()}>Restore from backup…</button>
        </section>
        {message && <p className="notice" role="status">{message}</p>}
        {error && <p className="notice warn" role="alert">{error}</p>}
        <h2>Summary preview</h2>
      </div>

      <section className="print-area">
        <h1 className="print-only">Daily nutrient summary</h1>
        <p>{long(from)} – {long(to)} · {rows.length} day{rows.length === 1 ? '' : 's'} with entries</p>
        <p className="small">Targets: {NUTRIENTS.map((k) => `${NUTRIENT_META[k].label} ${fmtTarget(settings.targets[k], k)}`).join(' · ')}</p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Date</th>{NUTRIENTS.map((k) => <th key={k}>{NUTRIENT_META[k].label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={NUTRIENTS.length + 1}>No entries in this range.</td></tr>}
              {rows.map((r) => (
                <tr key={r.day}>
                  <td>{long(r.day)}</td>
                  {NUTRIENTS.map((k) => {
                    const over = isOver(r.totals[k], settings.targets[k]);
                    return <td key={k} className={over ? 'cell-over' : ''}>{fmtTotal(r.totals[k], k)}{over ? ' ✕ over' : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          “At least” means one or more foods that day had no value for that nutrient, so the true total is higher. Values combine USDA
          FoodData Central data, AI estimates and hand-entered figures. Animal protein is total protein multiplied by the animal share of
          each food, taken from the USDA food category for single foods and estimated for mixed dishes; portions are estimated by eye. Sodium and phosphorus in restaurant
          meals are likely underestimated. This is a self-kept log, not a clinical measurement.
        </p>

        {withMeals && rows.length > 0 && (
          <div className="meal-log" data-testid="meal-log">
            <h2>Meals</h2>
            {rows.map((r) => (
              <section key={r.day} className="meal-day">
                <h3>{long(r.day)}</h3>
                {data.entries.filter((e) => e.day === r.day).map((e) => {
                  const mine = data.items.filter((i) => i.entryId === e.id);
                  const t = sumAll(mine);
                  return (
                    <div className="meal" key={e.id}>
                      {e.thumbnail && <img src={e.thumbnail} alt={`Photo of ${e.title}`} />}
                      <div className="meal-text">
                        <strong>{fmtTime(e.time)} · {cap(e.mealType)}{e.isRestaurant ? ' · restaurant' : ''}{e.thumbnail ? '' : ' · no photo'}</strong>
                        <span>{mine.map((i) => `${i.name} (${i.grams} g)`).join(', ') || e.title}</span>
                        {e.note && <span className="meal-note">Note: {e.note}</span>}
                        <span className="small">{NUTRIENTS.map((k) => `${NUTRIENT_META[k].label} ${fmtTotal(t[k], k)}`).join(' · ')}</span>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
