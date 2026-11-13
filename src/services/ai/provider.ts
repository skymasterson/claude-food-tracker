import { DB_NUTRIENTS, type Confidence } from '../../domain/types';

type DbNutrient = (typeof DB_NUTRIENTS)[number];

export interface AiItem {
  name: string;
  usdaSearchTerm: string;
  grams: number;
  household: string;
  confidence: Confidence;
  /** The model's own estimate per 100 g; null where it cannot estimate. Only used as a labelled fallback. */
  per100g: Record<DbNutrient, number | null>;
  /** Estimated share (0..1) of this food's protein that is animal protein; null if it cannot be judged. */
  animalProteinShare: number | null;
}

export interface AnalyzeInput {
  /** Base64 JPEG without the data: prefix. Omit for "describe it instead". */
  imageBase64?: string;
  note: string;
}

export interface VisionProvider {
  analyze(input: AnalyzeInput): Promise<AiItem[]>;
}

export class AiError extends Error {}

/** Defensive clean-up of model output: anything implausible becomes unknown rather than a number. */
export function sanitizeAiItems(raw: unknown): AiItem[] {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new AiError('The AI reply was not in the expected format. Try again.');
  const out: AiItem[] = [];
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) continue;
    const grams = typeof r.grams === 'number' && Number.isFinite(r.grams) && r.grams > 0 ? Math.round(r.grams) : 100;
    const p = (r.per100g ?? {}) as Record<string, unknown>;
    const per100g = {} as Record<DbNutrient, number | null>;
    for (const k of DB_NUTRIENTS) {
      const v = p[k];
      per100g[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    }
    const c = r.confidence;
    out.push({
      name: r.name.trim(),
      usdaSearchTerm: typeof r.usdaSearchTerm === 'string' && r.usdaSearchTerm.trim() ? r.usdaSearchTerm.trim() : r.name.trim(),
      grams,
      household: typeof r.household === 'string' ? r.household.trim() : '',
      confidence: c === 'high' || c === 'medium' || c === 'low' ? c : 'low',
      per100g,
      animalProteinShare: typeof r.animalProteinShare === 'number' && r.animalProteinShare >= 0 && r.animalProteinShare <= 1 ? r.animalProteinShare : null,
    });
  }
  return out;
}
