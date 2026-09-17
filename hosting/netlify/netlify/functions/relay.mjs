/* Netlify Function: relays the app's AI calls and adds the API keys on
   the server, so no key ever reaches the browser.

   Mapped to /api/* (see `config` below). Set GROQ_API_KEY and/or
   GEMINI_API_KEY under Site configuration -> Environment variables, then
   redeploy.

   Routes:
     GET  /api/health                              -> which keys are set
     POST /api/groq/chat/completions               -> Groq
     GET  /api/groq/models
     POST /api/gemini/models/<model>:generateContent -> Google Gemini
     GET  /api/gemini/models

   Free tier: 125,000 invocations a month. */

const MAX_BODY = 400 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

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

export default async (request) => {
  const url = new URL(request.url);
  const rel = url.pathname.replace(/^\/api\/?/, '').replace(/^\/\.netlify\/functions\/relay\/?/, '');
  const parts = rel.split('/').filter(Boolean);
  const env = process.env;
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
  if (!key) return json({ error: { message: `${spec.env} is not set on the server. Add it under Site configuration -> Environment variables, then redeploy.` } }, 500);

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: { message: 'Forbidden.' } }, 403);

  let body;
  if (route.method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY) return json({ error: { message: 'Request too large.' } }, 413);
  }
  const upstream = await fetch(spec.base + path + url.search, {
    method: route.method,
    headers: Object.assign({ 'content-type': 'application/json' }, spec.headers(key)),
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
};

export const config = { path: '/api/*' };
