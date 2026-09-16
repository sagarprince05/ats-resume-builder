/* =====================================================================
   AI layer. Two jobs:
     1. parseResume(text)       - raw resume text -> structured fields
     2. tailorResume(state, jd) - rewrite the resume for a job description
   One provider, Groq, called straight from the browser through its
   OpenAI-compatible chat endpoint and asked for schema-constrained JSON
   so the reply always fits our data model.
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
    }
  };
  const PROVIDER_LIST = [PROVIDERS.groq];

  /* ---------------- settings ---------------- */
  function blank() {
    return {
      provider: 'groq',
      groq: { key: '', model: PROVIDERS.groq.defaultModel },
      useForParse: true
    };
  }
  function load() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const cfg = blank();
    // Settings saved by older builds may hold other providers; only the
    // Groq entry is kept.
    if (raw.groq && typeof raw.groq === 'object') Object.assign(cfg.groq, { key: String(raw.groq.key || ''), model: String(raw.groq.model || cfg.groq.model) });
    if (typeof raw.useForParse === 'boolean') cfg.useForParse = raw.useForParse;
    if (BUILT_IN) cfg.useForParse = true;   // nothing to configure, so use it everywhere
    // Drop model IDs Groq has since retired, so an old saved setting
    // cannot leave the app permanently broken.
    if (PROVIDERS.groq.dead.test(cfg.groq.model)) cfg.groq.model = PROVIDERS.groq.defaultModel;
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

  /* Where Groq is reached. Direct from the browser by default; a hosted
     copy can instead point at a relay on the same site (APP_CONFIG.groqProxy,
     e.g. '/api/groq') that adds the key server-side, so no key ever
     reaches the browser. */
  const GROQ_DIRECT = 'https://api.groq.com/openai/v1';
  const PROXY = String((window.APP_CONFIG || {}).groqProxy || '').trim().replace(/\/+$/, '');
  let proxyOk = !!PROXY;      // flipped off if the relay turns out to be missing
  function apiBase() { return proxyOk ? PROXY : GROQ_DIRECT; }
  function authHeaders(key) { return proxyOk ? {} : { 'authorization': 'Bearer ' + key }; }
  function usingProxy() { return proxyOk; }

  /* If the page was deployed somewhere without the relay (plain static
     hosting), fall back to per-user keys instead of failing every call. */
  const ready = (async function () {
    if (!PROXY) return;
    try {
      const r = await fetch(PROXY + '/health', { cache: 'no-store' });
      const j = r.ok ? await r.json().catch(() => null) : null;
      proxyOk = !!(j && j.ok);
    } catch (e) { proxyOk = false; }
    if (!proxyOk) window.dispatchEvent(new Event('ai-config-changed'));
  })();

  /* Key baked in at build time, or a relay on the server. Either way the
     app uses it silently and hides every API-key control. */
  const BUILT_IN = (function () {
    const c = window.APP_CONFIG || {};
    const key = String(c.groqKey || '').trim();
    if (!key) return null;
    return { key, model: String(c.groqModel || '').trim() || PROVIDERS.groq.defaultModel };
  })();
  function isBuiltIn() { return !!BUILT_IN || proxyOk; }

  function active(cfg) {
    if (proxyOk) return { provider: 'groq', spec: PROVIDERS.groq, key: 'relay', model: String((window.APP_CONFIG || {}).groqModel || '').trim() || PROVIDERS.groq.defaultModel, builtIn: true, proxy: true };
    if (BUILT_IN) return { provider: 'groq', spec: PROVIDERS.groq, key: BUILT_IN.key, model: BUILT_IN.model, builtIn: true };
    cfg = cfg || load();
    return { provider: 'groq', spec: PROVIDERS.groq, key: cfg.groq.key, model: cfg.groq.model };
  }
  function isConfigured() { return !!active().key; }
  function providerName() { const a = active(); return a.spec ? a.spec.name : ''; }

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

  /* ---------------- transport: Groq (OpenAI-compatible) ---------------- */
  const GROQ_FALLBACKS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  const GROQ_STRICT = /^openai\/gpt-oss|^qwen\//;   // models that enforce a JSON schema exactly

  async function callGroq(args) {
    const chain = [args.model].concat(GROQ_FALLBACKS.filter(m => m !== args.model));
    const tried = [];
    let lastErr = null;
    for (const model of chain) {
      tried.push(model);
      try {
        const out = await callGroqOnce(Object.assign({}, args, { model, retries: model === args.model ? [1200, 2500] : [800] }));
        if (model !== args.model) out.fellBackFrom = args.model;
        return out;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        if (!(e.busy || e.status === 404)) throw e;
      }
    }
    const err = new Error(`Groq is busy on every model I tried (${tried.join(', ')}). Wait a minute and press Retry.`);
    err.busy = true;
    throw lastErr && !lastErr.busy ? lastErr : err;
  }

  async function callGroqOnce({ key, model, system, user, schema, maxTokens, signal, retries }) {
    const url = apiBase() + '/chat/completions';
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
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders(key)),
      body: JSON.stringify(Object.assign({}, base, { response_format: fmt }))
    }, 'Groq');
    const detail = r => (r.json && r.json.error && (r.json.error.message || r.json.error)) ? String(r.json.error.message || r.json.error) : '';

    let res = await post(formats[0]);
    for (const wait of (retries || [1200, 2500])) {
      if (!isBusy(res.status, detail(res))) break;
      await new Promise(r => setTimeout(r, wait));
      res = await post(formats[0]);
    }
    if (isBusy(res.status, detail(res))) { const e = httpError(res, 'Groq', detail(res)); e.busy = true; e.status = res.status; throw e; }
    if (res.status === 404) { const e = httpError(res, 'Groq', detail(res)); e.status = 404; throw e; }
    if (res.status === 400) {
      // Schema not accepted by this model: fall back to JSON-object mode.
      const retry = await post(formats[1]);
      if (retry.ok) res = retry;
      else if (isBusy(retry.status, detail(retry))) { const e = httpError(retry, 'Groq', detail(retry)); e.busy = true; e.status = retry.status; throw e; }
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
    if (res.status === 429) return new Error(`${label} rate limit reached. Wait a moment and try again.`);
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

  async function call(opts) {
    const a = active();
    if (!a.key) throw new Error('No Groq API key set. Open AI settings to add one.');
    const res = await callGroq(Object.assign({ key: a.key, model: a.model }, opts));
    return {
      data: parseJson(res.text, 'Groq'), usage: res.usage, model: res.model, provider: 'groq',
      providerName: PROVIDERS.groq.name, fellBackFrom: res.fellBackFrom || ''
    };
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
  async function test(provider, key, model) {
    const prev = load();
    const next = JSON.parse(JSON.stringify(prev));
    next.groq.key = key; next.groq.model = model;
    save(next);
    try {
      // Thinking models spend part of maxOutputTokens on reasoning, so keep this generous.
      const { data } = await call({ system: 'Reply with the requested JSON only.', user: 'Return {"ok": true}.', schema: obj({ ok: S('boolean') }), effort: 'low', maxTokens: 8192 });
      return !!data.ok;
    } catch (e) {
      save(prev);
      throw e;
    }
  }

  /* Live model list, so the dropdown never goes stale. */
  async function listModels(provider, key) {
    if (!key) return null;
    const res = await send(apiBase() + '/models', { headers: authHeaders(key) }, 'Groq');
    if (!res.ok) throw httpError(res, 'Groq', (res.json && res.json.error && res.json.error.message) || '');
    return (res.json.data || [])
      .map(m => String(m.id || ''))
      .filter(id => id && !/whisper|tts|guard|safeguard|compound|embed|vision|orpheus|playai/i.test(id))
      .map(id => PROVIDERS.groq.models.find(m => m.id === id) || { id, name: id, note: '' })
      .sort((a, b) => rank(PROVIDERS.groq, a.id) - rank(PROVIDERS.groq, b.id) || a.id.localeCompare(b.id));
  }

  window.AI = { PROVIDERS, PROVIDER_LIST, load, save, active, isConfigured, isBuiltIn, usingProxy, ready, providerName, parseResume, tailorResume, test, listModels, pickBest };
})();
