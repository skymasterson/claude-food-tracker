import { db } from '../db/db';
import { emptyNutrients } from '../domain/nutrients';
import type { Nutrients } from '../domain/types';
import type { FoodMatch } from './usda';

export interface RelayConfig {
  fatsecretUrl: string;
  fatsecretToken: string;
}
export const relayConfigured = (c: RelayConfig) => Boolean(c.fatsecretUrl.trim() && c.fatsecretToken.trim());

export interface FsHit {
  foodId: string;
  name: string;
  brand?: string;
  /** FatSecret's one-line summary, e.g. "Per 1 burrito - Calories: 510kcal | ..." */
  summary: string;
}

export class FatSecretError extends Error {}

const CACHE_MS = 24 * 3600000; // FatSecret data is only held briefly on the device
const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function explain(code: number | undefined, message: string): string {
  if (code === 21) return 'FatSecret refused the relay\'s network address (IP restriction on your FatSecret key). In FatSecret under "Manage API Keys", remove the IP restriction or allow all addresses.';
  if (code === 5 || code === 6 || code === 7 || code === 8) return `FatSecret rejected the key or signature (${message}). Check FATSECRET_KEY and FATSECRET_SECRET on the relay.`;
  if (code === 12 || code === 13 || code === 14) return `FatSecret does not allow this request for your key (${message}).`;
  return `FatSecret error: ${message}`;
}

async function call(path: string, cfg: RelayConfig): Promise<Record<string, unknown>> {
  if (!relayConfigured(cfg)) throw new FatSecretError('Add the FatSecret relay address and passphrase in Settings.');
  const base = cfg.fatsecretUrl.trim().replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers: { 'x-relay-token': cfg.fatsecretToken.trim() } });
  } catch {
    throw new FatSecretError('Could not reach the FatSecret relay. Check the address in Settings and your connection.');
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new FatSecretError(`The FatSecret relay gave an unreadable answer (HTTP ${res.status}). Check the relay address.`);
  }
  if (typeof data.relay_error === 'string') throw new FatSecretError(res.status === 401 ? 'The relay passphrase in Settings does not match the relay\'s RELAY_TOKEN.' : `Relay: ${data.relay_error}`);
  const err = data.error as { code?: number; message?: string } | undefined;
  if (err) throw new FatSecretError(explain(Number(err.code), err.message ?? 'unknown error'));
  if (!res.ok) throw new FatSecretError(`FatSecret lookup failed (HTTP ${res.status}).`);
  return data;
}

export function parseHits(data: Record<string, unknown>): FsHit[] {
  const foods = (data.foods ?? {}) as { food?: unknown };
  return asArray(foods.food as Record<string, unknown> | Record<string, unknown>[]).flatMap((f) =>
    f && f.food_id !== undefined && typeof f.food_name === 'string'
      ? [{ foodId: String(f.food_id), name: f.food_name, brand: typeof f.brand_name === 'string' ? f.brand_name : undefined, summary: typeof f.food_description === 'string' ? f.food_description : '' }]
      : [],
  );
}

const GRAMS_PER: Record<string, number> = { g: 1, ml: 1, oz: 28.3495 };

/**
 * Turn a FatSecret food into per-100 g values. FatSecret has calories, protein, potassium and sodium
 * "where available" and never phosphorus, so phosphorus (and any missing field) stays unknown.
 */
export function parseFood(data: Record<string, unknown>): FoodMatch {
  const food = data.food as Record<string, unknown> | undefined;
  if (!food || typeof food.food_name !== 'string') throw new FatSecretError('FatSecret returned no details for this food.');
  const servings = asArray((food.servings as { serving?: unknown } | undefined)?.serving as Record<string, unknown> | Record<string, unknown>[]);
  const weight = (s: Record<string, unknown>) => {
    const amount = num(s.metric_serving_amount);
    const per = GRAMS_PER[String(s.metric_serving_unit ?? '').toLowerCase()];
    return amount && per ? amount * per : null;
  };
  // Prefer the serving FatSecret marks as default, as long as it has a weight to scale from.
  const s = servings.find((x) => String(x.is_default) === '1' && weight(x)) ?? servings.find((x) => weight(x)) ?? servings[0];
  const per100g: Nutrients = emptyNutrients();
  let defaultGrams = 100;
  let household: string | undefined;
  if (s) {
    const grams = weight(s);
    // Without a weight the values are kept per serving, against a nominal 100 g portion.
    const factor = grams ? 100 / grams : 1;
    const set = (key: 'kcal' | 'protein' | 'potassium' | 'sodium', raw: unknown) => {
      const v = num(raw);
      if (v !== null) per100g[key] = { value: v * factor, source: 'fatsecret' };
    };
    set('kcal', s.calories);
    set('protein', s.protein);
    set('potassium', s.potassium);
    set('sodium', s.sodium);
    defaultGrams = grams ? Math.round(grams) : 100;
    household = typeof s.serving_description === 'string' ? s.serving_description : undefined;
    if (!grams) household = `1 serving${household ? ` (${household})` : ''}, weight unknown`;
  }
  const brand = typeof food.brand_name === 'string' ? food.brand_name : '';
  return {
    fatsecretId: String(food.food_id),
    description: brand ? `${brand} ${food.food_name}` : food.food_name,
    dataType: 'FatSecret',
    per100g,
    completeness: (['kcal', 'protein', 'potassium', 'sodium'] as const).filter((k) => per100g[k].value !== null).length,
    defaultGrams,
    household,
  };
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await db.usdaCache.get(key);
  if (hit && (Date.now() - hit.fetchedAt < CACHE_MS || !navigator.onLine)) return hit.payload as T;
  const payload = await load();
  await db.usdaCache.put({ key, fetchedAt: Date.now(), payload });
  return payload;
}

export function searchFatSecret(query: string, cfg: RelayConfig): Promise<FsHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  return cached(`fs:q:${q}`, async () => parseHits(await call(`/search?q=${encodeURIComponent(q)}`, cfg)));
}

export function getFatSecretFood(foodId: string, cfg: RelayConfig): Promise<FoodMatch> {
  return cached(`fs:f:${foodId}`, async () => parseFood(await call(`/food?id=${encodeURIComponent(foodId)}`, cfg)));
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The first hit whose brand is the one asked for, or null. Used for chain-restaurant and packaged foods. */
export async function findBranded(brand: string, name: string, cfg: RelayConfig): Promise<FoodMatch | null> {
  const want = squash(brand);
  if (want.length < 2) return null;
  const hits = await searchFatSecret(`${brand} ${name}`, cfg);
  const hit = hits.find((h) => h.brand && (squash(h.brand).includes(want) || want.includes(squash(h.brand))) && nameMatches(h, name));
  return hit ? getFatSecretFood(hit.foodId, cfg) : null;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** True when most of the words asked for appear in the hit's name: guards against taking an unrelated first result. */
export function nameMatches(hit: FsHit, wanted: string): boolean {
  const want = words(wanted);
  if (want.length === 0) return false;
  const have = new Set(words(`${hit.brand ?? ''} ${hit.name}`));
  const found = want.filter((w) => have.has(w) || have.has(`${w}s`) || (w.endsWith('s') && have.has(w.slice(0, -1)))).length;
  return found / want.length >= 0.6;
}

/** The first hit that is recognisably the named food, or null. Used when USDA has nothing. */
export async function findByName(name: string, cfg: RelayConfig): Promise<FoodMatch | null> {
  const hit = (await searchFatSecret(name, cfg)).find((h) => nameMatches(h, name));
  return hit ? getFatSecretFood(hit.foodId, cfg) : null;
}

/** For the Settings "Test" button: one real search through the relay. */
export async function testRelay(cfg: RelayConfig): Promise<string> {
  const hits = parseHits(await call('/search?q=apple', cfg));
  return `Working: FatSecret returned ${hits.length} result${hits.length === 1 ? '' : 's'} for “apple”.`;
}
