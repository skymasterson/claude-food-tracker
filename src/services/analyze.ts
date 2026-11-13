import { animalProteinValue } from '../domain/animal';
import { mergeNutrients } from '../domain/nutrients';
import type { ItemTemplate } from '../domain/types';
import type { Settings } from '../db/repo';
import { AiError, type AiItem, type AnalyzeInput, type VisionProvider } from './ai/provider';
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
  let lookupFailed = '';
  const items = await Promise.all(
    aiItems.map(async (ai) => {
      let match: FoodMatch | null = null;
      if (settings.usdaKey) {
        try {
          match = (await searchFoods(ai.usdaSearchTerm, settings.usdaKey))[0] ?? null;
        } catch (e) {
          lookupFailed = e instanceof Error ? e.message : 'USDA lookup failed.';
        }
      }
      return buildItem(ai, match);
    }),
  );
  if (lookupFailed) warnings.push(`${lookupFailed} Unmatched items show AI estimates instead.`);
  return { items, warnings };
}
