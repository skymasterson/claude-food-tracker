import Dexie, { type Table } from 'dexie';
import type { Draft, Entry, Favourite, Item, Recipe } from '../domain/types';

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
  }
}

export const db = new FoodDB();
