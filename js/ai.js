/* =====================================================================
   AI layer. Two jobs:
     1. parseResume(text)       - raw resume text -> structured fields
     2. tailorResume(state, jd) - rewrite the resume for a job description
   Two free providers, both called straight from the browser (or through
   the site's relay when hosted): Groq first, Google Gemini as the backup.
   Both are asked for schema-constrained JSON so the reply always fits our
   data model. If the provider in use is busy on every model it offers,
   the same request is handed to the other one.
   Exposes window.AI
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const STORE_KEY = 'atsResumeBuilder.ai';

  /* ---------------- providers ---------------- */
  const PROVIDERS = {
    groq: {
      id: 'groq', name: 'Groq',
      keyHint: 'Paste your Groq API key',
      keyUrl: 'console.groq.com → API Keys',
      note: 'Free, no card needed, about 1,000 requests a day. Very fast. Runs open models such as GPT-OSS and Llama.',
      defaultModel: 'openai/gpt-oss-120b',
      // Fallback list only; the real list is read from the account (listModels).
      models: [
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', note: 'Best quality (recommended)' },
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', note: 'Strong all-rounder' },
        { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', note: 'Faster' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', note: 'Fastest, lower quality' }
      ],
      // Preference order when auto-picking from the live list.
      prefer: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
      // Model families Groq has retired.
      dead: /^(llama-3\.0|llama3-|mixtral-8x7b|gemma-7b|gemma2-9b)/
    },
    gemini: {
      id: 'gemini', name: 'Google Gemini',
      keyHint: 'Paste your Gemini API key',
      keyUrl: 'aistudio.google.com → Get API key',
      note: 'Free, no card needed. Free keys have lower daily limits than Groq, so it works best as the backup.',
      defaultModel: 'gemini-3.8-flash',
      models: [
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', note: 'Recommended' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', note: 'Highest quality, tighter limits' },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', note: 'Fastest and cheapest' }
      ],
      prefer: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
      // Model families Google has retired for new keys.
      dead: /^(models\/)?gemini-(1|2)\./
    }
  };
  const PROVIDER_LIST = [PROVIDERS.groq, PROVIDERS.gemini];
  const IDS = PROVIDER_LIST.map(p => p.id);

  /* ---------------- settings ---------------- */
  function blank() {
    return {
      provider: 'groq',   // the larger free quota, so it goes first
      groq: { key: '', model: PROVIDERS.groq.defaultModel },
      gemini: { key: '', model: PROVIDERS.gemini.defaultModel },
      useForParse: true
    };
  }
  function load() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const cfg = blank();
    IDS.forEach(p => {
      if (raw[p] && typeof raw[p] === 'object') Object.assign(cfg[p], { key: String(raw[p].key || ''), model: String(raw[p].model || cfg[p].model) });
      // Drop model IDs the provider has since retired, so an old saved
      // setting cannot leave the app permanently broken.
      if (PROVIDERS[p].dead.test(cfg[p].model)) cfg[p].model = PROVIDERS[p].defaultModel;
    });
    if (PROVIDERS[raw.provider]) cfg.provider = raw.provider;
    if (typeof raw.useForParse === 'boolean') cfg.useForParse = raw.useForParse;
    if (BUILT_IN || proxyOk) cfg.useForParse = true;   // nothing to configure, so use it everywhere
    return cfg;
  }

  /* Position of a model in the provider's preference list (unknown = last). */
  function rank(spec, id) { const i = (spec.prefer || []).indexOf(id); return i < 0 ? 999 : i; }

  /* Best model from a live list, using the provider's preference order. */
  function pickBest(provider, list) {
    const spec = PROVIDERS[provider];
    if (!list || !list.length) return spec.defaultModel;
    for (const want of (spec.prefer || [])) {
      const hit = list.find(m => m.id === want) || list.find(m => m.id.startsWith(want));
      if (hit) return hit.id;
    }
    const alive = list.filter(m => !(spec.dead && spec.dead.test(m.id)));
    return (alive[0] || list[0]).id;
  }
  function save(cfg) { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }

  /* ---------------- where the providers are reached ---------------- */
  /* Direct from the browser by default. A hosted copy can instead point at
     a relay on the same site (APP_CONFIG.relay, e.g. '/api') that adds the
     keys server-side, so no key ever reaches the browser. */
  const DIRECT = {
    groq: 'https://api.groq.com/openai/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta'
  };
  const CFG = window.APP_CONFIG || {};
  const RELAY = String(CFG.relay || (CFG.groqProxy ? String(CFG.groqProxy).replace(/\/groq\/?$/, '') : '') || '').trim().replace(/\/+$/, '');
  let proxyOk = !!RELAY;          // flipped off if the relay turns out to be missing
  // Which providers the relay has keys for. Optimistic until the health
  // probe answers, so the app never starts in a keyless state by accident.
  let relayKeys = RELAY ? { groq: true, gemini: true } : {};
  function usingProxy() { return proxyOk; }
  function apiBase(p) { return proxyOk ? `${RELAY}/${p}` : DIRECT[p]; }
  function authHeaders(p, key) {
    if (proxyOk) return {};
    return p === 'gemini' ? { 'x-goog-api-key': key } : { 'authorization': 'Bearer ' + key };
  }

  /* If the page was deployed somewhere without the relay (plain static
     hosting), fall back to per-user keys instead of failing every call. */
  const ready = (async function () {
    if (!RELAY) return;
    try {
      const r = await fetch(RELAY + '/health', { cache: 'no-store' });
      const j = r.ok ? await r.json().catch(() => null) : null;
      proxyOk = !!(j && j.ok);
      relayKeys = (j && j.keys) || {};
      if (proxyOk && !IDS.some(p => relayKeys[p])) proxyOk = false;   // relay exists but holds no key
    } catch (e) { proxyOk = false; }
    if (!proxyOk) window.dispatchEvent(new Event('ai-config-changed'));
  })();

  /* Keys baked in at build time. When any is present the app uses them
     silently and hides every API-key control. */
  const BUILT_IN = (function () {
    const keys = {};
    const g = String(CFG.groqKey || '').trim(); if (g) keys.groq = { key: g, model: String(CFG.groqModel || '').trim() || PROVIDERS.groq.defaultModel };
    const m = String(CFG.geminiKey || '').trim(); if (m) keys.gemini = { key: m, model: String(CFG.geminiModel || '').trim() || PROVIDERS.gemini.defaultModel };
    if (!Object.keys(keys).length) return null;
    return keys;
  })();
  function isBuiltIn() { return !!BUILT_IN || proxyOk; }

  /* The preferred provider: config's choice if it has a key, else the
     first one that does (Groq before Gemini). */
  function primary(has) {
    const want = String(CFG.provider || '').trim();
    if (has(want)) return want;
    return IDS.find(has) || 'groq';
  }
  function entry(cfg, p) {
    if (proxyOk) return relayKeys[p] ? { provider: p, spec: PROVIDERS[p], key: 'relay', model: String(CFG[p + 'Model'] || '').trim() || PROVIDERS[p].defaultModel, builtIn: true, proxy: true } : null;
    if (BUILT_IN) return BUILT_IN[p] ? { provider: p, spec: PROVIDERS[p], key: BUILT_IN[p].key, model: BUILT_IN[p].model, builtIn: true } : null;
    cfg = cfg || load();
    return cfg[p] && cfg[p].key ? { provider: p, spec: PROVIDERS[p], key: cfg[p].key, model: cfg[p].model } : null;
  }
  const none = p => ({ provider: p, spec: PROVIDERS[p], key: '', model: PROVIDERS[p].defaultModel });
  function active(cfg) {
    if (proxyOk) return entry(null, primary(p => !!relayKeys[p])) || none('groq');
    if (BUILT_IN) return entry(null, primary(p => !!BUILT_IN[p])) || none('groq');
    cfg = cfg || load();
    return { provider: cfg.provider, spec: PROVIDERS[cfg.provider], key: cfg[cfg.provider].key, model: cfg[cfg.provider].model };
  }
  /* Other providers that also have a key, for cross-provider fallback. */
  function alternates(cfg) {
    const a = active(cfg);
    return IDS.filter(p => p !== a.provider).map(p => entry(cfg, p)).filter(Boolean);
  }
  function isConfigured() { const a = active(); return !!(a && a.key); }
  function providerName() { const a = active(); return a && a.spec ? a.spec.name : ''; }

  /* ---------------- schemas ---------------- */
  const S = t => ({ type: t });
  const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const arr = items => ({ type: 'array', items });
  const strArr = arr(S('string'));

  const RESUME_PROPS = {
    personal: obj({ fullName: S('string'), title: S('string'), email: S('string'), phone: S('string'), location: S('string'), linkedin: S('string'), website: S('string'), github: S('string') }),
    summary: S('string'),
    experience: arr(obj({ role: S('string'), company: S('string'), location: S('string'), start: S('string'), end: S('string'), current: S('boolean'), bullets: strArr })),
    education: arr(obj({ school: S('string'), degree: S('string'), field: S('string'), location: S('string'), start: S('string'), end: S('string'), gpa: S('string'), details: S('string') })),
    skills: arr(obj({ category: S('string'), items: strArr })),
    projects: arr(obj({ name: S('string'), link: S('string'), tech: S('string'), start: S('string'), end: S('string'), bullets: strArr })),
    certifications: arr(obj({ name: S('string'), issuer: S('string'), date: S('string'), link: S('string') })),
    awards: arr(obj({ title: S('string'), issuer: S('string'), date: S('string'), description: S('string') })),
    languages: arr(obj({ name: S('string'), level: S('string') })),
    custom: arr(obj({ title: S('string'), items: arr(obj({ heading: S('string'), subheading: S('string'), date: S('string'), location: S('string'), bullets: strArr })) })),
    sectionOrder: strArr
  };
  const PARSE_SCHEMA = obj(RESUME_PROPS);
  const TAILOR_SCHEMA = obj(Object.assign({}, RESUME_PROPS, {
    changes: arr(obj({ section: S('string'), description: S('string') })),
    headlineSuggestion: S('string'),
    // Bullets that would be stronger with a real number, and the question
    // the candidate should answer to supply it. Never invented by the model.
    coaching: arr(obj({ where: S('string'), bullet: S('string'), question: S('string') }))
  }));

  /* Gemini's responseSchema accepts a subset of JSON Schema; drop the
     keywords it may reject and keep a stable property order. */
  function toGeminiSchema(node) {
    if (Array.isArray(node)) return node.map(toGeminiSchema);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    Object.keys(node).forEach(k => {
      if (k === 'additionalProperties') return;
      out[k] = toGeminiSchema(node[k]);
    });
    if (out.type === 'object' && out.properties) out.propertyOrdering = Object.keys(out.properties);
    return out;
  }

  const DATA_MODEL_NOTES = `Field conventions:
- Dates are short strings exactly as a resume would print them ("Jan 2021", "2019", "Present"). For experience, set current=true and end="" when the role is ongoing.
- experience.bullets, projects.bullets and custom items' bullets are arrays of plain sentences, one achievement each, no leading bullet characters.
- skills is an array of groups: {category, items[]}. Use the resume's own groupings if it has them; otherwise group sensibly (e.g. "Technical", "Tools", "Soft Skills"). Never leave a group empty.
- custom holds any section that is not one of the standard ones (Volunteering, Publications, Interests, Leadership, References...). Keep the original heading as title.
- sectionOrder lists the sections in the order they should appear, using these keys: summary, experience, education, skills, projects, certifications, awards, languages, and "custom:<title>" for each custom section. Include every non-empty section.
- Links are printed without "https://" (e.g. "linkedin.com/in/name").
- Use empty strings and empty arrays for anything not present. Never write "N/A", "Unknown" or placeholders.
- Return only the JSON object, with no surrounding prose or code fences.`;

  const OVERLOADED = /high demand|overloaded|try again later|resource.?exhausted|unavailable/i;
  const isBusy = (status, msg) => status === 503 || status === 429 || (status >= 500 && OVERLOADED.test(msg || ''));

  /* Try the chosen model, then the provider's fallback models, moving on
     only when a model is busy or missing. */
  async function withModelChain(label, args, chain, once) {
    const tried = [];
    let lastErr = null;
    for (const model of chain) {
      tried.push(model);
      try {
        // Full backoff on the chosen model; fallbacks get one quick retry so
        // the worst case stays short.
        const out = await once(Object.assign({}, args, { model, retries: model === args.model ? [1200, 2500] : [800] }));
        if (model !== args.model) out.fellBackFrom = args.model + ' model';
        return out;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        if (!(e.busy || e.status === 404)) throw e;
      }
    }
    const err = new Error(`${label} is busy on every model I tried (${tried.join(', ')}). Wait a minute and press Retry.`);
    err.busy = true;
    throw lastErr && !lastErr.busy ? lastErr : err;
  }
  /* Brief retries with backoff while a model is busy. */
  async function postWithRetries(post, body, detail, retries) {
    let res = await post(body);
    for (const wait of (retries || [1200, 2500])) {
      if (!isBusy(res.status, detail(res))) break;
      await new Promise(r => setTimeout(r, wait));
      res = await post(body);
    }
    return res;
  }
  const busyError = (res, label, detail) => { const e = httpError(res, label, detail); e.busy = true; e.status = res.status; return e; };

  /* ---------------- transport: Groq (OpenAI-compatible) ---------------- */
  const GROQ_FALLBACKS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  const GROQ_STRICT = /^openai\/gpt-oss|^qwen\//;   // models that enforce a JSON schema exactly

  function callGroq(args) {
    return withModelChain('Groq', args, [args.model].concat(GROQ_FALLBACKS.filter(m => m !== args.model)), callGroqOnce);
  }
  async function callGroqOnce({ key, model, system, user, schema, maxTokens, signal, retries }) {
    const url = apiBase('groq') + '/chat/completions';
    const base = {
      model, max_completion_tokens: maxTokens, temperature: 0.3,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    };
    const strict = GROQ_STRICT.test(model);
    // Try the schema first (strict where the model supports it), then plain JSON mode.
    const formats = [
      { type: 'json_schema', json_schema: { name: 'resume', strict, schema } },
      { type: 'json_object' }
    ];
    const post = fmt => send(url, {
      method: 'POST', signal,
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders('groq', key)),
      body: JSON.stringify(Object.assign({}, base, { response_format: fmt }))
    }, 'Groq');
    const detail = r => (r.json && r.json.error && (r.json.error.message || r.json.error)) ? String(r.json.error.message || r.json.error) : '';

    let res = await postWithRetries(post, formats[0], detail, retries);
    if (isBusy(res.status, detail(res))) throw busyError(res, 'Groq', detail(res));
    if (res.status === 404) { const e = httpError(res, 'Groq', detail(res)); e.status = 404; throw e; }
    if (res.status === 400) {
      // Schema not accepted by this model: fall back to JSON-object mode.
      const retry = await post(formats[1]);
      if (retry.ok) res = retry;
      else if (isBusy(retry.status, detail(retry))) throw busyError(retry, 'Groq', detail(retry));
      else throw httpError(res, 'Groq', detail(res) || detail(retry));
    }
    if (!res.ok) throw httpError(res, 'Groq', detail(res));
    const data = res.json;
    const choice = (data.choices || [])[0];
    if (!choice) throw new Error('Groq returned no result.');
    if (choice.finish_reason === 'length') throw new Error('The response was cut short. Try a shorter resume or job description, or pick a different model.');
    const text = (choice.message && choice.message.content || '').trim();
    if (!text) throw new Error('Groq returned no text.');
    const u = data.usage || {};
    return { text, usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 }, model: data.model || model };
  }

  /* ---------------- transport: Gemini ---------------- */
  /* The newest Flash is the most congested on the free tier; the Lite
     models usually answer immediately and are still good at this task. */
  const GEMINI_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];

  function callGemini(args) {
    return withModelChain('Gemini', args, [args.model].concat(GEMINI_FALLBACKS.filter(m => m !== args.model)), callGeminiOnce);
  }
  async function callGeminiOnce({ key, model, system, user, schema, maxTokens, signal, retries }) {
    // Gemini 3.x rejects temperature / topP / topK, so send neither those
    // nor any thinking config: the model defaults are what we want.
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
        maxOutputTokens: maxTokens
      }
    };
    const url = `${apiBase('gemini')}/models/${encodeURIComponent(model)}:generateContent`;
    const post = b => send(url, {
      method: 'POST', signal,
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders('gemini', key)),
      body: JSON.stringify(b)
    }, 'Gemini');
    const detail = r => (r.json && r.json.error && r.json.error.message) || '';

    let res = await postWithRetries(post, body, detail, retries);
    if (isBusy(res.status, detail(res))) throw busyError(res, 'Gemini', detail(res));
    if (res.status === 404) { const e = httpError(res, 'Gemini', detail(res)); e.status = 404; throw e; }
    // Some model versions reject the schema itself. Fall back to plain JSON
    // mode and lean on the prompt, rather than failing the whole request.
    if (!res.ok && (res.status === 400 || res.status >= 500)) {
      const noSchema = JSON.parse(JSON.stringify(body));
      delete noSchema.generationConfig.responseSchema;
      noSchema.systemInstruction.parts[0].text += '\n\nReturn a single JSON object matching the described fields exactly. Output nothing but that JSON.';
      const retry = await post(noSchema);
      if (retry.ok) res = retry;
      else if (isBusy(retry.status, detail(retry))) throw busyError(retry, 'Gemini', detail(retry));
      else throw httpError(res, 'Gemini', detail(res) || detail(retry));
    }
    if (!res.ok) throw httpError(res, 'Gemini', detail(res));
    const data = res.json;
    if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
    const cand = (data.candidates || [])[0];
    if (!cand) throw new Error('Gemini returned no result.');
    if (cand.finishReason === 'MAX_TOKENS') throw new Error('The response was cut short. Try a shorter resume or job description, or pick a different model.');
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw new Error('Gemini stopped for safety reasons. Try rewording the job description.');
    if (cand.finishReason === 'RECITATION') throw new Error('Gemini stopped because the output looked like recited text. Try again.');
    // Thinking models return reasoning parts alongside the answer; keep only the answer.
    const text = ((cand.content || {}).parts || []).filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
    if (!text) throw new Error('Gemini returned no text.');
    const u = data.usageMetadata || {};
    return { text, usage: { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0 }, model: data.modelVersion || model };
  }

  /* ---------------- shared HTTP helpers ---------------- */
  async function send(url, init, label) {
    let res;
    try { res = await fetch(url, init); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`Could not reach the ${label} API. Check your internet connection.`);
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* leave null */ }
    return { ok: res.ok, status: res.status, json };
  }
  function httpError(res, label, detail) {
    const d = detail ? ' ' + detail : '';
    if (res.status === 400 && /api[_ -]?key|API key not valid/i.test(detail)) return new Error(`The ${label} API key was rejected. Check it in AI settings.`);
    if (res.status === 400) return new Error(`${label} rejected the request.${d}`);
    if ((res.status === 401 || res.status === 403) && proxyOk) return new Error(`The site's ${label} key was rejected. The site owner needs to update it.${d}`);
    if (res.status === 401 || res.status === 403) return new Error(`The ${label} API key was rejected or lacks access to this model.${d}`);
    if (res.status === 404) return new Error(`That ${label} model was not found. Pick a different model in AI settings.${d}`);
    if (res.status === 429) return new Error(`${label} rate limit reached${label === 'Gemini' ? ' (free keys have low limits)' : ''}. Wait a moment and try again.`);
    // Keep the server's own wording on 5xx: it usually explains the cause.
    if (res.status >= 500) return new Error(`${label} server error (${res.status}).${d || ' Try again in a moment.'}`);
    return new Error(`${label} API error (${res.status}).${d}`);
  }
  function parseJson(text, label) {
    let t = String(text || '').trim();
    // Be forgiving if a model wraps the JSON in a code fence.
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); }
    catch (e) { throw new Error(`${label} returned something that was not valid JSON. Try again, or switch model in AI settings.`); }
  }

  const TRANSPORT = { groq: callGroq, gemini: callGemini };

  /* Run on the active provider; if it is busy everywhere and the other
     provider has a key, hand the same request to that one. */
  async function call(opts) {
    const cfg = load();
    const a = active(cfg);
    if (!a || !a.key) throw new Error('No AI key set. Open AI settings to add a free Groq or Gemini key.');
    const candidates = [a].concat(alternates(cfg));
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        const res = await TRANSPORT[c.provider](Object.assign({ key: c.key, model: c.model }, opts));
        return {
          data: parseJson(res.text, c.spec.name), usage: res.usage, model: res.model, provider: c.provider,
          providerName: c.spec.name,
          fellBackFrom: i > 0 ? `${a.spec.name} (${a.model})` : (res.fellBackFrom || '')
        };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        if (!e.busy) throw e;                 // a real error: do not mask it by switching provider
      }
    }
    throw lastErr;
  }

  /* ---------------- conversions ---------------- */
  function toState(ai, base) {
    const s = base ? JSON.parse(JSON.stringify(base)) : RB.defaultState();
    const str = v => (v == null ? '' : String(v)).trim();
    const lines = a => Array.isArray(a) ? a.map(str).filter(Boolean) : [];
    Object.keys(s.personal).forEach(k => { if (ai.personal && ai.personal[k] != null) s.personal[k] = str(ai.personal[k]); });
    s.summary = str(ai.summary);
    const keepId = (list, i, type) => (list && list[i] && list[i].id) ? list[i].id : RB.newItem(type).id;
    s.experience = (ai.experience || []).map((e, i) => ({ id: keepId(base && base.experience, i, 'experience'), role: str(e.role), company: str(e.company), location: str(e.location), start: str(e.start), end: e.current ? '' : str(e.end), current: !!e.current, bullets: lines(e.bullets) }));
    s.education = (ai.education || []).map((e, i) => ({ id: keepId(base && base.education, i, 'education'), school: str(e.school), degree: str(e.degree), field: str(e.field), location: str(e.location), start: str(e.start), end: str(e.end), gpa: str(e.gpa), details: str(e.details) }));
    s.skills = (ai.skills || []).filter(g => lines(g.items).length).map((g, i) => ({ id: keepId(base && base.skills, i, 'skills'), category: str(g.category), items: lines(g.items).join(', ') }));
    s.projects = (ai.projects || []).map((p, i) => ({ id: keepId(base && base.projects, i, 'projects'), name: str(p.name), link: str(p.link), tech: str(p.tech), start: str(p.start), end: str(p.end), bullets: lines(p.bullets) }));
    s.certifications = (ai.certifications || []).map((c, i) => ({ id: keepId(base && base.certifications, i, 'certifications'), name: str(c.name), issuer: str(c.issuer), date: str(c.date), link: str(c.link) }));
    s.awards = (ai.awards || []).map((a, i) => ({ id: keepId(base && base.awards, i, 'awards'), title: str(a.title), issuer: str(a.issuer), date: str(a.date), description: str(a.description) }));
    s.languages = (ai.languages || []).map((l, i) => ({ id: keepId(base && base.languages, i, 'languages'), name: str(l.name), level: str(l.level) }));
    const titleToId = {};
    s.custom = (ai.custom || []).filter(c => str(c.title)).map((c, i) => {
      const prev = base && base.custom[i];
      const id = prev ? prev.id : RB.uid();
      titleToId[str(c.title).toLowerCase()] = id;
      return { id, title: str(c.title), items: (c.items || []).map((it, j) => ({ id: prev && prev.items[j] ? prev.items[j].id : RB.uid(), heading: str(it.heading), subheading: str(it.subheading), date: str(it.date), location: str(it.location), bullets: lines(it.bullets) })) };
    });
    const order = [];
    (ai.sectionOrder || []).forEach(k => {
      k = str(k);
      if (k.startsWith('custom:')) { const id = titleToId[k.slice(7).trim().toLowerCase()]; if (id) order.push('custom:' + id); }
      else if (RB.DEFAULT_ORDER.includes(k)) order.push(k);
    });
    s.custom.forEach(c => { if (!order.includes('custom:' + c.id)) order.push('custom:' + c.id); });
    RB.DEFAULT_ORDER.forEach(k => { if (!order.includes(k)) order.push(k); });
    s.sectionOrder = Array.from(new Set(order));
    if (base) s.hiddenSections = base.hiddenSections.filter(k => s.sectionOrder.includes(k));
    return RB.normalize(s);
  }
  function fromState(state) {
    return {
      personal: state.personal, summary: state.summary,
      experience: state.experience.map(e => ({ role: e.role, company: e.company, location: e.location, start: e.start, end: e.current ? '' : e.end, current: !!e.current, bullets: (e.bullets || []).filter(b => b.trim()) })),
      education: state.education.map(({ id, ...e }) => e),
      skills: state.skills.map(g => ({ category: g.category, items: g.items.split(',').map(x => x.trim()).filter(Boolean) })),
      projects: state.projects.map(p => ({ name: p.name, link: p.link, tech: p.tech, start: p.start, end: p.end, bullets: (p.bullets || []).filter(b => b.trim()) })),
      certifications: state.certifications.map(({ id, ...c }) => c),
      awards: state.awards.map(({ id, ...a }) => a),
      languages: state.languages.map(({ id, ...l }) => l),
      custom: state.custom.map(c => ({ title: c.title, items: c.items.map(it => ({ heading: it.heading, subheading: it.subheading, date: it.date, location: it.location, bullets: (it.bullets || []).filter(b => b.trim()) })) })),
      sectionOrder: state.sectionOrder.map(k => k.startsWith('custom:') ? 'custom:' + ((state.custom.find(c => 'custom:' + c.id === k) || {}).title || '') : k)
    };
  }

  /* ---------------- 1. parse ---------------- */
  async function parseResume(text, opts = {}) {
    const system = `You convert the raw text of a resume into structured data. Be faithful: copy wording, numbers and dates as written, fix only obvious text-extraction artifacts (broken words, stray line breaks, duplicated spaces). Do not rewrite, summarise, invent or drop content. Separate a line like "Company, City, ST" into company and location. If a section heading is unusual, map it to the closest standard section or keep it as a custom section with its original heading. If text cannot be placed anywhere, put it in a custom section called "Additional Information".\n\n${DATA_MODEL_NOTES}`;
    const user = `Resume text (extracted from a ${opts.fileName || 'file'}):\n\n<resume>\n${text}\n</resume>`;
    const { data, usage, provider, providerName: pname } = await call({ system, user, schema: PARSE_SCHEMA, effort: 'medium', maxTokens: 24000, signal: opts.signal });
    return { state: toState(data, null), usage, provider, providerName: pname };
  }

  /* ---------------- 2. tailor ---------------- */
  async function tailorResume(state, jd, opts = {}) {
    const system = `You are an expert resume writer and applicant-tracking-system (ATS) specialist. You receive a candidate's resume as structured data and a job description. Rewrite the resume so it is the strongest honest match for that job.

How recruiters actually read this (base every decision on it):
- Applicant tracking systems do not score resumes; recruiters run literal keyword searches on them. "Backend Developer" will not be found by a search for "Backend Engineer", and "AWS" will not be found by a search for "Amazon Web Services". So mirror the posting's exact wording, and the first time an acronym or its expansion appears, write both: "Amazon Web Services (AWS)".
- The human scan takes about seven seconds and lands on: headline, most recent title and company, dates, then the first bullet of each role. Make those carry the match.
- Two pages is fine for 7+ years of experience; do not compress a strong career into one page, and do not pad a short one.

What to do:
- Summary: rewrite into 2-4 sentences that mirror the posting's language and priorities, lead with the candidate's most relevant experience, and include one or two of their real quantified results. Implied first person, no "I".
- Bullets: rewrite each experience and project bullet as verb + what you did + measurable result, opening with a strong past-tense action verb (never "Responsible for", "Helped", "Worked on"). Use the posting's terminology where the underlying work genuinely matches. One or two lines each. Put the most relevant bullet first in every role. Aim for 3-6 bullets on recent roles and 1-3 on older ones; do not add bullets that are not supported by the input.
- Skills: reorder items and groups so the posting's requirements come first, and phrase each skill exactly as the posting does. You may add a skill only if the resume clearly demonstrates it somewhere (a bullet, a project, a certification). Remove nothing.
- Headline (personal.title): set it to the posting's exact job title if the candidate's background plausibly fits that title; otherwise keep the current title. Put the title you considered in headlineSuggestion either way.
- Dates: keep the meaning but normalise the format to "Mon YYYY" (e.g. "Mar 2021") or "YYYY" where only a year is known; use "Present" for a current role.
- Keep the candidate's own section order unless a different order clearly serves the posting (e.g. put Projects before Experience for a career changer).

Hard rules:
- Never invent employers, job titles, dates, degrees, certifications, tools, metrics or responsibilities. Every number in the output must already appear in the input. If a bullet has no number, do not add one; instead list it under "coaching".
- Keep the same positions and education entries, in the same order, with the same companies, titles and dates. You may not merge, drop or add positions.
- Keep certifications, awards, languages and custom sections factually unchanged (light wording clean-up is fine).
- Do not stuff keywords. A keyword may only be used where the work described actually involved it, and covering roughly 75-80% of the posting's terms naturally beats forcing 100%. Never repeat a term more often than the work justifies.
- Plain text only, no markdown, no bullet characters inside strings.

Also return:
- "changes": up to 12 short plain-English lines describing what you changed and why, each with the section it applies to (e.g. section "Summary", description "Rewritten to lead with 7 years of B2B growth marketing and the 140% pipeline result the posting emphasises."). Mention explicitly if you decided NOT to change the headline.
- "coaching": for up to 6 rewritten bullets that still have no number, the role or project it sits under ("where"), the bullet text exactly as you wrote it ("bullet"), and one concrete question whose answer would supply the metric ("question", e.g. "How many stores used this forecast, and by what percentage did stock-outs fall?"). Empty array if every bullet already has a number.

${DATA_MODEL_NOTES}`;
    const user = `<job_description>\n${jd}\n</job_description>\n\n<resume_json>\n${JSON.stringify(fromState(state), null, 1)}\n</resume_json>\n\nReturn the rewritten resume.`;
    const { data, usage, model, provider, providerName: pname, fellBackFrom } = await call({ system, user, schema: TAILOR_SCHEMA, effort: 'high', maxTokens: 32000, signal: opts.signal });
    const next = toState(data, state);
    const changes = (data.changes || []).map(c => ({ text: `${c.section ? c.section + ': ' : ''}${c.description}` }));
    const coaching = (data.coaching || []).filter(c => c && c.question).map(c => ({ where: String(c.where || ''), bullet: String(c.bullet || ''), question: String(c.question) }));
    return { state: next, changes, coaching, headlineSuggestion: data.headlineSuggestion || '', usage, model, provider, providerName: pname, fellBackFrom };
  }

  /* ---------------- settings helpers ---------------- */
  /* Test one provider's key on its own (no fallback to the other), so the
     dialog reports on exactly what was typed. */
  async function test(provider, key, model) {
    const prev = load();
    const next = JSON.parse(JSON.stringify(prev));
    next.provider = provider; next[provider].key = key; next[provider].model = model;
    save(next);
    try {
      // Thinking models spend part of maxOutputTokens on reasoning, so keep this generous.
      const res = await TRANSPORT[provider]({ key, model, system: 'Reply with the requested JSON only.', user: 'Return {"ok": true}.', schema: obj({ ok: S('boolean') }), effort: 'low', maxTokens: 8192 });
      return !!parseJson(res.text, PROVIDERS[provider].name).ok;
    } finally {
      save(prev);   // the dialog saves for real only when Save is pressed
    }
  }

  /* Live model list, so the dropdown never goes stale. */
  async function listModels(provider, key) {
    if (!key) return null;
    const spec = PROVIDERS[provider];
    if (provider === 'gemini') {
      const res = await send(apiBase('gemini') + '/models?pageSize=200', { headers: authHeaders('gemini', key) }, 'Gemini');
      if (!res.ok) throw httpError(res, 'Gemini', (res.json && res.json.error && res.json.error.message) || '');
      return (res.json.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name || ''))
        .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || String(m.name || '').replace(/^models\//, ''), note: '' }))
        .filter(m => m.id && !/embedding|aqa|imagen|veo|tts|image-generation|native-audio|live-/i.test(m.id))
        .sort((a, b) => rank(spec, a.id) - rank(spec, b.id) || a.id.localeCompare(b.id));
    }
    const res = await send(apiBase('groq') + '/models', { headers: authHeaders('groq', key) }, 'Groq');
    if (!res.ok) throw httpError(res, 'Groq', (res.json && res.json.error && res.json.error.message) || '');
    return (res.json.data || [])
      .map(m => String(m.id || ''))
      .filter(id => id && !/whisper|tts|guard|safeguard|compound|embed|vision|orpheus|playai/i.test(id))
      .map(id => spec.models.find(m => m.id === id) || { id, name: id, note: '' })
      .sort((a, b) => rank(spec, a.id) - rank(spec, b.id) || a.id.localeCompare(b.id));
  }

  window.AI = { PROVIDERS, PROVIDER_LIST, load, save, active, alternates, isConfigured, isBuiltIn, usingProxy, ready, providerName, parseResume, tailorResume, test, listModels, pickBest };
})();
