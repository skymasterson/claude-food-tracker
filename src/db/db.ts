import Dexie, { type Table } from 'dexie';
import { migrateTargets, migrateTemplate } from '../domain/animal';
import type { Draft, Entry, Favourite, Item, Recipe, Targets } from '../domain/types';

export interface SettingRow {
  key: string;
  value: unknown;
}
export interface CacheRow {
  key: string;
  fetchedAt: number;
  payload: unknown;
}

export class FoodDB extends Dexie {
  entries!: Table<Entry, number>;
  items!: Table<Item, number>;
  favourites!: Table<Favourite, number>;
  recipes!: Table<Recipe, number>;
  settings!: Table<SettingRow, string>;
  usdaCache!: Table<CacheRow, string>;
  drafts!: Table<Draft, number>;

  constructor(name = 'picture-food-tracker') {
    super(name);
    this.version(1).stores({
      entries: '++id, day, time',
      items: '++id, entryId, day, loggedAt',
      favourites: '++id, name',
      recipes: '++id, name',
      settings: 'key',
      usdaCache: 'key, fetchedAt',
      drafts: '++id, createdAt',
    });
    // v2: animal protein is tracked separately. Classify existing foods and move the protein limit to animal protein.
    this.version(2).upgrade(async (tx) => {
      await tx.table('items').toCollection().modify((i: Item) => { migrateTemplate(i); });
      await tx.table('favourites').toCollection().modify((f: Favourite) => { f.items.forEach(migrateTemplate); });
      await tx.table('recipes').toCollection().modify((r: Recipe) => { r.ingredients.forEach(migrateTemplate); });
      const row = (await tx.table('settings').get('targets')) as SettingRow | undefined;
      if (row?.value) await tx.table('settings').put({ key: 'targets', value: migrateTargets(row.value as Partial<Targets>) });
    });
  }
}

export const db = new FoodDB();
