import { db } from '../db/db';
import { emptyNutrients } from '../domain/nutrients';
import { NUTRIENTS, type NutrientKey, type Nutrients } from '../domain/types';

export interface FoodMatch {
  fdcId: number;
  description: string;
  dataType: string;
  per100g: Nutrients;
  /** How many of the five tracked nutrients this food has. */
  completeness: number;
}

const API = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const CACHE_MS = 180 * 86400000;

// FoodData Central nutrient ids. Energy: 1008 (kcal); Foundation foods may only carry
// Atwater energy (2047 general, 2048 specific).
const NUTRIENT_IDS: Record<NutrientKey, number[]> = {
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
  foodNutrients?: ApiNutrient[];
}

export function extractNutrients(foodNutrients: ApiNutrient[] | undefined): Nutrients {
  const out = emptyNutrients();
  for (const key of NUTRIENTS) {
    for (const id of NUTRIENT_IDS[key]) {
      const n = foodNutrients?.find((x) => x.nutrientId === id && typeof x.value === 'number');
      if (!n) continue;
      if (key === 'kcal' && n.unitName && n.unitName.toUpperCase() !== 'KCAL') continue;
      out[key] = { value: n.value as number, source: 'usda' };
      break;
    }
  }
  return out;
}

export function toMatch(f: ApiFood): FoodMatch {
  const per100g = extractNutrients(f.foodNutrients);
  return {
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    per100g,
    completeness: NUTRIENTS.filter((k) => per100g[k].value !== null).length,
  };
}

/**
 * Keep the API's relevance order, but push down foods with missing minerals and
 * survey (FNDDS) entries, so Foundation / SR Legacy foods with full data come first.
 */
export function rankMatches(matches: FoodMatch[]): FoodMatch[] {
  const score = (m: FoodMatch, i: number) =>
    i + (NUTRIENTS.length - m.completeness) * 3 + (m.dataType === 'Foundation' || m.dataType === 'SR Legacy' ? 0 : 2);
  return matches
    .map((m, i) => ({ m, s: score(m, i) }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.m);
}

export class UsdaError extends Error {}

async function fetchSearch(query: string, dataTypes: string, apiKey: string): Promise<ApiFood[]> {
  const url = `${API}?query=${encodeURIComponent(query)}&dataType=${encodeURIComponent(dataTypes)}&pageSize=12&api_key=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new UsdaError('Could not reach the USDA database. Check your connection.');
  }
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
  const key = `q:${q}`;
  const cached = await db.usdaCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt < CACHE_MS || !navigator.onLine)) return cached.payload as FoodMatch[];
  if (!apiKey) {
    if (cached) return cached.payload as FoodMatch[];
    throw new UsdaError('Add your USDA API key in Settings to search the food database.');
  }
  try {
    let foods = await fetchSearch(q, 'Foundation,SR Legacy', apiKey);
    if (foods.length === 0) foods = await fetchSearch(q, 'Foundation,SR Legacy,Survey (FNDDS)', apiKey);
    const matches = rankMatches(foods.map(toMatch));
    await db.usdaCache.put({ key, fetchedAt: Date.now(), payload: matches });
    return matches;
  } catch (e) {
    if (cached) return cached.payload as FoodMatch[];
    throw e;
  }
}
