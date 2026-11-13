import { db } from './db';
import { toTemplate } from '../domain/nutrients';
import { DEFAULT_TARGETS, type Entry, type Favourite, type Item, type ItemTemplate, type Recipe, type Targets } from '../domain/types';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export interface Settings {
  targets: Targets;
  anthropicKey: string;
  usdaKey: string;
  /** Address of the user's own FatSecret relay (Cloudflare Worker) and the passphrase it expects. */
  fatsecretUrl: string;
  fatsecretToken: string;
  aiModel: string;
  lastBackupAt: number | null;
  seenNotice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  targets: DEFAULT_TARGETS,
  anthropicKey: '',
  usdaKey: '',
  fatsecretUrl: '',
  fatsecretToken: '',
  aiModel: DEFAULT_MODEL,
  lastBackupAt: null,
  seenNotice: false,
};

export async function loadSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out && r.value !== undefined && r.value !== null) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  out.targets = { ...DEFAULT_TARGETS, ...out.targets };
  return out;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
}

/** Create or replace an entry together with its items. Returns the entry id. */
export async function saveEntry(entry: Entry, items: ItemTemplate[]): Promise<number> {
  return db.transaction('rw', db.entries, db.items, async () => {
    const id = await db.entries.put(entry);
    await db.items.where('entryId').equals(id).delete();
    await db.items.bulkAdd(
      items.map((i, idx): Item => ({ ...toTemplate(i), entryId: id, day: entry.day, loggedAt: entry.time + idx })),
    );
    return id;
  });
}

export async function deleteEntry(id: number): Promise<void> {
  await db.transaction('rw', db.entries, db.items, async () => {
    await db.items.where('entryId').equals(id).delete();
    await db.entries.delete(id);
  });
}

export async function getEntry(id: number): Promise<{ entry: Entry; items: Item[] } | null> {
  const entry = await db.entries.get(id);
  if (!entry) return null;
  const items = await db.items.where('entryId').equals(id).sortBy('loggedAt');
  return { entry, items };
}

export async function getDay(day: string): Promise<{ entries: Entry[]; items: Item[] }> {
  const [entries, items] = await Promise.all([
    db.entries.where('day').equals(day).sortBy('time'),
    db.items.where('day').equals(day).toArray(),
  ]);
  return { entries, items };
}

export async function getRange(from: string, to: string): Promise<{ entries: Entry[]; items: Item[] }> {
  const [entries, items] = await Promise.all([
    db.entries.where('day').between(from, to, true, true).sortBy('time'),
    db.items.where('day').between(from, to, true, true).toArray(),
  ]);
  return { entries, items };
}

/** Most recently logged distinct foods, newest first. */
export async function recentItems(limit = 12): Promise<ItemTemplate[]> {
  const seen = new Set<string>();
  const out: ItemTemplate[] = [];
  await db.items
    .orderBy('loggedAt')
    .reverse()
    .until(() => out.length >= limit)
    .each((i) => {
      const k = i.name.trim().toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(toTemplate(i));
      }
    });
  return out;
}

export async function saveFavourite(f: Favourite): Promise<number> {
  return db.favourites.put({ ...f, items: f.items.map(toTemplate) });
}
export async function saveRecipe(r: Recipe): Promise<number> {
  return db.recipes.put({ ...r, ingredients: r.ingredients.map(toTemplate) });
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', [db.entries, db.items, db.favourites, db.recipes, db.settings, db.usdaCache, db.drafts], async () => {
    await Promise.all([
      db.entries.clear(), db.items.clear(), db.favourites.clear(), db.recipes.clear(),
      db.settings.clear(), db.usdaCache.clear(), db.drafts.clear(),
    ]);
  });
}
