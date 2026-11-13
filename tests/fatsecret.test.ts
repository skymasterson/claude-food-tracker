import 'fake-indexeddb/auto';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../relay/fatsecret-worker.js';
import { db } from '../src/db/db';
import { DEFAULT_SETTINGS } from '../src/db/repo';
import { UNKNOWN } from '../src/domain/nutrients';
import type { AiItem } from '../src/services/ai/provider';
import { analyzeMeal } from '../src/services/analyze';
import { findBranded, findByName, getFatSecretFood, nameMatches, parseFood, parseHits, searchFatSecret } from '../src/services/fatsecret';

// ---- reference OAuth 1.0 implementation, checked against the published example in the OAuth Core 1.0 spec ----
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function refSignature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret = '') {
  const norm = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  return createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update([method, enc(url), enc(norm)].join('&')).digest('base64');
}

const env = { FATSECRET_KEY: 'ck_test', FATSECRET_SECRET: 's3cr&t/+', RELAY_TOKEN: 'open sesame' };
const req = (path: string, headers: Record<string, string> = { 'x-relay-token': 'open sesame' }, method = 'GET') => new Request(`https://relay.example.workers.dev${path}`, { method, headers });

describe('relay worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reference signer reproduces the OAuth 1.0 specification example', () => {
    const sig = refSignature('GET', 'http://photos.example.net/photos', {
      file: 'vacation.jpg', size: 'original', oauth_consumer_key: 'dpf43f3p2l4k3l03', oauth_token: 'nnch734d00sl2jdk',
      oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1191242096', oauth_nonce: 'kllo9940pd9333jh', oauth_version: '1.0',
    }, 'kd94hf93k423kf44', 'pfkkdhi9sl3r4s00');
    expect(sig).toBe('tR3+Ty81lMeYAr/Fid0kMTYa/WM=');
  });

  it('signs the FatSecret request correctly and passes the answer through', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('{"foods":{"food":[]}}', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const res = await worker.fetch(req('/search?q=' + encodeURIComponent("trader joe's (chicken) & rice")), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foods: { food: [] } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const sent = new URL(upstream.mock.calls[0][0] as string);
    expect(sent.origin + sent.pathname).toBe('https://platform.fatsecret.com/rest/server.api');
    const params = Object.fromEntries(sent.searchParams.entries());
    expect(params).toMatchObject({ method: 'foods.search', search_expression: "trader joe's (chicken) & rice", format: 'json', oauth_consumer_key: 'ck_test', oauth_signature_method: 'HMAC-SHA1', oauth_version: '1.0' });
    const { oauth_signature, ...signed } = params;
    expect(oauth_signature).toBe(refSignature('GET', 'https://platform.fatsecret.com/rest/server.api', signed, env.FATSECRET_SECRET));
    expect(upstream.mock.calls[0][0]).not.toContain('s3cr'); // the secret itself is never sent
  });

  it('requests food details by id', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('{"food":{}}', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    await worker.fetch(req('/food?id=12345'), env);
    const p = new URL(upstream.mock.calls[0][0] as string).searchParams;
    expect(p.get('method')).toBe('food.get.v4');
    expect(p.get('food_id')).toBe('12345');
  });

  it('refuses requests without the passphrase, bad input and missing configuration', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await worker.fetch(req('/search?q=rice', {}), env)).status).toBe(401);
    expect((await worker.fetch(req('/search?q=rice', { 'x-relay-token': 'wrong' }), env)).status).toBe(401);
    expect((await worker.fetch(req('/search?q='), env)).status).toBe(400);
    expect((await worker.fetch(req('/food?id=1;drop'), env)).status).toBe(400);
    expect((await worker.fetch(req('/other'), env)).status).toBe(404);
    expect((await worker.fetch(req('/search?q=rice', undefined, 'POST'), env)).status).toBe(405);
    expect((await worker.fetch(req('/search?q=rice'), { FATSECRET_KEY: 'k' })).status).toBe(500);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers the browser preflight and a health check without the passphrase', async () => {
    const pre = await worker.fetch(req('/search?q=rice', {}, 'OPTIONS'), { ...env, ALLOWED_ORIGIN: 'https://skymasterson.github.io' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toBe('x-relay-token');
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://skymasterson.github.io');
    expect(await (await worker.fetch(req('/health', {}), env)).json()).toEqual({ ok: true, configured: true });
    expect(await (await worker.fetch(req('/health', {}), {})).json()).toEqual({ ok: true, configured: false });
  });
});

// ---- app side ----
const cfg = { ...DEFAULT_SETTINGS, anthropicKey: 'k', fatsecretUrl: 'https://relay.example.workers.dev/', fatsecretToken: 'open sesame' };
const searchBody = { foods: { food: [
  { food_id: '111', food_name: 'Chicken Burrito Bowl', food_type: 'Generic', food_description: 'Per 100g - Calories: 150kcal' },
  { food_id: '222', food_name: 'Chicken Burrito Bowl', food_type: 'Brand', brand_name: 'Chipotle Mexican Grill', food_description: 'Per 1 bowl - Calories: 600kcal' },
] } };
const foodBody = { food: { food_id: '222', food_name: 'Chicken Burrito Bowl', brand_name: 'Chipotle Mexican Grill', servings: { serving: [
  { serving_description: '1 oz', metric_serving_amount: '28.350', metric_serving_unit: 'g', calories: '43', protein: '2.8', sodium: '92' },
  { serving_description: '1 bowl', metric_serving_amount: '400.000', metric_serving_unit: 'g', is_default: '1', calories: '600', protein: '40', sodium: '1300', potassium: '800' },
] } } };
const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });

describe('FatSecret in the app', () => {
  beforeEach(async () => {
    await db.usdaCache.clear();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('parses search hits, including a single hit and no hits', () => {
    expect(parseHits(searchBody).map((h) => [h.foodId, h.brand])).toEqual([['111', undefined], ['222', 'Chipotle Mexican Grill']]);
    expect(parseHits({ foods: { food: searchBody.foods.food[0] } })).toHaveLength(1);
    expect(parseHits({ foods: { total_results: '0' } })).toEqual([]);
  });

  it('converts the default serving to per-100 g and leaves phosphorus unknown', () => {
    const m = parseFood(foodBody);
    expect(m).toMatchObject({ fatsecretId: '222', description: 'Chipotle Mexican Grill Chicken Burrito Bowl', defaultGrams: 400, household: '1 bowl', completeness: 4 });
    expect(m.per100g.kcal).toEqual({ value: 150, source: 'fatsecret' });
    expect(m.per100g.sodium).toEqual({ value: 325, source: 'fatsecret' });
    expect(m.per100g.potassium).toEqual({ value: 200, source: 'fatsecret' });
    expect(m.per100g.phosphorus).toEqual(UNKNOWN);
    expect(m.per100g.animalProtein).toEqual(UNKNOWN);
  });

  it('keeps missing fields unknown and handles a serving with no weight', () => {
    const m = parseFood({ food: { food_id: 9, food_name: 'Latte', servings: { serving: { serving_description: '1 cup', calories: '190', protein: '', sodium: '150' } } } });
    expect(m.per100g.kcal).toEqual({ value: 190, source: 'fatsecret' });
    expect(m.per100g.protein).toEqual(UNKNOWN);
    expect(m.per100g.potassium).toEqual(UNKNOWN);
    expect(m.defaultGrams).toBe(100);
    expect(m.household).toContain('weight unknown');
    expect(() => parseFood({})).toThrow(/no details/);
  });

  it('sends the passphrase to the relay and caches the answer', async () => {
    const f = vi.fn().mockImplementation(async () => reply(searchBody));
    vi.stubGlobal('fetch', f);
    await searchFatSecret('Burrito Bowl', cfg);
    await searchFatSecret('burrito bowl', cfg);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://relay.example.workers.dev/search?q=burrito%20bowl');
    expect(f.mock.calls[0][1].headers['x-relay-token']).toBe('open sesame');
  });

  it('turns relay and FatSecret errors into plain messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply({ error: { code: 21, message: 'Invalid IP address detected' } })));
    await expect(searchFatSecret('a', cfg)).rejects.toThrow(/network address/);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply({ relay_error: 'Wrong or missing relay passphrase.' }, 401)));
    await expect(searchFatSecret('b', cfg)).rejects.toThrow(/passphrase in Settings/);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply({ error: { code: 8, message: 'Invalid signature' } })));
    await expect(getFatSecretFood('5', cfg)).rejects.toThrow(/FATSECRET_SECRET/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(searchFatSecret('c', cfg)).rejects.toThrow(/Could not reach the FatSecret relay/);
    await expect(searchFatSecret('d', { fatsecretUrl: '', fatsecretToken: '' })).rejects.toThrow(/Settings/);
  });

  it('only accepts a branded match when the brand is the one named', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => reply(u.includes('/food') ? foodBody : searchBody)));
    expect((await findBranded('Chipotle', 'Chicken burrito bowl', cfg))?.fatsecretId).toBe('222');
    expect(await findBranded('Qdoba', 'Chicken burrito bowl', cfg)).toBeNull();
    expect(await findBranded('Chipotle', 'Steak quesadilla', cfg)).toBeNull(); // right brand, different item
  });

  it('never takes an unrelated first result when falling back by name', async () => {
    const hit = { foodId: '1', name: 'Chicken Burrito Bowl', brand: 'Chipotle Mexican Grill', summary: '' };
    expect(nameMatches(hit, 'Chicken burrito bowl')).toBe(true);
    expect(nameMatches(hit, 'burrito bowls')).toBe(true);
    expect(nameMatches(hit, 'Teriyaki glaze')).toBe(false);
    expect(nameMatches(hit, 'Chicken soup')).toBe(false);
    expect(nameMatches(hit, '')).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => reply(u.includes('/food') ? foodBody : searchBody)));
    expect(await findByName('Teriyaki glaze', cfg)).toBeNull();
    expect((await findByName('chicken burrito bowl', cfg))?.description).toContain('Chicken Burrito Bowl');
  });

  const ai = (brand: string | null): AiItem => ({ name: 'Chicken burrito bowl', usdaSearchTerm: 'burrito bowl chicken', grams: 450, household: '1 bowl', confidence: 'medium', brand, animalProteinShare: 0.8, per100g: { kcal: 140, protein: 9, potassium: 210, sodium: 300, phosphorus: 120 } });
  const usdaBody = { foods: [{ fdcId: 7, description: 'Burrito bowl, chicken', dataType: 'Survey (FNDDS)', foodCategory: 'Other Mexican mixed dishes', foodNutrients: [[1008, 161], [1003, 21], [1092, 211], [1093, 301], [1091, 202]].map(([nutrientId, value]) => ({ nutrientId, unitName: 'KCAL', value })) }] };
  const route = (calls: string[]) => vi.fn().mockImplementation(async (u: string) => {
    calls.push(u.includes('usda') ? 'usda' : u.includes('/food') ? 'fs-food' : 'fs-search');
    return u.includes('usda') ? reply(usdaBody) : reply(u.includes('/food') ? foodBody : searchBody);
  });

  it('a named chain uses FatSecret; phosphorus falls back to a labelled AI estimate', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', route(calls));
    const r = await analyzeMeal({ note: 'chipotle bowl' }, { ...cfg, usdaKey: 'u' }, { analyze: async () => [ai('Chipotle')] });
    const item = r.items[0];
    expect(calls).toEqual(['fs-search', 'fs-food']);
    expect(item.fatsecretId).toBe('222');
    expect(item.grams).toBe(450); // the portion stays the AI's estimate of what was eaten
    expect(item.per100g.sodium).toEqual({ value: 325, source: 'fatsecret' });
    expect(item.per100g.phosphorus).toEqual({ value: 120, source: 'ai-estimate' });
    expect(item.per100g.animalProtein).toEqual({ value: 10 * 0.8, source: 'ai-estimate' });
  });

  it('without a brand, USDA is used and FatSecret is not called', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', route(calls));
    const r = await analyzeMeal({ note: 'bowl' }, { ...cfg, usdaKey: 'u' }, { analyze: async () => [ai(null)] });
    expect(calls).toEqual(['usda']);
    expect(r.items[0].fdcId).toBe(7);
    expect(r.items[0].per100g.phosphorus).toEqual({ value: 202, source: 'usda-survey' });
  });

  it('a FatSecret failure is reported and the item still gets a USDA match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => (u.includes('usda') ? reply(usdaBody) : reply({ error: { code: 21, message: 'Invalid IP' } }))));
    const r = await analyzeMeal({ note: 'x' }, { ...cfg, usdaKey: 'u' }, { analyze: async () => [ai('Chipotle')] });
    expect(r.items[0].fdcId).toBe(7);
    expect(r.warnings.join(' ')).toMatch(/network address/);
  });
});
