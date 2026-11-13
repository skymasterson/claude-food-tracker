import { itemAmount, sumAll } from './nutrients';
import { fmtTime } from './dates';
import { NUTRIENTS, NUTRIENT_META, type Entry, type Item, type NutrientKey } from './types';

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''; // unknown stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** One row per item, with the source of every value. Unknown values are empty cells. */
export function itemsCsv(entries: Entry[], items: Item[]): string {
  const byEntry = new Map(entries.map((e) => [e.id!, e]));
  const header: string[] = ['date', 'time', 'meal', 'entry', 'restaurant', 'note', 'food', 'grams', 'household_amount', 'usda_fdc_id', 'fatsecret_food_id', 'matched_food'];
  for (const k of NUTRIENTS) header.push(`${k}_${NUTRIENT_META[k].unit}`, `${k}_source`);
  const rows: (string | number | null | undefined)[][] = [header];
  const sorted = [...items].sort((a, b) => a.day.localeCompare(b.day) || a.loggedAt - b.loggedAt || (a.id ?? 0) - (b.id ?? 0));
  for (const it of sorted) {
    const e = byEntry.get(it.entryId);
    if (!e) continue;
    const row: (string | number | null | undefined)[] = [
      e.day, fmtTime(e.time), e.mealType, e.title, e.isRestaurant ? 'yes' : 'no', e.note ?? '',
      it.name, it.grams, it.household ?? '', it.fdcId ?? null, it.fatsecretId ?? null, it.usdaDescription ?? '',
    ];
    for (const k of NUTRIENTS) {
      const amount = itemAmount(it, k);
      row.push(r2(amount), amount === null ? 'unknown' : it.per100g[k].source);
    }
    rows.push(row);
  }
  return toCsv(rows);
}

export interface DayRow {
  day: string;
  entries: number;
  totals: ReturnType<typeof sumAll>;
}

export function dailyRows(days: string[], items: Item[], entries: Entry[]): DayRow[] {
  return days.map((day) => ({
    day,
    entries: entries.filter((e) => e.day === day).length,
    totals: sumAll(items.filter((i) => i.day === day)),
  }));
}

export function dailyCsv(rows: DayRow[]): string {
  const header: string[] = ['date', 'entries'];
  for (const k of NUTRIENTS as readonly NutrientKey[]) header.push(`${k}_${NUTRIENT_META[k].unit}`, `${k}_incomplete`);
  const out: (string | number | null)[][] = [header];
  for (const r of rows) {
    const row: (string | number | null)[] = [r.day, r.entries];
    for (const k of NUTRIENTS) {
      const t = r.totals[k];
      row.push(t.knownCount === 0 && t.hasUnknown ? null : r2(t.total), t.hasUnknown ? 'yes (at least)' : 'no');
    }
    out.push(row);
  }
  return toCsv(out);
}
