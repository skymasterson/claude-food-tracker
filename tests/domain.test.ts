import { describe, expect, it } from 'vitest';
import { dailyCsv, dailyRows, itemsCsv, toCsv } from '../src/domain/csv';
import { addDays, rangeDays } from '../src/domain/dates';
import { fmtTotal, parseNum, statusText } from '../src/domain/format';
import { emptyNutrients, itemAmount, mergeNutrients, per100FromPortion, scaleItems, sumAll, sumNutrient, UNKNOWN } from '../src/domain/nutrients';
import { isOver, targetLine, targetStatus } from '../src/domain/targets';
import type { Entry, Item, ItemTemplate, Nutrients } from '../src/domain/types';

const n = (o: Partial<Record<keyof Nutrients, number | null>>, source: 'usda' | 'ai-estimate' | 'user-entered' = 'usda'): Nutrients => {
  const out = emptyNutrients();
  for (const [k, v] of Object.entries(o)) out[k as keyof Nutrients] = v === null ? UNKNOWN : { value: v as number, source };
  return out;
};
const rice: ItemTemplate = { name: 'Rice', grams: 150, per100g: n({ kcal: 130, protein: 2.7, potassium: 35, sodium: 1, phosphorus: 43 }) };
const mystery: ItemTemplate = { name: 'Sauce', grams: 50, per100g: n({ kcal: 80, protein: 1, potassium: null, sodium: 900, phosphorus: null }, 'ai-estimate') };

describe('nutrient maths', () => {
  it('scales per-100 g values by grams', () => {
    expect(itemAmount(rice, 'kcal')).toBeCloseTo(195);
    expect(itemAmount(rice, 'protein')).toBeCloseTo(4.05);
    expect(itemAmount({ ...rice, grams: 0 }, 'kcal')).toBe(0);
  });
  it('returns null, not 0, for an unknown value', () => {
    expect(itemAmount(mystery, 'potassium')).toBeNull();
  });
  it('sums known values and flags unknowns as a lower bound', () => {
    const k = sumNutrient([rice, mystery], 'potassium');
    expect(k.total).toBeCloseTo(52.5);
    expect(k).toMatchObject({ hasUnknown: true, unknownCount: 1, knownCount: 1 });
    const na = sumNutrient([rice, mystery], 'sodium');
    expect(na.total).toBeCloseTo(451.5);
    expect(na).toMatchObject({ hasUnknown: false, hasEstimate: true });
  });
  it('treats a real zero as known', () => {
    const water: ItemTemplate = { name: 'Water', grams: 250, per100g: n({ kcal: 0, protein: 0, potassium: 0, sodium: 0, phosphorus: 0 }) };
    expect(sumNutrient([water], 'sodium')).toMatchObject({ total: 0, hasUnknown: false, knownCount: 1 });
  });
  it('an empty list is a known zero, not unknown', () => {
    expect(sumNutrient([], 'sodium')).toMatchObject({ total: 0, hasUnknown: false, knownCount: 0 });
  });
  it('scales items for servings without touching per-100 g values', () => {
    const [half] = scaleItems([rice], 0.5);
    expect(half.grams).toBe(75);
    expect(half.per100g).toBe(rice.per100g);
  });
  it('converts portion amounts to per-100 g and keeps blanks unknown', () => {
    expect(per100FromPortion(300, 150, 'user-entered')).toEqual({ value: 200, source: 'user-entered' });
    expect(per100FromPortion(null, 150, 'user-entered')).toEqual(UNKNOWN);
    expect(per100FromPortion(0, 150, 'user-entered')).toEqual({ value: 0, source: 'user-entered' });
  });
  it('prefers USDA, falls back to a labelled AI estimate, else unknown', () => {
    const merged = mergeNutrients(n({ kcal: 100, potassium: null, sodium: 5 }), { kcal: 999, protein: 3, potassium: 200, sodium: 800, phosphorus: null });
    expect(merged.kcal).toEqual({ value: 100, source: 'usda' });
    expect(merged.sodium).toEqual({ value: 5, source: 'usda' });
    expect(merged.potassium).toEqual({ value: 200, source: 'ai-estimate' });
    expect(merged.protein).toEqual({ value: 3, source: 'ai-estimate' });
    expect(merged.phosphorus).toEqual(UNKNOWN);
    expect(mergeNutrients(null, null).kcal).toEqual(UNKNOWN);
  });
});

describe('formatting of unknowns', () => {
  it('marks totals with unknowns as "at least"', () => {
    const t = sumAll([rice, mystery]);
    expect(fmtTotal(t.potassium, 'potassium')).toBe('at least 53 mg');
    expect(fmtTotal(t.sodium, 'sodium')).toBe('452 mg');
    expect(fmtTotal(t.protein, 'protein')).toBe('4.6 g');
  });
  it('shows "?" when nothing is known and 0 when nothing is logged', () => {
    expect(fmtTotal(sumNutrient([mystery], 'phosphorus'), 'phosphorus')).toBe('?');
    expect(fmtTotal(sumNutrient([], 'phosphorus'), 'phosphorus')).toBe('0 mg');
  });
  it('formats thousands', () => {
    expect(fmtTotal(sumNutrient([{ grams: 100, per100g: n({ sodium: 2345 }) }], 'sodium'), 'sodium')).toBe('2,345 mg');
  });
  it('parses numbers and rejects junk and negatives', () => {
    expect(parseNum(' 12,5 ')).toBe(12.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('-3')).toBeNull();
  });
});

describe('target status', () => {
  const total = (v: number, hasUnknown = false) => ({ total: v, knownCount: 1, unknownCount: hasUnknown ? 1 : 0, hasUnknown, hasEstimate: false });
  const max = { type: 'maximum' as const, value: 2000 };
  it('maximum: normal, approaching at 80%, over only above the limit', () => {
    expect(targetStatus(total(1599), max).state).toBe('ok');
    expect(targetStatus(total(1600), max).state).toBe('approaching');
    expect(targetStatus(total(2000), max).state).toBe('approaching');
    expect(targetStatus(total(2001), max).state).toBe('over');
    expect(targetStatus(total(500), max).remaining).toBe(1500);
    expect(targetStatus(total(3000), max).fraction).toBe(1);
  });
  it('flags uncertainty when the total is a lower bound', () => {
    const s = targetStatus(total(500, true), max);
    expect(s).toMatchObject({ state: 'ok', uncertain: true });
    expect(statusText(s, 'sodium')).toContain('some values unknown');
    expect(statusText(targetStatus(total(2100, true), max), 'sodium')).toBe('Over by 100 mg or more');
  });
  it('minimum', () => {
    const min = { type: 'minimum' as const, value: 65 };
    expect(targetStatus(total(40), min)).toMatchObject({ state: 'under', remaining: 25 });
    expect(targetStatus(total(65), min).state).toBe('met');
    expect(isOver(total(500), min)).toBe(false);
  });
  it('range', () => {
    const range = { type: 'range' as const, value: 50, max: 65 };
    expect(targetStatus(total(40), range).state).toBe('under');
    expect(targetStatus(total(60), range).state).toBe('ok');
    expect(targetStatus(total(66), range).state).toBe('over');
    expect(targetLine(range)).toBe(65);
  });
  it('no target, or an invalid one, never reports a state', () => {
    expect(targetStatus(total(9999), { type: 'none', value: 0 }).state).toBe('none');
    expect(targetStatus(total(9999), { type: 'maximum', value: 0 }).state).toBe('none');
    expect(targetLine({ type: 'none', value: 0 })).toBeNull();
  });
});

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(rangeDays('2026-11-10', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(rangeDays('2026-11-12', '2026-11-10')).toEqual([]);
  });
});

describe('csv', () => {
  const entry: Entry = { id: 1, day: '2026-11-12', time: new Date(2026, 10, 12, 12, 30).getTime(), mealType: 'lunch', title: 'Rice, "Sauce"', isRestaurant: true, origin: 'photo' };
  const items: Item[] = [rice, mystery].map((t, i) => ({ ...t, id: i + 1, entryId: 1, day: entry.day, loggedAt: entry.time + i }));
  it('escapes commas, quotes and newlines', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf', null, 0]])).toBe('"a,b","c""d","e\nf",,0\r\n');
  });
  it('writes one row per item with sources, and empty cells for unknowns', () => {
    const lines = itemsCsv([entry], items).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('potassium_mg,potassium_source');
    expect(lines[1]).toContain('Rice,150');
    expect(lines[1]).toContain(',52.5,usda,');
    expect(lines[2]).toContain(',,unknown,450,ai-estimate,,unknown');
  });
  it('daily totals flag incomplete days', () => {
    const rows = dailyRows(['2026-11-11', '2026-11-12'], items, [entry]);
    expect(rows[0].entries).toBe(0);
    const csv = dailyCsv(rows).split('\r\n');
    expect(csv[2]).toContain('52.5,yes (at least)');
    expect(csv[2]).toContain('451.5,no');
  });
});
