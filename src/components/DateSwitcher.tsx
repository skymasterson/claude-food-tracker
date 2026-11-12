import { addDays, dayKey, prettyDay } from '../domain/dates';

export function DateSwitcher({ day, onChange }: { day: string; onChange: (d: string) => void }) {
  const today = dayKey();
  return (
    <div className="dateswitch">
      <button className="btn icon" onClick={() => onChange(addDays(day, -1))} aria-label="Previous day">‹</button>
      <label className="date-label">
        <span>{prettyDay(day, today)}</span>
        <input type="date" value={day} max={today} aria-label="Choose a date" onChange={(e) => e.target.value && onChange(e.target.value)} />
      </label>
      <button className="btn icon" onClick={() => onChange(addDays(day, 1))} disabled={day >= today} aria-label="Next day">›</button>
    </div>
  );
}
