import { DEFAULT_TARGETS, type ItemTemplate, type NutrientValue, type Source, type Targets } from './types';

// USDA FoodData Central food categories (SR Legacy / Foundation).
const ANIMAL_CATEGORIES = new Set([
  'dairy and egg products', 'poultry products', 'sausages and luncheon meats', 'pork products',
  'beef products', 'finfish and shellfish products', 'lamb, veal, and game products',
]);
const PLANT_CATEGORIES = new Set([
  'spices and herbs', 'breakfast cereals', 'fruits and fruit juices', 'vegetables and vegetable products',
  'nut and seed products', 'legumes and legume products', 'cereal grains and pasta',
]);
// USDA survey (FNDDS) food categories that are clearly one or the other. Anything not listed stays unknown.
for (const c of [
  'milk, whole', 'milk, reduced fat', 'milk, lowfat', 'milk, nonfat', 'cheese', 'cottage/ricotta cheese', 'yogurt, regular',
  'yogurt, greek', 'beef, excludes ground', 'ground beef', 'pork', 'lamb, goat, game', 'liver and organ meats',
  'chicken, whole pieces', 'turkey, duck, other poultry', 'fish', 'shellfish', 'eggs and omelets', 'cold cuts and cured meats',
  'bacon', 'frankfurters', 'sausages',
]) ANIMAL_CATEGORIES.add(c);
for (const c of [
  'rice', 'beans, peas, legumes', 'nuts and seeds', 'processed soy products', 'apples', 'bananas', 'grapes', 'peaches and nectarines',
  'strawberries', 'blueberries and other berries', 'citrus fruits', 'melons', 'dried fruits', 'pears', 'pineapple', 'mango and papaya',
  'tomatoes', 'carrots', 'other red and orange vegetables', 'dark green vegetables, excludes lettuce', 'broccoli', 'spinach',
  'string beans', 'cabbage', 'onions', 'corn', 'other starchy vegetables', 'white potatoes, baked or boiled',
  'french fries and other fried white potatoes', 'oatmeal',
]) PLANT_CATEGORIES.add(c);
// Used only when no category is available (older entries): the leading word of a USDA description.
const ANIMAL_WORDS = new Set([
  'chicken', 'beef', 'pork', 'turkey', 'lamb', 'veal', 'duck', 'ham', 'bacon', 'fish', 'salmon', 'tuna', 'cod', 'tilapia',
  'trout', 'shrimp', 'crab', 'lobster', 'egg', 'eggs', 'milk', 'cheese', 'yogurt', 'crustaceans', 'mollusks', 'game meat',
]);
const PLANT_WORDS = new Set([
  'rice', 'broccoli', 'beans', 'lentils', 'potatoes', 'potato', 'oats', 'apples', 'bananas', 'carrots', 'spinach', 'tomatoes',
  'tofu', 'nuts', 'peanuts', 'almonds', 'corn', 'peas', 'onions', 'lettuce', 'cabbage', 'quinoa', 'chickpeas', 'wheat',
  'barley', 'oil', 'sugars', 'seeds', 'squash', 'peppers', 'mushrooms', 'cucumber', 'oranges', 'grapes', 'strawberries',
]);

/**
 * Share of a food's protein that is animal protein, judged from USDA's own classification:
 * 1 (all), 0 (none), or null when the food is mixed or cannot be classified.
 */
export function animalShareFromUsda(category: string | undefined, description: string | undefined): 0 | 1 | null {
  const cat = category?.trim().toLowerCase();
  if (cat) {
    if (ANIMAL_CATEGORIES.has(cat)) return 1;
    if (PLANT_CATEGORIES.has(cat)) return 0;
    return null; // soups, baked goods, fast food, restaurant dishes, ... are mixed
  }
  const d = description?.trim().toLowerCase();
  if (!d || / with | and |substitute|imitation/.test(d)) return null;
  const first = d.split(',')[0].trim();
  if (ANIMAL_WORDS.has(first)) return 1;
  if (PLANT_WORDS.has(first)) return 0;
  return null;
}

/**
 * Animal protein per 100 g = total protein x animal share.
 * Unknown protein or unknown share gives unknown, never zero.
 * The result is only labelled a database value (keeping the protein's own source) when both the protein and the
 * classification came from USDA.
 */
export function animalProteinValue(protein: NutrientValue | undefined, share: number | null, shareSource: Source): NutrientValue {
  if (!protein || protein.value === null || protein.source === null) return { value: null, source: null };
  if (protein.value === 0) return { value: 0, source: protein.source };
  if (share === null || !Number.isFinite(share)) return { value: null, source: null };
  const s = Math.max(0, Math.min(1, share));
  const fromDatabase = protein.source === 'usda' || protein.source === 'usda-survey';
  const source: Source = shareSource === 'user-entered' ? 'user-entered' : shareSource === 'usda' && fromDatabase ? protein.source : 'ai-estimate';
  return { value: protein.value * s, source };
}

/** Bring an item saved before animal protein existed up to date. Safe to run more than once. */
export function migrateTemplate<T extends ItemTemplate>(item: T): T {
  if (item.per100g && !item.per100g.animalProtein) {
    const share = item.fdcId !== undefined ? animalShareFromUsda(undefined, item.usdaDescription) : null;
    item.per100g.animalProtein = animalProteinValue(item.per100g.protein, share, 'usda');
  }
  return item;
}

/** Targets saved before animal protein existed: the protein limit moves to animal protein; total protein stays tracked. */
export function migrateTargets(stored: Partial<Targets>): Targets {
  const t = { ...DEFAULT_TARGETS, ...stored } as Targets;
  if (!stored.animalProtein) {
    t.animalProtein = stored.protein ?? DEFAULT_TARGETS.animalProtein;
    t.protein = { type: 'none', value: 0 };
  }
  return t;
}
