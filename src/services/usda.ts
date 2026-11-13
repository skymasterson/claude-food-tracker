import { db } from '../db/db';
import { animalProteinValue, animalShareFromUsda } from '../domain/animal';
import { emptyNutrients } from '../domain/nutrients';
import { DB_NUTRIENTS, type Nutrients, type Source } from '../domain/types';

export interface FoodMatch {
  fdcId?: number;
  fatsecretId?: string;
  /** Typical serving weight and wording, when the database gives one. */
  defaultGrams?: number;
  household?: string;
  description: string;
  dataType: string;
  per100g: Nutrients;
  /** How many of the database nutrients this food has. */
  completeness: number;
}

const API = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const CACHE_MS = 180 * 86400000;

// FoodData Central nutrient ids. Energy: 1008 (kcal); Foundation foods may only carry
// Atwater energy (2047 general, 2048 specific).
const NUTRIENT_IDS: Record<(typeof DB_NUTRIENTS)[number], number[]> = {
  kcal: [1008, 2047, 2048],
  protein: [1003],
  potassium: [1092],
  sodium: [1093],
  phosphorus: [1091],
};

interface ApiNutrient {
  nutrientId?: number;
  unitName?: string;
  value?: number;
}
interface ApiFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: string;
  foodNutrients?: ApiNutrient[];
}

export function extractNutrients(foodNutrients: ApiNutrient[] | undefined, source: Source = 'usda'): Nutrients {
  const out = emptyNutrients();
  for (const key of DB_NUTRIENTS) {
    for (const id of NUTRIENT_IDS[key]) {
      const n = foodNutrients?.find((x) => x.nutrientId === id && typeof x.value === 'number');
      if (!n) continue;
      if (key === 'kcal' && n.unitName && n.unitName.toUpperCase() !== 'KCAL') continue;
      out[key] = { value: n.value as number, source };
      break;
    }
  }
  return out;
}

export const isSurvey = (dataType: string) => dataType.startsWith('Survey');

export function toMatch(f: ApiFood): FoodMatch {
  const per100g = extractNutrients(f.foodNutrients, isSurvey(f.dataType) ? 'usda-survey' : 'usda');
  // Single-ingredient foods are classified animal / plant from USDA's food category; mixed foods stay unknown.
  per100g.animalProtein = animalProteinValue(per100g.protein, animalShareFromUsda(f.foodCategory, f.description), 'usda');
  return {
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    per100g,
    completeness: DB_NUTRIENTS.filter((k) => per100g[k].value !== null).length,
  };
}

/**
 * Keep USDA's relevance order across all three data sets, so a whole-dish entry from the survey data can beat a
 * loosely related single food. Foods with missing minerals, "as ingredient" recipe components, and foods whose
 * leading name differs from what was asked are pushed down.
 */
export function rankMatches(matches: FoodMatch[], query = ''): FoodMatch[] {
  const asked = new Set(query.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  // A food whose leading name has words nobody asked for ("Broccoli raab" for "broccoli") is a different food.
  const strayWords = (m: FoodMatch) =>
    asked.size === 0 ? 0 : Math.min(2, m.description.split(',')[0].toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !asked.has(w)).length);
  const score = (m: FoodMatch, i: number) =>
    i + (DB_NUTRIENTS.length - m.completeness) * 3 + (/as ingredient/i.test(m.description) ? 3 : 0) + strayWords(m) * 3;
  return matches
    .map((m, i) => ({ m, s: score(m, i) }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.m);
}

export class UsdaError extends Error {}

async function fetchSearch(query: string, dataType: string[], apiKey: string): Promise<ApiFood[]> {
  // POST with a JSON body: the GET form intermittently returns HTTP 400 when the survey data set is included.
  const url = `${API}?api_key=${encodeURIComponent(apiKey)}`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, dataType, pageSize: 15 }),
  };
  let res: Response | null = null;
  // The USDA service occasionally answers a valid search with HTTP 400 or 5xx; a repeat normally succeeds.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      res = await fetch(url, init);
    } catch {
      res = null;
      continue;
    }
    if (res.status !== 400 && res.status < 500) break;
  }
  if (!res) throw new UsdaError('Could not reach the USDA database. Check your connection.');
  if (res.status === 403 || res.status === 401) throw new UsdaError('The USDA API key was rejected. Check it in Settings.');
  if (res.status === 429) throw new UsdaError('USDA rate limit reached. Try again in a little while.');
  if (!res.ok) throw new UsdaError(`USDA lookup failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { foods?: ApiFood[] };
  return data.foods ?? [];
}

/** Search USDA FoodData Central. Results are cached on the device and served from cache offline. */
export async function searchFoods(query: string, apiKey: string): Promise<FoodMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const key = `q3:${q}`;
  const cached = await db.usdaCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt < CACHE_MS || !navigator.onLine)) return cached.payload as FoodMatch[];
  if (!apiKey) {
    if (cached) return cached.payload as FoodMatch[];
    throw new UsdaError('Add your USDA API key in Settings to search the food database.');
  }
  try {
    // One search across specific foods (Foundation, SR Legacy) and typical dishes as eaten (Survey / FNDDS).
    const foods = await fetchSearch(q, ['Foundation', 'SR Legacy', 'Survey (FNDDS)'], apiKey);
    const matches = rankMatches(foods.map(toMatch), q);
    await db.usdaCache.put({ key, fetchedAt: Date.now(), payload: matches });
    return matches;
  } catch (e) {
    if (cached) return cached.payload as FoodMatch[];
    throw e;
  }
}
