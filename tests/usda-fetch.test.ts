import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { searchFoods } from '../src/services/usda';

const body = { foods: [
  { fdcId: 1, description: 'Rice, white, cooked, as ingredient', dataType: 'Survey (FNDDS)', foodNutrients: [1008, 1003, 1092, 1093, 1091].map((nutrientId) => ({ nutrientId, unitName: 'KCAL', value: 1 })) },
  { fdcId: 2, description: 'Rice, white, cooked', dataType: 'SR Legacy', foodCategory: 'Cereal Grains and Pasta', foodNutrients: [1008, 1003, 1092, 1093, 1091].map((nutrientId) => ({ nutrientId, unitName: 'KCAL', value: 1 })) },
] };
const reply = (status: number, json: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json }) as Response;

beforeEach(async () => {
  await db.usdaCache.clear();
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('USDA search', () => {
  it('searches all three data sets in one request and retries a spurious HTTP 400', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(400)).mockResolvedValueOnce(reply(200, body));
    vi.stubGlobal('fetch', fetchMock);
    const r = await searchFoods('Rice White', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api_key=key');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'rice white', dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'], pageSize: 15 });
    expect(r.map((m) => m.fdcId)).toEqual([2, 1]); // "as ingredient" entry pushed down
    expect(r[1].per100g.protein.source).toBe('usda-survey');
  });
  it('serves a repeat search from the device cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, body));
    vi.stubGlobal('fetch', fetchMock);
    await searchFoods('rice', 'key');
    await searchFoods('rice', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports a rejected key without retrying, and gives up after three failures', async () => {
    const denied = vi.fn().mockResolvedValue(reply(403));
    vi.stubGlobal('fetch', denied);
    await expect(searchFoods('a', 'bad')).rejects.toThrow(/key was rejected/);
    expect(denied).toHaveBeenCalledTimes(1);
    const down = vi.fn().mockResolvedValue(reply(400));
    vi.stubGlobal('fetch', down);
    await expect(searchFoods('b', 'key')).rejects.toThrow(/HTTP 400/);
    expect(down).toHaveBeenCalledTimes(3);
  });
});

describe('ranking against the query', () => {
  it('prefers the food that was asked for over a similarly named one', async () => {
    const { rankMatches, toMatch } = await import('../src/services/usda');
    const mk = (fdcId: number, description: string) => toMatch({ fdcId, description, dataType: 'SR Legacy', foodNutrients: [1008, 1003, 1092, 1093, 1091].map((nutrientId) => ({ nutrientId, unitName: 'KCAL', value: 1 })) });
    const list = [mk(1, 'Broccoli raab, cooked'), mk(2, 'Broccoli, Chinese, cooked'), mk(3, 'Broccoli, cooked, boiled')];
    expect(rankMatches(list, 'broccoli cooked').map((m) => m.fdcId)).toEqual([2, 3, 1]);
    expect(rankMatches(list).map((m) => m.fdcId)).toEqual([1, 2, 3]);
  });
});
