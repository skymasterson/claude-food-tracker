import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupDue, exportBackup, restoreBackup, validateBackup } from '../src/db/backup';
import { db } from '../src/db/db';
import { DEFAULT_SETTINGS, deleteEntry, getDay, loadSettings, recentItems, saveEntry, setSetting } from '../src/db/repo';
import { emptyNutrients, sumAll } from '../src/domain/nutrients';
import type { Entry, ItemTemplate } from '../src/domain/types';
import { sanitizeAiItems, type AiItem } from '../src/services/ai/provider';
import { analyzeMeal, buildItem } from '../src/services/analyze';
import { extractNutrients, rankMatches, toMatch } from '../src/services/usda';

const entry = (day: string, extra: Partial<Entry> = {}): Entry => ({ day, time: Date.parse(`${day}T12:00:00`), mealType: 'lunch', title: 'Lunch', isRestaurant: false, origin: 'manual', ...extra });
const item = (name: string, sodium: number | null): ItemTemplate => ({
  name, grams: 100,
  per100g: { ...emptyNutrients(), sodium: sodium === null ? { value: null, source: null } : { value: sodium, source: 'usda' } },
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('storage', () => {
  it('saves, replaces and deletes an entry with its items', async () => {
    const id = await saveEntry(entry('2026-11-12'), [item('A', 100), item('B', null)]);
    let day = await getDay('2026-11-12');
    expect(day.items).toHaveLength(2);
    expect(sumAll(day.items).sodium).toMatchObject({ total: 100, hasUnknown: true });
    await saveEntry({ ...entry('2026-11-12'), id }, [item('A', 250)]);
    day = await getDay('2026-11-12');
    expect(day.entries).toHaveLength(1);
    expect(day.items).toHaveLength(1);
    expect(sumAll(day.items).sodium).toMatchObject({ total: 250, hasUnknown: false });
    await deleteEntry(id);
    expect((await getDay('2026-11-12')).items).toHaveLength(0);
  });
  it('lists recent distinct foods newest first', async () => {
    await saveEntry(entry('2026-11-10'), [item('Rice', 1)]);
    await saveEntry(entry('2026-11-12'), [item('Soup', 1), item('rice', 2)]);
    expect((await recentItems()).map((i) => i.name)).toEqual(['rice', 'Soup']);
  });
  it('settings fall back to defaults', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    await setSetting('targets', { ...DEFAULT_SETTINGS.targets, sodium: { type: 'maximum', value: 1500 } });
    expect((await loadSettings()).targets.sodium.value).toBe(1500);
    expect((await loadSettings()).targets.animalProtein).toEqual({ type: 'maximum', value: 65 });
    expect((await loadSettings()).targets.protein.type).toBe('none');
  });
});

describe('backup', () => {
  it('round-trips data, keeps unknowns as null, and never exports API keys', async () => {
    await saveEntry(entry('2026-11-12'), [item('A', 100), item('B', null)]);
    await db.favourites.add({ name: 'Fav', items: [item('A', 100)], isRestaurant: false, createdAt: 1 });
    await setSetting('anthropicKey', 'sk-ant-secret');
    await setSetting('usdaKey', 'usda-secret');
    await setSetting('targets', { ...DEFAULT_SETTINGS.targets, sodium: { type: 'maximum', value: 1500 } });
    const json = JSON.stringify(await exportBackup());
    expect(json).not.toContain('secret');

    await Promise.all([db.entries.clear(), db.items.clear(), db.favourites.clear()]);
    await setSetting('targets', DEFAULT_SETTINGS.targets);
    const r = await restoreBackup(JSON.parse(json));
    expect(r).toEqual({ entries: 1, items: 2 });
    const day = await getDay('2026-11-12');
    expect(day.items.find((i) => i.name === 'B')!.per100g.sodium.value).toBeNull();
    expect(sumAll(day.items).sodium).toMatchObject({ total: 100, hasUnknown: true });
    expect(await db.favourites.count()).toBe(1);
    const s = await loadSettings();
    expect(s.targets.sodium.value).toBe(1500);
    expect(s.anthropicKey).toBe('sk-ant-secret'); // keys on the device survive a restore
  });
  it('rejects files that are not backups, leaving data untouched', async () => {
    await saveEntry(entry('2026-11-12'), [item('A', 100)]);
    expect(() => validateBackup({ hello: 1 })).toThrow(/not a Picture Food Tracker backup/);
    expect(() => validateBackup({ app: 'picture-food-tracker', version: 99 })).toThrow(/newer version/);
    const bad = { app: 'picture-food-tracker', version: 1, entries: [], items: [{ name: 'x' }], favourites: [], recipes: [], settings: [] };
    await expect(restoreBackup(bad)).rejects.toThrow(/item is invalid/);
    expect(await db.entries.count()).toBe(1);
  });
  it('reminds after 30 days without a backup, only when there is data', () => {
    const day = 86400000;
    expect(backupDue(null, null, 100 * day)).toBe(false);
    expect(backupDue(null, 0, 31 * day)).toBe(true);
    expect(backupDue(null, 0, 29 * day)).toBe(false);
    expect(backupDue(20 * day, 0, 45 * day)).toBe(false);
    expect(backupDue(20 * day, 0, 51 * day)).toBe(true);
  });
});

describe('USDA parsing', () => {
  const food = (fdcId: number, dataType: string, ids: number[]) => ({
    fdcId, dataType, description: `Food ${fdcId}`,
    foodNutrients: ids.map((nutrientId) => ({ nutrientId, unitName: nutrientId === 1008 ? 'KCAL' : 'MG', value: nutrientId })),
  });
  it('extracts the five nutrients and leaves missing ones unknown', () => {
    const x = extractNutrients([{ nutrientId: 1003, value: 2.7 }, { nutrientId: 1093, value: 0 }, { nutrientId: 1008, unitName: 'KCAL', value: 130 }]);
    expect(x.protein).toEqual({ value: 2.7, source: 'usda' });
    expect(x.sodium).toEqual({ value: 0, source: 'usda' });
    expect(x.kcal.value).toBe(130);
    expect(x.potassium.value).toBeNull();
    expect(x.phosphorus.value).toBeNull();
  });
  it('uses Atwater energy when 1008 is absent, and ignores kJ', () => {
    expect(extractNutrients([{ nutrientId: 2047, unitName: 'KCAL', value: 111 }]).kcal.value).toBe(111);
    expect(extractNutrients([{ nutrientId: 1008, unitName: 'kJ', value: 500 }]).kcal.value).toBeNull();
  });
  it('keeps relevance order across data sets but pushes incomplete foods down', () => {
    const all = [1008, 1003, 1092, 1093, 1091];
    const ranked = rankMatches([food(1, 'SR Legacy', [1008, 1003]), food(2, 'Survey (FNDDS)', all), food(3, 'Foundation', all)].map(toMatch));
    expect(ranked.map((m) => m.fdcId)).toEqual([2, 3, 1]);
  });
});

describe('AI output handling', () => {
  const ai: AiItem = { name: 'Pad thai', usdaSearchTerm: 'pad thai', grams: 300, household: '1 plate', confidence: 'medium', brand: null, animalProteinShare: 0.6, per100g: { kcal: 160, protein: 7, potassium: null, sodium: 450, phosphorus: null } };
  it('turns implausible numbers into unknown rather than keeping them', () => {
    const [x] = sanitizeAiItems({ items: [{ name: ' Soup ', grams: -5, confidence: 'certain', per100g: { kcal: 40, protein: -1, potassium: 'lots', sodium: 300 } }] });
    expect(x).toMatchObject({ name: 'Soup', usdaSearchTerm: 'Soup', grams: 100, confidence: 'low', animalProteinShare: null });
    expect(x.per100g).toEqual({ kcal: 40, protein: null, potassium: null, sodium: 300, phosphorus: null });
    expect(() => sanitizeAiItems({ nope: true })).toThrow();
  });
  it('labels fallback values as AI estimates and keeps nulls unknown', () => {
    const it0 = buildItem(ai, null);
    expect(it0.per100g.sodium).toEqual({ value: 450, source: 'ai-estimate' });
    expect(it0.per100g.potassium).toEqual({ value: null, source: null });
    expect(it0.fdcId).toBeUndefined();
  });
  it('analyses with a stub provider and warns when no USDA key is set', async () => {
    const r = await analyzeMeal({ note: 'pad thai' }, { ...DEFAULT_SETTINGS, anthropicKey: 'k' }, { analyze: async () => [ai] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].per100g.kcal.source).toBe('ai-estimate');
    expect(r.warnings.join(' ')).toMatch(/No USDA API key/);
    const none = await analyzeMeal({ note: 'x' }, { ...DEFAULT_SETTINGS, anthropicKey: 'k' }, { analyze: async () => [] });
    expect(none.warnings.join(' ')).toMatch(/No food was recognised/);
  });
});
