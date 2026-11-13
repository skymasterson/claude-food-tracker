import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { restoreBackup } from '../src/db/backup';
import { db, FoodDB } from '../src/db/db';
import { getDay, loadSettings } from '../src/db/repo';
import { animalProteinValue, animalShareFromUsda, migrateTargets, migrateTemplate } from '../src/domain/animal';
import { fmtTotal } from '../src/domain/format';
import { sumAll, UNKNOWN } from '../src/domain/nutrients';
import { targetStatus } from '../src/domain/targets';
import { DEFAULT_TARGETS, type ItemTemplate } from '../src/domain/types';
import type { AiItem } from '../src/services/ai/provider';
import { buildItem } from '../src/services/analyze';
import { toMatch } from '../src/services/usda';

const usda = (v: number) => ({ value: v, source: 'usda' as const });
const food = (description: string, foodCategory: string | undefined, protein: number) =>
  toMatch({ fdcId: 1, description, dataType: 'SR Legacy', foodCategory, foodNutrients: [{ nutrientId: 1003, value: protein }] });
const ai = (share: number | null, protein: number | null = 7): AiItem => ({
  name: 'Dish', usdaSearchTerm: 'dish', grams: 200, household: '', confidence: 'medium', animalProteinShare: share,
  per100g: { kcal: 100, protein, potassium: null, sodium: null, phosphorus: null },
});

describe('animal vs plant classification', () => {
  it('uses the USDA food category', () => {
    expect(animalShareFromUsda('Poultry Products', 'Chicken, breast, roasted')).toBe(1);
    expect(animalShareFromUsda('Dairy and Egg Products', 'Egg, whole, cooked')).toBe(1);
    expect(animalShareFromUsda('Finfish and Shellfish Products', 'Fish, salmon')).toBe(1);
    expect(animalShareFromUsda('Legumes and Legume Products', 'Tofu, firm')).toBe(0);
    expect(animalShareFromUsda('Cereal Grains and Pasta', 'Rice, white, cooked')).toBe(0);
  });
  it('leaves mixed categories unknown instead of guessing', () => {
    expect(animalShareFromUsda('Soups, Sauces, and Gravies', 'Soup, chicken noodle')).toBeNull();
    expect(animalShareFromUsda('Fast Foods', 'Chicken, nuggets')).toBeNull();
    expect(animalShareFromUsda('Restaurant Foods', 'Rice, fried')).toBeNull();
  });
  it('without a category, only clear single foods are classified', () => {
    expect(animalShareFromUsda(undefined, 'Chicken, broilers or fryers, breast, roasted')).toBe(1);
    expect(animalShareFromUsda(undefined, 'Rice, white, long-grain, cooked')).toBe(0);
    expect(animalShareFromUsda(undefined, 'Rice, fried with chicken')).toBeNull();
    expect(animalShareFromUsda(undefined, 'Egg substitute, powder')).toBeNull();
    expect(animalShareFromUsda(undefined, 'Pad thai')).toBeNull();
    expect(animalShareFromUsda(undefined, undefined)).toBeNull();
  });
});

describe('animal protein value', () => {
  it('is protein x share, labelled by the weaker of the two sources', () => {
    expect(animalProteinValue(usda(31), 1, 'usda')).toEqual({ value: 31, source: 'usda' });
    expect(animalProteinValue(usda(2.7), 0, 'usda')).toEqual({ value: 0, source: 'usda' });
    expect(animalProteinValue(usda(10), 0.6, 'ai-estimate')).toEqual({ value: 6, source: 'ai-estimate' });
    expect(animalProteinValue({ value: 10, source: 'ai-estimate' }, 1, 'usda').source).toBe('ai-estimate');
  });
  it('is unknown, never zero, when the protein or the share is unknown', () => {
    expect(animalProteinValue(UNKNOWN, 1, 'usda')).toEqual(UNKNOWN);
    expect(animalProteinValue(usda(10), null, 'ai-estimate')).toEqual(UNKNOWN);
  });
  it('is a known zero when the food has no protein at all', () => {
    expect(animalProteinValue(usda(0), null, 'ai-estimate')).toEqual({ value: 0, source: 'usda' });
  });
  it('clamps an out-of-range share', () => {
    expect(animalProteinValue(usda(10), 1.4, 'ai-estimate').value).toBe(10);
  });
});

describe('lookup and analysis', () => {
  it('USDA matches carry animal protein from the category', () => {
    expect(food('Chicken, breast, roasted', 'Poultry Products', 31).per100g.animalProtein).toEqual({ value: 31, source: 'usda' });
    expect(food('Rice, white, cooked', 'Cereal Grains and Pasta', 2.7).per100g.animalProtein).toEqual({ value: 0, source: 'usda' });
    expect(food('Soup, chicken noodle', 'Soups, Sauces, and Gravies', 3).per100g.animalProtein).toEqual(UNKNOWN);
    expect(food('Chicken', 'Poultry Products', 31).completeness).toBe(1); // completeness counts database nutrients only
  });
  it('prefers the USDA classification, then the AI share, then unknown', () => {
    expect(buildItem(ai(0.5), food('Chicken, roasted', 'Poultry Products', 31)).per100g.animalProtein).toEqual({ value: 31, source: 'usda' });
    const mixed = buildItem(ai(0.5), food('Soup, chicken noodle', 'Soups, Sauces, and Gravies', 4));
    expect(mixed.per100g.animalProtein).toEqual({ value: 2, source: 'ai-estimate' });
    expect(mixed.aiAnimalShare).toBe(0.5);
    expect(buildItem(ai(0.6), null).per100g.animalProtein).toEqual({ value: 7 * 0.6, source: 'ai-estimate' });
    expect(buildItem(ai(null), null).per100g.animalProtein).toEqual(UNKNOWN);
    expect(buildItem(ai(0.6, null), null).per100g.animalProtein).toEqual(UNKNOWN);
  });
  it('the 65 g limit applies to animal protein, with unknowns making the total "at least"', () => {
    const items = [buildItem({ ...ai(1, 40), grams: 200 }, null), buildItem({ ...ai(0, 20), grams: 100 }, null), buildItem(ai(null, 10), null)];
    const t = sumAll(items);
    expect(fmtTotal(t.protein, 'protein')).toBe('120 g');
    expect(fmtTotal(t.animalProtein, 'animalProtein')).toBe('at least 80 g');
    expect(targetStatus(t.animalProtein, DEFAULT_TARGETS.animalProtein).state).toBe('over');
    expect(targetStatus(t.protein, DEFAULT_TARGETS.protein).state).toBe('none');
  });
});

describe('upgrading data saved before animal protein existed', () => {
  const old = (name: string, protein: number | null, fdcId?: number, usdaDescription?: string) =>
    ({ name, grams: 100, fdcId, usdaDescription, per100g: { kcal: usda(100), protein: protein === null ? UNKNOWN : usda(protein), potassium: UNKNOWN, sodium: usda(5), phosphorus: UNKNOWN } }) as unknown as ItemTemplate;

  it('classifies USDA-matched single foods and leaves the rest unknown', () => {
    expect(migrateTemplate(old('Chicken', 31, 1, 'Chicken, broilers or fryers, breast, roasted')).per100g.animalProtein).toEqual({ value: 31, source: 'usda' });
    expect(migrateTemplate(old('Rice', 2.7, 2, 'Rice, white, cooked')).per100g.animalProtein).toEqual({ value: 0, source: 'usda' });
    expect(migrateTemplate(old('Pad thai', 7)).per100g.animalProtein).toEqual(UNKNOWN);
    expect(migrateTemplate(old('Mystery', null, 3, 'Chicken, roasted')).per100g.animalProtein).toEqual(UNKNOWN);
    const done = migrateTemplate(old('Chicken', 31, 1, 'Chicken, roasted'));
    done.per100g.animalProtein = { value: 5, source: 'user-entered' };
    expect(migrateTemplate(done).per100g.animalProtein.value).toBe(5); // never overwrites
  });
  it('moves the protein limit to animal protein and keeps total protein tracked', () => {
    const t = migrateTargets({ protein: { type: 'maximum', value: 60 }, sodium: { type: 'maximum', value: 1500 } });
    expect(t.animalProtein).toEqual({ type: 'maximum', value: 60 });
    expect(t.protein.type).toBe('none');
    expect(t.sodium.value).toBe(1500);
    const again = migrateTargets({ ...t, protein: { type: 'minimum', value: 80 } });
    expect(again.protein).toEqual({ type: 'minimum', value: 80 }); // already migrated: left alone
  });
  it('upgrades an existing version-1 database in place', async () => {
    const v1 = new Dexie('upgrade-test');
    v1.version(1).stores({ entries: '++id, day, time', items: '++id, entryId, day, loggedAt', favourites: '++id, name', recipes: '++id, name', settings: 'key', usdaCache: 'key, fetchedAt', drafts: '++id, createdAt' });
    await v1.table('items').bulkAdd([
      { ...old('Chicken', 31, 1, 'Chicken, broilers or fryers, breast, roasted'), entryId: 1, day: '2026-11-12', loggedAt: 1 },
      { ...old('Pad thai', 7), entryId: 1, day: '2026-11-12', loggedAt: 2 },
    ]);
    await v1.table('favourites').add({ name: 'Fav', items: [old('Rice', 2.7, 2, 'Rice, white, cooked')], isRestaurant: false, createdAt: 1 });
    await v1.table('recipes').add({ name: 'Rec', servings: 2, ingredients: [old('Egg', 12.6, 4, 'Egg, whole, cooked, hard-boiled')], createdAt: 1 });
    await v1.table('settings').bulkPut([{ key: 'targets', value: { kcal: { type: 'none', value: 0 }, protein: { type: 'maximum', value: 50 }, potassium: { type: 'maximum', value: 1800 }, sodium: { type: 'maximum', value: 2000 }, phosphorus: { type: 'maximum', value: 1000 } } }, { key: 'usdaKey', value: 'k' }]);
    v1.close();

    const v2 = new FoodDB('upgrade-test');
    const items = await v2.items.orderBy('loggedAt').toArray();
    expect(items[0].per100g.animalProtein).toEqual({ value: 31, source: 'usda' });
    expect(items[1].per100g.animalProtein).toEqual(UNKNOWN);
    expect(items[0].per100g.sodium).toEqual(usda(5)); // other values untouched
    expect((await v2.favourites.toArray())[0].items[0].per100g.animalProtein).toEqual({ value: 0, source: 'usda' });
    expect((await v2.recipes.toArray())[0].ingredients[0].per100g.animalProtein).toEqual({ value: 12.6, source: 'usda' });
    const targets = (await v2.settings.get('targets'))!.value as typeof DEFAULT_TARGETS;
    expect(targets.animalProtein).toEqual({ type: 'maximum', value: 50 });
    expect(targets.protein.type).toBe('none');
    expect((await v2.settings.get('usdaKey'))!.value).toBe('k');
    v2.close();
  });
  it('restores a version-1 backup file', async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const backup = {
      app: 'picture-food-tracker', version: 1, exportedAt: '2026-11-13T00:00:00Z',
      entries: [{ id: 1, day: '2026-11-12', time: 1, mealType: 'lunch', title: 'Lunch', isRestaurant: false, origin: 'photo' }],
      items: [{ ...old('Chicken', 31, 1, 'Chicken, roasted'), id: 1, entryId: 1, day: '2026-11-12', loggedAt: 1 }, { ...old('Pad thai', 7), id: 2, entryId: 1, day: '2026-11-12', loggedAt: 2 }],
      favourites: [], recipes: [],
      settings: [{ key: 'targets', value: { protein: { type: 'maximum', value: 55 } } }],
    };
    await restoreBackup(JSON.parse(JSON.stringify(backup)));
    const t = sumAll((await getDay('2026-11-12')).items);
    expect(fmtTotal(t.animalProtein, 'animalProtein')).toBe('at least 31 g');
    expect(fmtTotal(t.protein, 'protein')).toBe('38 g');
    const s = await loadSettings();
    expect(s.targets.animalProtein).toEqual({ type: 'maximum', value: 55 });
    expect(s.targets.protein.type).toBe('none');
  });
});
