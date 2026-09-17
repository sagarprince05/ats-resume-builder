/* Cloudflare Pages Function: relays the app's AI calls and adds the API
   keys on the server, so no key ever reaches the browser.

   Deployed automatically when this file sits at functions/api/[[path]].js
   in the site folder. Set the secrets GROQ_API_KEY and/or GEMINI_API_KEY
   in the Pages project (Settings -> Variables and Secrets).

   Routes:
     GET  /api/health                              -> which keys are set
     POST /api/groq/chat/completions               -> Groq
     GET  /api/groq/models
     POST /api/gemini/models/<model>:generateContent -> Google Gemini
     GET  /api/gemini/models

   Free tier: 100,000 requests a day, far above the providers' own free
   quotas, so this layer costs nothing. */

const MAX_BODY = 400 * 1024;   // a resume plus a posting is well under this

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

/* provider -> { key env var, upstream base, allowed routes } */
const PROVIDERS = {
  groq: {
    env: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1/',
    routes: [{ method: 'POST', test: p => p === 'chat/completions' }, { method: 'GET', test: p => p === 'models' }],
    headers: key => ({ 'authorization': 'Bearer ' + key })
  },
  gemini: {
    env: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/',
    routes: [{ method: 'POST', test: p => /^models\/[\w.-]+:generateContent$/.test(p) }, { method: 'GET', test: p => p === 'models' }],
    headers: key => ({ 'x-goog-api-key': key })
  }
};

export async function onRequest({ request, env, params }) {
  const parts = params.path || [];
  if (parts.join('/') === 'health') {
    return json({ ok: true, relay: 'ai', keys: { groq: !!env.GROQ_API_KEY, gemini: !!env.GEMINI_API_KEY } });
  }
  const spec = PROVIDERS[parts[0]];
  const path = parts.slice(1).join('/');
  if (!spec) return json({ error: { message: 'Not found.' } }, 404);
  const route = spec.routes.find(r => r.test(path));
  if (!route) return json({ error: { message: 'Not found.' } }, 404);
  if (request.method !== route.method) return json({ error: { message: 'Method not allowed.' } }, 405);
  const key = env[spec.env];
  if (!key) return json({ error: { message: `${spec.env} is not set on the server. Add it under Settings -> Variables and Secrets, then redeploy.` } }, 500);

  // Only this site's own pages may use the relay (blocks other websites
  // from spending the quota; direct scripts are limited by the providers' rate limits).
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== self) return json({ error: { message: 'Forbidden.' } }, 403);

  let body;
  if (route.method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY) return json({ error: { message: 'Request too large.' } }, 413);
  }
  const search = new URL(request.url).search;   // e.g. ?pageSize=200 for the Gemini model list
  const upstream = await fetch(spec.base + path + search, {
    method: route.method,
    headers: Object.assign({ 'content-type': 'application/json' }, spec.headers(key)),
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
