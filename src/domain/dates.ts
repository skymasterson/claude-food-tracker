export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Inclusive list of day keys from `from` to `to`. */
export function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (let k = from; k <= to && out.length < 3700; k = addDays(k, 1)) out.push(k);
  return out;
}

export function prettyDay(key: string, today: string = dayKey()): string {
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return parseDay(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDay(key: string): string {
  return parseDay(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A timestamp on `day` carrying the clock time of `now` (for logging onto past days). */
export function timeOnDay(day: string, now: Date = new Date()): number {
  const d = parseDay(day);
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return d.getTime();
}

export function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fromTimeInput(day: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseDay(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}
