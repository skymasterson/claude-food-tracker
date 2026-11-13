export const NUTRIENTS = ['kcal', 'protein', 'animalProtein', 'potassium', 'sodium', 'phosphorus'] as const;
export type NutrientKey = (typeof NUTRIENTS)[number];
/** Nutrients a food database reports directly. Animal protein is derived: total protein x animal share. */
export const DB_NUTRIENTS = ['kcal', 'protein', 'potassium', 'sodium', 'phosphorus'] as const satisfies readonly NutrientKey[];

export const NUTRIENT_META: Record<NutrientKey, { label: string; short: string; unit: string }> = {
  kcal: { label: 'Calories', short: 'Cal', unit: 'kcal' },
  protein: { label: 'Total protein', short: 'Prot', unit: 'g' },
  animalProtein: { label: 'Animal protein', short: 'Anim', unit: 'g' },
  potassium: { label: 'Potassium', short: 'K', unit: 'mg' },
  sodium: { label: 'Sodium', short: 'Na', unit: 'mg' },
  phosphorus: { label: 'Phosphorus', short: 'Phos', unit: 'mg' },
};

/**
 * usda: a specific food in USDA's Foundation / SR Legacy data.
 * usda-survey: USDA's survey database (FNDDS) — a national-average recipe for a dish as typically eaten.
 * fatsecret: FatSecret's database of branded, packaged and chain-restaurant foods (no phosphorus).
 */
export type Source = 'usda' | 'usda-survey' | 'fatsecret' | 'ai-estimate' | 'user-entered';

/** value === null means UNKNOWN. It is never treated as zero. */
export interface NutrientValue {
  value: number | null;
  source: Source | null;
}
export type Nutrients = Record<NutrientKey, NutrientValue>;

export type Confidence = 'high' | 'medium' | 'low';

/** A food and an amount, with nutrient values per 100 g. Totals are always computed. */
export interface ItemTemplate {
  name: string;
  grams: number;
  household?: string;
  per100g: Nutrients;
  fdcId?: number;
  fatsecretId?: string;
  /** Description of the matched database food (USDA or FatSecret). */
  usdaDescription?: string;
  confidence?: Confidence;
  /** The AI's estimate (0..1) of how much of this food's protein is animal protein; kept so it survives a food swap. */
  aiAnimalShare?: number;
}

export interface Item extends ItemTemplate {
  id?: number;
  entryId: number;
  day: string;
  loggedAt: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export type Origin = 'photo' | 'text' | 'manual' | 'favourite' | 'recipe';

export interface Entry {
  id?: number;
  day: string; // local YYYY-MM-DD
  time: number; // epoch ms
  mealType: MealType;
  title: string;
  note?: string;
  isRestaurant: boolean;
  thumbnail?: string; // small JPEG data URL
  origin: Origin;
}

export interface Favourite {
  id?: number;
  name: string;
  items: ItemTemplate[];
  isRestaurant: boolean;
  createdAt: number;
}

export interface Recipe {
  id?: number;
  name: string;
  servings: number;
  ingredients: ItemTemplate[];
  createdAt: number;
}

export type TargetType = 'none' | 'maximum' | 'minimum' | 'range';
export interface Target {
  type: TargetType;
  /** maximum: the limit. minimum: the floor. range: the low end. */
  value: number;
  /** range only: the high end. */
  max?: number;
}
export type Targets = Record<NutrientKey, Target>;

export const DEFAULT_TARGETS: Targets = {
  kcal: { type: 'none', value: 0 },
  protein: { type: 'none', value: 0 },
  animalProtein: { type: 'maximum', value: 65 },
  potassium: { type: 'maximum', value: 1800 },
  sodium: { type: 'maximum', value: 2000 },
  phosphorus: { type: 'maximum', value: 1000 },
};

export interface Draft {
  id?: number;
  createdAt: number;
  image: Blob;
  note: string;
  isRestaurant: boolean;
}
