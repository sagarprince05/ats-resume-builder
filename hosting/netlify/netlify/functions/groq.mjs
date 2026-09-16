/* Netlify Function: relays the app's Groq calls and adds the API key on
   the server, so the key never reaches the browser.

   netlify.toml maps /api/groq/* to this function. Set GROQ_API_KEY under
   Site configuration -> Environment variables, then redeploy.

   Free tier: 125,000 invocations a month. */

const UPSTREAM = 'https://api.groq.com/openai/v1/';
const ALLOWED = { 'chat/completions': 'POST', 'models': 'GET' };
const MAX_BODY = 400 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/groq\/?/, '').replace(/^\/\.netlify\/functions\/groq\/?/, '');
  if (path === 'health') return json({ ok: true, relay: 'groq', keySet: !!process.env.GROQ_API_KEY });

  const method = ALLOWED[path];
  if (!method) return json({ error: { message: 'Not found.' } }, 404);
  if (request.method !== method) return json({ error: { message: 'Method not allowed.' } }, 405);
  if (!process.env.GROQ_API_KEY) return json({ error: { message: 'GROQ_API_KEY is not set on the server. Add it under Site configuration -> Environment variables, then redeploy.' } }, 500);

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: { message: 'Forbidden.' } }, 403);

  let body;
  if (method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY) return json({ error: { message: 'Request too large.' } }, 413);
  }

  const upstream = await fetch(UPSTREAM + path, {
    method,
    headers: { 'authorization': 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
};

export const config = { path: '/api/groq/*' };
