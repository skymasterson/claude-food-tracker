// The only module that knows about the AI provider. Swap it by implementing VisionProvider elsewhere.
import Anthropic from '@anthropic-ai/sdk';
import { FALLBACK_MODELS } from './models';
import { AiError, sanitizeAiItems, type AiItem, type AnalyzeInput, type VisionProvider } from './provider';


const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short plain name of the food as eaten, e.g. "Steamed white rice"' },
          usdaSearchTerm: {
            type: 'string',
            description: 'Search phrase in USDA FoodData Central style, generic and cooked-state specific, e.g. "rice white long-grain cooked"',
          },
          grams: { type: 'number', description: 'Estimated weight actually eaten, in grams' },
          household: { type: 'string', description: 'Household description of that amount, e.g. "1 cup", "1 fillet"' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          animalProteinShare: {
            ...nullableNumber,
            description: 'Fraction from 0 to 1 of this item\'s protein that comes from animal sources (meat, poultry, fish, seafood, eggs, dairy). 1 for plain meat or egg, 0 for plant foods, an estimate for mixed dishes, null if you cannot judge.',
          },
          per100g: {
            type: 'object',
            description: 'Your own estimate per 100 g of the food as eaten. Use null for any value you cannot estimate reasonably.',
            properties: {
              kcal: nullableNumber,
              protein: { ...nullableNumber, description: 'grams' },
              potassium: { ...nullableNumber, description: 'milligrams' },
              sodium: { ...nullableNumber, description: 'milligrams' },
              phosphorus: { ...nullableNumber, description: 'milligrams' },
            },
            required: ['kcal', 'protein', 'potassium', 'sodium', 'phosphorus'],
            additionalProperties: false,
          },
        },
        required: ['name', 'usdaSearchTerm', 'grams', 'household', 'confidence', 'animalProteinShare', 'per100g'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM = `You identify the foods in a meal for a nutrition log used by someone managing a chronic health condition who must limit protein, potassium, sodium and phosphorus. Accuracy and honesty matter more than completeness.

Break the meal into its distinct components (for example: rice, grilled chicken, stir-fried vegetables, sauce), including cooking oil, sauces, dressings and drinks when they are visible or clearly implied. For a mixed dish that cannot be separated sensibly, return it as one item.

For each item:
- name: what it is, as eaten.
- usdaSearchTerm: a generic phrase that will find the closest entry in USDA FoodData Central (Foundation or SR Legacy). Name the food first, then form and cooking state, e.g. "chicken breast roasted meat only", "noodles rice cooked", "broccoli cooked boiled". Do not use brand or restaurant names.
- grams: your best estimate of the weight actually eaten. Use plate, cutlery and typical serving sizes for scale. If the user's note says how much was eaten ("ate about half"), apply it.
- household: the same amount in everyday terms.
- confidence: how sure you are of both the identification and the portion. Use "low" freely.
- animalProteinShare: the person's protein limit applies to animal protein only, so judge how much of the item's protein is from meat, poultry, fish, seafood, eggs or dairy (1 = all, 0 = none). For a mixed dish, estimate from the visible proportions; return null rather than guess blindly.
- per100g: your own estimate per 100 g as eaten, including typical added salt for the cooking style. These are only used when the database has no value. If you cannot give a reasonable estimate for a nutrient, return null for it rather than guessing; never return 0 as a placeholder.

The user's note is the best evidence of what the dish is; trust it over appearance. If the input shows or describes no food, return an empty items list.`;

export class AnthropicProvider implements VisionProvider {
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    // The key is supplied by the user and lives only on their device; this app has no server.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
  }

  async analyze(input: AnalyzeInput): Promise<AiItem[]> {
    const note = input.note.trim();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.imageBase64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } });
      content.push({ type: 'text', text: note ? `Photo of my meal. My note: ${note}` : 'Photo of my meal. No note.' });
    } else {
      content.push({ type: 'text', text: `No photo. Description of what I ate: ${note}` });
    }

    const useFallback = FALLBACK_MODELS.includes(this.model);
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        messages: [{ role: 'user', content }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new AiError('The Anthropic API key was rejected. Check it in Settings.');
      }
      if (e instanceof Anthropic.RateLimitError) throw new AiError('The AI service is rate-limiting requests. Wait a minute and try again.');
      if (e instanceof Anthropic.NotFoundError) throw new AiError(`The model "${this.model}" is not available to this API key. Pick another model in Settings.`);
      if (e instanceof Anthropic.BadRequestError) throw new AiError(`The AI request was rejected: ${e.message}`);
      if (e instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach the AI service. Check your connection.');
      if (e instanceof Anthropic.APIError) throw new AiError(`AI service error${e.status ? ` (HTTP ${e.status})` : ''}. Try again shortly.`);
      throw e;
    }

    if (res.stop_reason === 'refusal') throw new AiError('The AI declined to analyse this input. Add the foods by typing instead.');
    if (res.stop_reason === 'max_tokens') throw new AiError('The AI reply was cut off. Try again, or describe fewer foods at once.');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiError('The AI reply could not be read. Try again.');
    }
    return sanitizeAiItems(parsed);
  }
}
