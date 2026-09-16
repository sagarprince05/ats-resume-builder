/* =====================================================================
   Browser-driven test suite. Loads the real app (a built site folder or
   the source tree) in the iframe, replaces fetch inside it with a fake
   Groq, and drives the actual UI: upload, paste posting, optimise,
   replace CV, download menu, relay mode, error handling.

   Open tests/e2e.html?site=/build/site-github/index.html in a browser, or
   let tests/ci.mjs run it headlessly. Results land in window.__results
   and window.__done for the runner.
   ===================================================================== */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const SITE = params.get('site') || '/index.html';
  const logEl = document.getElementById('log');
  const frame = document.getElementById('app');
  const results = [];
  window.__results = results; window.__done = false;

  const log = (cls, msg) => { const d = document.createElement('div'); d.className = cls; d.textContent = msg; logEl.appendChild(d); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms = 8000, step = 100) {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting'); await sleep(step); }
  }
  async function test(name, fn) {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true }); log('pass', `PASS  ${name}  (${Date.now() - t0} ms)`); }
    catch (e) { results.push({ name, ok: false, error: String(e && e.stack || e) }); log('fail', `FAIL  ${name}\n      ${e && e.message || e}`); console.error(name, e); }
  }
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

  /* ---------- the app under test ---------- */
  let W, D;   // iframe window / document
  async function loadApp(query = '') {
    await new Promise(res => {
      frame.onload = () => res();
      frame.src = SITE + (SITE.includes('?') ? '&' : '?') + 'test=1&t=' + Date.now() + query;
    });
    W = frame.contentWindow; D = frame.contentDocument;
    W.__errors = [];
    W.addEventListener('error', e => W.__errors.push(e.message));
    await waitFor(() => W.AI && W.RB && D.querySelector('textarea'));
    if (W.AI.ready) await W.AI.ready;
  }
  function clearStorage() {
    try { Object.keys(W.localStorage).filter(k => k.startsWith('atsResumeBuilder.')).forEach(k => W.localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  }

  /* ---------- fake Groq ---------- */
  const calls = [];
  const opts = { delay: 0, mode: 'ok' };
  const reply = (model, obj) => new W.Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(obj) } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const errorReply = (status, message) => new W.Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } });
  const blank = () => ({ personal: { fullName: '', title: '', email: '', phone: '', location: '', linkedin: '', website: '', github: '' }, summary: '', experience: [], education: [], skills: [], projects: [], certifications: [], awards: [], languages: [], custom: [], sectionOrder: ['summary', 'experience', 'skills', 'education'] });
  function installFakeGroq() {
    const realFetch = W.fetch.bind(W);
    W.fetch = async (url, init) => {
      const u = String(url);
      const isGroq = u.includes('api.groq.com') || u.includes('/api/groq');
      if (!isGroq) return realFetch(url, init);
      const headers = (init && init.headers) || {};
      const rec = { url: u, auth: headers.authorization || headers.Authorization || null, method: (init && init.method) || 'GET' };
      calls.push(rec);
      if (u.endsWith('/health')) return new W.Response(JSON.stringify({ ok: true, relay: 'groq', keySet: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/models')) return new W.Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(init.body);
      rec.model = body.model; rec.format = body.response_format && body.response_format.type;
      if (opts.mode === 'busy') return errorReply(429, 'Rate limit reached');
      if (opts.mode === 'busy-first' && body.model === 'openai/gpt-oss-120b') return errorReply(429, 'Rate limit reached');
      if (opts.mode === 'bad-key') return errorReply(401, 'Invalid API Key');
      if (opts.mode === 'no-schema' && rec.format === 'json_schema') return errorReply(400, 'response_format json_schema is not supported');
      if (opts.delay) await sleep(opts.delay);
      if (init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      const user = body.messages[1].content;
      if (user.includes('<resume>')) {
        const name = user.split('<resume>')[1].trim().split('\n')[0].trim();
        const o = blank(); o.personal.fullName = name; o.personal.title = 'Software Engineer'; o.summary = 'Original summary of ' + name + '.';
        o.experience = [{ role: 'Software Engineer', company: name + ' Co', location: 'Austin, TX', start: 'Jan 2020', end: '', current: true, bullets: ['Built internal tools used by 40 people'] }];
        o.education = [{ school: 'State University', degree: 'BS', field: 'Computer Science', location: '', start: '2015', end: '2019', gpa: '', details: '' }];
        o.skills = [{ category: 'Technical', items: ['JavaScript', 'Python', 'AWS'] }];
        return reply(body.model, o);
      }
      if (user.includes('<job_description>')) {
        const rj = JSON.parse(user.split('<resume_json>')[1].split('</resume_json>')[0]);
        const name = rj.personal.fullName;
        return reply(body.model, Object.assign(blank(), rj, {
          summary: 'TAILORED summary for ' + name + ' with AWS, Kubernetes and TypeScript.',
          changes: [{ section: 'Summary', description: 'Rewritten for ' + name }],
          headlineSuggestion: '', coaching: []
        }));
      }
      return reply(body.model, { ok: true });
    };
  }
  const mkFile = (name, who) => new W.File([`${who}\nSoftware Engineer\n${who.toLowerCase().replace(/ /g, '.')}@example.com | (555) 010-0000 | Austin, TX\n\nEXPERIENCE\nSoftware Engineer, ${who} Co, Jan 2020 - Present\n- Built internal tools used by 40 people\n\nEDUCATION\nBS Computer Science, State University, 2019\n\nSKILLS\nJavaScript, Python, AWS`], name, { type: 'text/plain' });
  function upload(file) {
    const input = D.querySelector('input[type=file]');
    const dt = new W.DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new W.Event('change', { bubbles: true }));
  }
  function pasteJd(text) {
    const ta = D.querySelector('textarea'); ta.focus(); ta.value = text;
    ta.dispatchEvent(new W.Event('input', { bubbles: true })); ta.blur();
  }
  const pageText = () => (D.querySelector('.page') || { innerText: '' }).innerText;
  const chipText = () => ((D.querySelector('.file-chip, .upload-chip') || { innerText: '' }).innerText).replace(/\s+/g, ' ').trim();
  const step3Text = () => ((D.getElementById('step3') || { innerText: '' }).innerText).replace(/\s+/g, ' ').trim();
  const JD = 'Senior Software Engineer. Must have AWS, Kubernetes and TypeScript. Lead a small team and own the CI/CD pipeline.';

  /* ---------- tests ---------- */
  async function run() {
    log('info', `Site under test: ${SITE}`);

    await test('app boots without errors', async () => {
      await loadApp(); clearStorage();
      eq(W.__errors.length, 0, 'uncaught errors: ' + W.__errors.join('; '));
      assert(D.querySelector('textarea'), 'job description box missing');
      assert(D.querySelector('input[type=file]'), 'file input missing');
      assert([...D.querySelectorAll('button')].some(b => /Download/.test(b.textContent)), 'Download button missing');
    });

    const relayConfigured = !!(W.APP_CONFIG && W.APP_CONFIG.groqProxy);
    if (relayConfigured) {
      await test('missing relay falls back to per-user keys', async () => {
        // This static test server has no /api/groq, so the health probe fails.
        eq(W.AI.usingProxy(), false, 'should not be in relay mode');
        eq(W.AI.isBuiltIn(), false, 'should not hide key settings');
        assert(!D.getElementById('btnAi').hidden, 'AI settings entry should be visible');
      });
    } else {
      await test('no relay configured: per-user key mode', async () => {
        eq(W.AI.usingProxy(), false); eq(W.AI.isBuiltIn(), false);
        assert(D.querySelector('.ai-card'), 'AI setup card should be shown');
      });
    }

    await test('AI settings: save a Groq key and test the connection', async () => {
      installFakeGroq();
      [...D.querySelectorAll('button')].find(b => /AI settings/i.test(b.textContent)).click();
      const m = await waitFor(() => D.querySelector('.modal'));
      const key = m.querySelector('#aiKey'); key.value = 'gsk_test_key_1234567890'; key.dispatchEvent(new W.Event('change', { bubbles: true }));
      await sleep(400);
      m.querySelector('#aiTest').click();
      await waitFor(() => /Connected/.test(m.querySelector('#aiStatus').textContent) || /rejected|error/i.test(m.querySelector('#aiStatus').textContent));
      assert(/Connected\. Groq works with openai\/gpt-oss-120b/.test(m.querySelector('#aiStatus').textContent), 'status: ' + m.querySelector('#aiStatus').textContent);
      [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click();
      await waitFor(() => !D.querySelector('.modal'));
      eq(W.AI.isConfigured(), true, 'key not saved');
    });

    await test('upload CV -> paste posting -> optimised automatically', async () => {
      calls.length = 0;
      upload(mkFile('alice.txt', 'Alice Ahmed'));
      await waitFor(() => /Alice Ahmed/.test(chipText()));
      pasteJd(JD);
      await waitFor(() => pageText().includes('TAILORED summary for Alice Ahmed'), 15000);
      assert(/Your resume is ready/.test(step3Text()), 'step 3 should say ready: ' + step3Text());
      const kinds = calls.map(c => c.url.includes('chat/completions') ? 'chat' : 'other');
      eq(kinds.filter(k => k === 'chat').length, 2, 'expected one parse call and one rewrite call');
      eq(calls[0].auth, 'Bearer gsk_test_key_1234567890', 'key must be sent as a Bearer token in direct mode');
      eq(calls[0].format, 'json_schema', 'first attempt should use the strict schema');
      assert(/Rewritten for this posting by Groq/.test(D.body.innerText) || /Optimised automatically/.test(D.body.innerText), 'status line missing');
    });

    await test('download menu offers PDF, Word and text; filename from name and title', async () => {
      const btn = [...D.querySelectorAll('button')].find(b => /Download/.test(b.textContent));
      btn.click(); await sleep(300);
      const items = [...D.querySelectorAll('.menu-item, [role=menuitem]')].map(b => b.textContent.replace(/\s+/g, ' ').trim());
      assert(items.some(t => /^PDF/.test(t)), 'PDF option missing');
      assert(items.some(t => /Word/.test(t)), 'Word option missing');
      assert(items.some(t => /Plain text/.test(t)), 'Text option missing');
      D.body.click(); await sleep(100);
      const css = [...D.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } })
        .filter(r => r.media && /print/.test(r.media.mediaText)).map(r => r.cssText).join(' ');
      assert(/not\(\.workspace\)/.test(css), 'print stylesheet should hide everything except the resume');
      const name = W.Exporter && W.Exporter.baseName ? W.Exporter.baseName(W.RB.load()) : '';
      eq(name, 'Alice_Ahmed_Software_Engineer', 'download filename');
    });

    await test('replacing the CV after a finished run re-optimises the new one', async () => {
      calls.length = 0;
      upload(mkFile('bob.txt', 'Bob Brown'));
      await waitFor(() => pageText().includes('TAILORED summary for Bob Brown'), 15000);
      assert(!pageText().includes('Alice Ahmed'), 'old resume still shown');
      assert(/bob\.txt/.test(chipText()), 'chip should show the new file, got: ' + JSON.stringify(chipText()) + ' chips=' + D.querySelectorAll('.file-chip').length + ' step1=' + JSON.stringify(((D.getElementById('step1')||{}).textContent||'').replace(/\s+/g,' ').slice(0,200)));
      assert(!D.querySelector('.modal'), 'no confirmation popup expected');
    });

    await test('replacing the CV while a rewrite is in flight discards the old reply', async () => {
      calls.length = 0; opts.delay = 2500;
      upload(mkFile('carol.txt', 'Carol Cruz'));
      await waitFor(() => calls.filter(c => c.url.includes('chat/completions')).length >= 2, 6000);   // Carol's rewrite is now in flight
      opts.delay = 0;
      upload(mkFile('dave.txt', 'Dave Diaz'));
      await waitFor(() => pageText().includes('TAILORED summary for Dave Diaz'), 15000);
      await sleep(3000);   // give Carol's late reply time to arrive (it must be ignored)
      assert(pageText().includes('Dave Diaz') && !pageText().includes('Carol Cruz'), 'late reply overwrote the new resume');
    });

    await test('busy model falls through to the next Groq model and says so', async () => {
      calls.length = 0; opts.mode = 'busy-first';
      const res = await W.AI.tailorResume(W.RB.sampleState(), JD);
      opts.mode = 'ok';
      eq(res.model, 'llama-3.3-70b-versatile', 'should have moved to the second model');
      eq(res.fellBackFrom, 'openai/gpt-oss-120b');
      const tried = [...new Set(calls.map(c => c.model))];
      assert(tried[0] === 'openai/gpt-oss-120b' && tried[1] === 'llama-3.3-70b-versatile', 'order: ' + tried.join(','));
    });

    await test('model without schema support falls back to JSON mode', async () => {
      calls.length = 0; opts.mode = 'no-schema';
      await W.AI.test('groq', 'gsk_test_key_1234567890', 'openai/gpt-oss-120b');
      opts.mode = 'ok';
      eq(calls.map(c => c.format).join(','), 'json_schema,json_object');
    });

    await test('all models busy -> clear error, rule-based fallback keeps the resume', async () => {
      opts.mode = 'busy';
      const before = pageText();
      const submit = [...D.querySelectorAll('button')].find(b => /^Submit/i.test(b.textContent.trim()));
      submit.click();
      await waitFor(() => /AI rewrite failed|busy/i.test(D.body.innerText), 20000);
      opts.mode = 'ok';
      assert(pageText().includes('Dave Diaz'), 'resume lost after failure');
      assert(before.length > 50, 'resume empty');
    });

    await test('rejected key gives an actionable message', async () => {
      opts.mode = 'bad-key';
      let msg = '';
      try { await W.AI.test('groq', 'gsk_wrong', 'openai/gpt-oss-120b'); } catch (e) { msg = e.message; }
      opts.mode = 'ok';
      assert(/rejected/i.test(msg), 'message: ' + msg);
    });

    await test('ATS analysis scores the resume against the posting', async () => {
      const res = W.ATS.analyze(W.RB.sampleState(), JD, { pages: 1 });
      assert(res.score >= 0 && res.score <= 100, 'score out of range: ' + res.score);
      assert(res.keywords && res.keywords.all.length > 0, 'no keywords extracted');
      assert(res.keywords.matched.some(k => /aws|kubernetes|typescript/i.test(k)), 'expected AWS/Kubernetes/TypeScript to match: ' + res.keywords.matched.join(','));
    });

    await test('relay mode: no key in the browser, calls go to /api/groq, settings hidden', async () => {
      await loadApp(); clearStorage();
      installFakeGroq(); calls.length = 0;
      W.APP_CONFIG = Object.assign({}, W.APP_CONFIG, { groqProxy: '/api/groq' });
      // Re-run the AI layer now that a relay "exists" (the fake answers /health).
      const src = await (await fetch(SITE.replace(/index\.html.*$/, '') + 'js/ai.js', { cache: 'no-store' })).text();
      W.eval(src); await W.AI.ready; W.dispatchEvent(new W.Event('ai-config-changed'));
      eq(W.AI.usingProxy(), true, 'relay not detected');
      eq(W.AI.isBuiltIn(), true); assert(D.getElementById('btnAi').hidden, 'AI settings should be hidden in relay mode');
      assert(!D.querySelector('.ai-card'), 'no key card in relay mode');
      upload(mkFile('erin.txt', 'Erin Evans'));
      await waitFor(() => /Erin Evans/.test(chipText()));
      pasteJd(JD);
      await waitFor(() => pageText().includes('TAILORED summary for Erin Evans'), 15000);
      const chat = calls.filter(c => c.url.includes('chat/completions'));
      assert(chat.length >= 2 && chat.every(c => c.url.startsWith('/api/groq') || c.url.includes('/api/groq/')), 'calls did not go through the relay: ' + chat.map(c => c.url).join(','));
      assert(chat.every(c => c.auth === null), 'a key was sent from the browser in relay mode');
    });

    await test('Cloudflare relay function: routing, key injection, guards', async () => {
      const mod = await import('/hosting/cloudflare/functions/api/groq/' + encodeURIComponent('[[path]].js') + '?t=' + Date.now());
      const seen = []; const realFetch = window.fetch;
      window.fetch = async (url, init) => { seen.push({ url: String(url), auth: init.headers.authorization }); return new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
      const call = async (path, o = {}, env = { GROQ_API_KEY: 'gsk_server' }) => { const r = await mod.onRequest({ request: new Request('https://x.pages.dev/api/groq/' + path, Object.assign({ method: 'GET' }, o)), env, params: { path: path.split('/') } }); return { status: r.status, body: await r.json() }; };
      try {
        const h = await call('health'); eq(h.status, 200); eq(h.body.ok, true); eq(h.body.keySet, true);
        eq((await call('health', {}, {})).body.keySet, false);
        eq((await call('chat/completions', { method: 'POST', body: '{}' })).status, 200);
        eq(seen[0].auth, 'Bearer gsk_server', 'key must be added server-side'); eq(seen[0].url, 'https://api.groq.com/openai/v1/chat/completions');
        eq((await call('models')).status, 200);
        eq((await call('embeddings')).status, 404);
        eq((await call('chat/completions')).status, 405);
        eq((await call('chat/completions', { method: 'POST', body: '{}' }, {})).status, 500);
        eq((await call('chat/completions', { method: 'POST', body: 'x'.repeat(500 * 1024) })).status, 413);
      } finally { window.fetch = realFetch; }
    });

    await test('Netlify relay function: routing, key injection, guards', async () => {
      globalThis.process = { env: { GROQ_API_KEY: 'gsk_server' } };
      const mod = await import('/hosting/netlify/netlify/functions/groq.mjs?t=' + Date.now());
      const seen = []; const realFetch = window.fetch;
      window.fetch = async (url, init) => { seen.push({ url: String(url), auth: init.headers.authorization }); return new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
      const call = async (path, o = {}) => { const r = await mod.default(new Request('https://x.netlify.app/api/groq/' + path, Object.assign({ method: 'GET' }, o))); return { status: r.status, body: await r.json() }; };
      try {
        const h = await call('health'); eq(h.status, 200); eq(h.body.ok, true);
        eq((await call('chat/completions', { method: 'POST', body: '{}' })).status, 200);
        eq(seen[0].auth, 'Bearer gsk_server'); eq(seen[0].url, 'https://api.groq.com/openai/v1/chat/completions');
        eq((await call('embeddings')).status, 404);
        eq((await call('chat/completions')).status, 405);
        globalThis.process = { env: {} };
        eq((await call('chat/completions', { method: 'POST', body: '{}' })).status, 500);
      } finally { window.fetch = realFetch; delete globalThis.process; }
    });

    const failed = results.filter(r => !r.ok).length;
    log(failed ? 'fail' : 'pass', `${results.length - failed} passed, ${failed} failed`);
    window.__done = true;
  }
  run().catch(e => { log('fail', 'Runner crashed: ' + (e && e.stack || e)); results.push({ name: 'runner', ok: false, error: String(e) }); window.__done = true; });
})();
