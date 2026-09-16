/* Cloudflare Pages Function: relays the app's Groq calls and adds the API
   key on the server, so the key never reaches the browser.

   Deployed automatically when this file sits at
   functions/api/groq/[[path]].js in the site folder. Set the secret
   GROQ_API_KEY in the Pages project (Settings -> Variables and Secrets).

   Free tier: 100,000 requests a day, which is far more than Groq's own
   free quota, so this layer costs nothing. */

const UPSTREAM = 'https://api.groq.com/openai/v1/';
const ALLOWED = { 'chat/completions': 'POST', 'models': 'GET' };
const MAX_BODY = 400 * 1024;   // a resume plus a posting is well under this

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export async function onRequest({ request, env, params }) {
  const path = (params.path || []).join('/');
  if (path === 'health') return json({ ok: true, relay: 'groq', keySet: !!env.GROQ_API_KEY });

  const method = ALLOWED[path];
  if (!method) return json({ error: { message: 'Not found.' } }, 404);
  if (request.method !== method) return json({ error: { message: 'Method not allowed.' } }, 405);
  if (!env.GROQ_API_KEY) return json({ error: { message: 'GROQ_API_KEY is not set on the server. Add it under Settings -> Variables and Secrets, then redeploy.' } }, 500);

  // Only this site's own pages may use the relay (blocks other websites
  // from spending the quota; direct scripts are limited by Groq's own rate limits).
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== self) return json({ error: { message: 'Forbidden.' } }, 403);

  let body;
  if (method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY) return json({ error: { message: 'Request too large.' } }, 413);
  }

  const upstream = await fetch(UPSTREAM + path, {
    method,
    headers: { 'authorization': 'Bearer ' + env.GROQ_API_KEY, 'content-type': 'application/json' },
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
