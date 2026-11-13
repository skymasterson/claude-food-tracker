import { animalProteinValue } from '../domain/animal';
import { mergeNutrients } from '../domain/nutrients';
import type { ItemTemplate } from '../domain/types';
import type { Settings } from '../db/repo';
import { AiError, type AiItem, type AnalyzeInput, type VisionProvider } from './ai/provider';
import { findBranded, findByName, relayConfigured } from './fatsecret';
import { searchFoods, type FoodMatch } from './usda';

export interface AnalysisResult {
  items: ItemTemplate[];
  warnings: string[];
}

export function buildItem(ai: AiItem, match: FoodMatch | null): ItemTemplate {
  const per100g = mergeNutrients(match?.per100g ?? null, ai.per100g);
  // Animal protein: USDA's classification when the match is a clear animal or plant food;
  // otherwise the AI's estimated share, labelled as an estimate; otherwise unknown.
  const fromUsda = match?.per100g.animalProtein;
  per100g.animalProtein = fromUsda && fromUsda.value !== null ? fromUsda : animalProteinValue(per100g.protein, ai.animalProteinShare, 'ai-estimate');
  return {
    name: ai.name,
    grams: ai.grams,
    household: ai.household || undefined,
    confidence: ai.confidence,
    aiAnimalShare: ai.animalProteinShare ?? undefined,
    per100g,
    fdcId: match?.fdcId,
    fatsecretId: match?.fatsecretId,
    usdaDescription: match?.description,
  };
}

export async function providerFor(settings: Settings): Promise<VisionProvider> {
  if (!settings.anthropicKey) throw new AiError('Add your Anthropic API key in Settings to analyse meals.');
  const { AnthropicProvider } = await import('./ai/anthropic'); // SDK loaded only when analysing
  return new AnthropicProvider(settings.anthropicKey, settings.aiModel);
}

/** Photo or description -> AI item list -> USDA match per item -> draft items for review. */
export async function analyzeMeal(
  input: AnalyzeInput,
  settings: Settings,
  injected?: VisionProvider,
): Promise<AnalysisResult> {
  const provider = injected ?? (await providerFor(settings));
  const aiItems = await provider.analyze(input);
  const warnings: string[] = [];
  if (aiItems.length === 0) warnings.push('No food was recognised. Add items by typing below.');
  if (!settings.usdaKey && aiItems.length > 0) {
    warnings.push('No USDA API key is set, so every value below is an AI estimate. Add the key in Settings for database values.');
  }
  const failures = new Set<string>();
  const note = (e: unknown, fallback: string) => failures.add(e instanceof Error ? e.message : fallback);
  const useFatSecret = relayConfigured(settings);
  const items = await Promise.all(
    aiItems.map(async (ai) => {
      let match: FoodMatch | null = null;
      // 1. A named chain or brand: that company's own published figures from FatSecret.
      if (ai.brand && useFatSecret) {
        try {
          match = await findBranded(ai.brand, ai.name, settings);
        } catch (e) {
          note(e, 'FatSecret lookup failed.');
        }
      }
      // 2. USDA: specific foods and typical dishes.
      if (!match && settings.usdaKey) {
        try {
          match = (await searchFoods(ai.usdaSearchTerm, settings.usdaKey))[0] ?? null;
        } catch (e) {
          note(e, 'USDA lookup failed.');
        }
      }
      // 3. Nothing in USDA: a FatSecret food that is recognisably the same thing.
      if (!match && useFatSecret) {
        try {
          match = await findByName(ai.name, settings);
        } catch (e) {
          note(e, 'FatSecret lookup failed.');
        }
      }
      return buildItem(ai, match);
    }),
  );
  for (const f of failures) warnings.push(`${f} Unmatched items show AI estimates instead.`);
  return { items, warnings };
}
