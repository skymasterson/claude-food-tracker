/**
 * FatSecret relay for Picture Food Tracker (Cloudflare Worker).
 *
 * The FatSecret API cannot be called from a phone app directly: it sends no browser-access (CORS)
 * headers and its secret must not be shipped to a browser. This Worker holds the FatSecret key,
 * signs each request (OAuth 1.0, HMAC-SHA1) and passes the answer back to the app.
 *
 * Secrets to set on the Worker (Settings -> Variables and Secrets):
 *   FATSECRET_KEY     FatSecret "Consumer Key"   (REST API OAuth 1.0)
 *   FATSECRET_SECRET  FatSecret "Consumer Secret"
 *   RELAY_TOKEN       a passphrase you invent; the app must send the same one
 * Optional plain variable:
 *   ALLOWED_ORIGIN    e.g. https://skymasterson.github.io  (default: any origin)
 *
 * Routes:  GET /health   GET /search?q=<words>   GET /food?id=<food_id>
 */
const FATSECRET = 'https://platform.fatsecret.com/rest/server.api';

// RFC 3986 percent-encoding, as OAuth 1.0 requires.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function signature(params, consumerSecret) {
  const normalized = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const base = ['GET', enc(FATSECRET), enc(normalized)].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${enc(consumerSecret)}&`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  return btoa(String.fromCharCode(...mac));
}

async function callFatSecret(apiParams, env) {
  const params = {
    ...apiParams,
    format: 'json',
    oauth_consumer_key: env.FATSECRET_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
  params.oauth_signature = await signature(params, env.FATSECRET_SECRET);
  const url = `${FATSECRET}?${Object.keys(params).map((k) => `${enc(k)}=${enc(params[k])}`).join('&')}`;
  return fetch(url, { headers: { accept: 'application/json' } });
}

export default {
  async fetch(request, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
      'access-control-allow-headers': 'x-relay-token',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400',
      vary: 'Origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ relay_error: 'Only GET is supported.' }, 405);

    const url = new URL(request.url);
    const configured = Boolean(env.FATSECRET_KEY && env.FATSECRET_SECRET && env.RELAY_TOKEN);
    if (url.pathname === '/health') return json({ ok: true, configured });
    if (!configured) return json({ relay_error: 'The relay is missing FATSECRET_KEY, FATSECRET_SECRET or RELAY_TOKEN.' }, 500);
    if (request.headers.get('x-relay-token') !== env.RELAY_TOKEN) return json({ relay_error: 'Wrong or missing relay passphrase.' }, 401);

    let apiParams;
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return json({ relay_error: 'Missing search words.' }, 400);
      apiParams = { method: 'foods.search', search_expression: q, max_results: '12' };
    } else if (url.pathname === '/food') {
      const id = url.searchParams.get('id') || '';
      if (!/^\d{1,15}$/.test(id)) return json({ relay_error: 'Missing or invalid food id.' }, 400);
      apiParams = { method: 'food.get.v4', food_id: id };
    } else {
      return json({ relay_error: 'Unknown path.' }, 404);
    }

    try {
      const upstream = await callFatSecret(apiParams, env);
      const text = await upstream.text();
      // FatSecret reports its own errors as JSON with HTTP 200; pass the body through unchanged.
      return new Response(text, { status: upstream.ok ? 200 : 502, headers: { ...cors, 'content-type': 'application/json' } });
    } catch {
      return json({ relay_error: 'The relay could not reach FatSecret.' }, 502);
    }
  },
};
