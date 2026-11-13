import { db } from './db';
import { migrateTargets, migrateTemplate } from '../domain/animal';
import { DB_NUTRIENTS, type Entry, type Favourite, type Item, type ItemTemplate, type Recipe, type Targets } from '../domain/types';

export const BACKUP_APP = 'picture-food-tracker';
export const BACKUP_VERSION = 2; // v2 adds animal protein; v1 backups are upgraded on restore
/** API keys are deliberately left out of backups so a shared file never leaks them. */
const SECRET_KEYS = ['anthropicKey', 'usdaKey', 'fatsecretToken'];

export interface Backup {
  app: string;
  version: number;
  exportedAt: string;
  entries: Entry[];
  items: Item[];
  favourites: Favourite[];
  recipes: Recipe[];
  settings: { key: string; value: unknown }[];
}

export async function exportBackup(): Promise<Backup> {
  const [entries, items, favourites, recipes, settings] = await Promise.all([
    db.entries.toArray(), db.items.toArray(), db.favourites.toArray(), db.recipes.toArray(), db.settings.toArray(),
  ]);
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries, items, favourites, recipes,
    settings: settings.filter((s) => !SECRET_KEYS.includes(s.key)),
  };
}

function isTemplate(i: unknown): i is ItemTemplate {
  if (!i || typeof i !== 'object') return false;
  const t = i as ItemTemplate;
  if (typeof t.name !== 'string' || typeof t.grams !== 'number' || !t.per100g || typeof t.per100g !== 'object') return false;
  return DB_NUTRIENTS.every((k) => {
    const v = t.per100g[k];
    return v && typeof v === 'object' && (v.value === null || typeof v.value === 'number');
  });
}

/** Throws a readable Error when the file is not a usable backup. */
export function validateBackup(data: unknown): Backup {
  const b = data as Backup;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP) throw new Error('This file is not a Picture Food Tracker backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  for (const k of ['entries', 'items', 'favourites', 'recipes', 'settings'] as const) {
    if (!Array.isArray(b[k])) throw new Error(`Backup is damaged: "${k}" is missing.`);
  }
  if (!b.entries.every((e) => typeof e.id === 'number' && typeof e.day === 'string' && typeof e.time === 'number')) {
    throw new Error('Backup is damaged: an entry is invalid.');
  }
  if (!b.items.every((i) => isTemplate(i) && typeof i.entryId === 'number' && typeof i.day === 'string')) {
    throw new Error('Backup is damaged: an item is invalid.');
  }
  if (!b.favourites.every((f) => typeof f.name === 'string' && Array.isArray(f.items) && f.items.every(isTemplate))) {
    throw new Error('Backup is damaged: a favourite is invalid.');
  }
  if (!b.recipes.every((r) => typeof r.name === 'string' && Array.isArray(r.ingredients) && r.ingredients.every(isTemplate))) {
    throw new Error('Backup is damaged: a recipe is invalid.');
  }
  return b;
}

/** Replaces all meals, favourites, recipes and targets. API keys on this device are kept. */
export async function restoreBackup(data: unknown): Promise<{ entries: number; items: number }> {
  const b = validateBackup(data);
  await db.transaction('rw', [db.entries, db.items, db.favourites, db.recipes, db.settings], async () => {
    await Promise.all([db.entries.clear(), db.items.clear(), db.favourites.clear(), db.recipes.clear()]);
    await db.entries.bulkPut(b.entries);
    await db.items.bulkPut(b.items.map(migrateTemplate));
    await db.favourites.bulkPut(b.favourites.map((f) => ({ ...f, items: f.items.map(migrateTemplate) })));
    await db.recipes.bulkPut(b.recipes.map((r) => ({ ...r, ingredients: r.ingredients.map(migrateTemplate) })));
    for (const s of b.settings) {
      if (SECRET_KEYS.includes(s.key) || typeof s.key !== 'string') continue;
      const value = s.key === 'targets' && s.value ? migrateTargets(s.value as Partial<Targets>) : s.value;
      await db.settings.put({ key: s.key, value });
    }
  });
  return { entries: b.entries.length, items: b.items.length };
}

export const BACKUP_REMINDER_DAYS = 30;

/** True when there is data and no backup has been made in the last 30 days. */
export function backupDue(lastBackupAt: number | null, oldestEntryTime: number | null, now = Date.now()): boolean {
  if (oldestEntryTime === null) return false;
  const since = lastBackupAt ?? oldestEntryTime;
  return now - since > BACKUP_REMINDER_DAYS * 86400000;
}
