import { NUTRIENTS, type ItemTemplate, type NutrientKey, type Nutrients, type NutrientValue, type Source } from './types';

export const UNKNOWN: NutrientValue = { value: null, source: null };

export function emptyNutrients(): Nutrients {
  return { kcal: UNKNOWN, protein: UNKNOWN, animalProtein: UNKNOWN, potassium: UNKNOWN, sodium: UNKNOWN, phosphorus: UNKNOWN };
}

export function isKnown(v: NutrientValue | undefined): v is { value: number; source: Source } {
  return !!v && typeof v.value === 'number' && Number.isFinite(v.value);
}

/** Amount of one nutrient in an item's portion, or null when unknown. */
export function itemAmount(item: Pick<ItemTemplate, 'grams' | 'per100g'>, key: NutrientKey): number | null {
  const v = item.per100g[key];
  if (!isKnown(v) || !Number.isFinite(item.grams)) return null;
  return (v.value * item.grams) / 100;
}

export interface Total {
  /** Sum of the known values only. */
  total: number;
  knownCount: number;
  unknownCount: number;
  /** True when at least one item had no value: `total` is a lower bound. */
  hasUnknown: boolean;
  /** True when at least one counted value is an AI estimate. */
  hasEstimate: boolean;
}

export function sumNutrient(items: Pick<ItemTemplate, 'grams' | 'per100g'>[], key: NutrientKey): Total {
  let total = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let hasEstimate = false;
  for (const item of items) {
    const amount = itemAmount(item, key);
    if (amount === null) {
      unknownCount++; // excluded from the sum, never counted as 0
    } else {
      total += amount;
      knownCount++;
      if (item.per100g[key].source === 'ai-estimate') hasEstimate = true;
    }
  }
  return { total, knownCount, unknownCount, hasUnknown: unknownCount > 0, hasEstimate };
}

export type Totals = Record<NutrientKey, Total>;

export function sumAll(items: Pick<ItemTemplate, 'grams' | 'per100g'>[]): Totals {
  const out = {} as Totals;
  for (const key of NUTRIENTS) out[key] = sumNutrient(items, key);
  return out;
}

export function scaleItems<T extends ItemTemplate>(items: T[], factor: number): T[] {
  return items.map((i) => ({ ...i, grams: round1(i.grams * factor) }));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Convert an amount entered for a whole portion into a per-100 g value.
 * A blank / invalid amount stays unknown.
 */
export function per100FromPortion(amount: number | null, grams: number, source: Source): NutrientValue {
  if (amount === null || !Number.isFinite(amount) || amount < 0 || !(grams > 0)) return UNKNOWN;
  return { value: (amount / grams) * 100, source };
}

/** Database value wins; the AI estimate is only a labelled fallback; otherwise unknown. */
export function mergeNutrients(usda: Nutrients | null, ai: Partial<Record<NutrientKey, number | null>> | null): Nutrients {
  const out = emptyNutrients();
  for (const key of NUTRIENTS) {
    const u = usda?.[key];
    const a = ai?.[key];
    if (isKnown(u)) out[key] = { value: u.value, source: u.source };
    else if (typeof a === 'number' && Number.isFinite(a) && a >= 0) out[key] = { value: a, source: 'ai-estimate' };
  }
  return out;
}

export function toTemplate(i: ItemTemplate): ItemTemplate {
  const { name, grams, household, per100g, fdcId, usdaDescription, confidence, aiAnimalShare } = i;
  return { name, grams, household, per100g, fdcId, usdaDescription, confidence, aiAnimalShare };
}
