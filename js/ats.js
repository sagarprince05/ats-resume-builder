/* =====================================================================
   ATS analysis: rule-based checks for contact info, content quality,
   formatting/length, and keyword match against a job description.
   Exposes window.ATS
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const clean = s => String(s == null ? '' : s).trim();

  const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the to was were will with you your we our ' +
    'this these those they them their there here than then also into onto over under about above across after before during within without ' +
    'up down out off again further once all any both each few more most other some such no nor not only own same so too very can just should ' +
    'now do does did doing done being been had having he she his her him who whom which what when where why how if but because while until ' +
    'ability able strong excellent good great new role position job candidate candidates team teams work working works worked experience ' +
    'experienced years year including include includes required requirements requirement preferred plus etc must may might would could ' +
    'responsibilities responsibility responsible duties duty environment company opportunity opportunities benefits salary equal employer ' +
    'apply applicants applicant qualified qualification qualifications degree bachelor bachelors master masters related field fields ' +
    'knowledge understanding familiarity familiar skills skill proficiency proficient background looking seeking seek join help support ' +
    'ensure provide provides develop develops development maintain manage manages managing make makes making per day days time using use ' +
    'used based across through well high level levels senior junior lead like need needs needed want wants get one two three us via ' +
    'ideal ideally successful success business businesses customer customers client clients product products service services solution ' +
    'solutions best practices practice various multiple range wide within between key part member members people person individuals ' +
    'individual etc hybrid remote onsite office location full part-time full-time contract year years month months week weeks').split(/\s+/));

  const SKILL_PHRASES = ['python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'golang', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'sql', 'nosql',
    'html', 'css', 'react', 'angular', 'vue', 'next.js', 'node.js', 'express', 'django', 'flask', 'spring', 'spring boot', '.net', 'graphql', 'rest api', 'rest apis',
    'microservices', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'google cloud', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'git', 'github', 'gitlab', 'linux',
    'bash', 'powershell', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'kafka', 'rabbitmq', 'spark', 'hadoop', 'airflow', 'snowflake', 'databricks',
    'tableau', 'power bi', 'excel', 'machine learning', 'deep learning', 'nlp', 'computer vision', 'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy',
    'data analysis', 'data engineering', 'data science', 'etl', 'agile', 'scrum', 'kanban', 'jira', 'confluence', 'project management', 'product management',
    'stakeholder management', 'leadership', 'communication', 'problem solving', 'mentoring', 'figma', 'ui/ux', 'user experience', 'accessibility', 'seo',
    'salesforce', 'hubspot', 'sap', 'oracle', 'unit testing', 'test automation', 'tdd', 'selenium', 'cypress', 'jest', 'playwright', 'security', 'oauth',
    'devops', 'sre', 'observability', 'monitoring', 'prometheus', 'grafana', 'datadog', 'budgeting', 'forecasting', 'marketing', 'crm', 'negotiation',
    'customer service', 'sales', 'recruiting', 'onboarding', 'training', 'compliance', 'gdpr', 'hipaa', 'six sigma', 'lean', 'supply chain', 'logistics',
    'financial modeling', 'financial analysis', 'accounting', 'quickbooks', 'auditing', 'copywriting', 'content strategy', 'social media', 'google analytics',
    'a/b testing', 'matlab', 'autocad', 'solidworks', 'photoshop', 'illustrator', 'system design', 'distributed systems', 'cloud computing', 'api design',
    'data modeling', 'data visualization', 'statistics', 'r', 'sas', 'spss', 'public speaking', 'cross-functional', 'roadmap', 'okrs', 'kpis', 'go-to-market',
    'user research', 'wireframing', 'prototyping', 'design systems', 'branding', 'email marketing', 'paid media', 'ppc', 'sem', 'lead generation',
    'account management', 'client relations', 'contract negotiation', 'vendor management', 'risk management', 'change management', 'process improvement',
    'quality assurance', 'regulatory', 'clinical', 'patient care', 'nursing', 'teaching', 'curriculum', 'research', 'grant writing', 'fundraising'];

  /* Soft skills are matched and reported separately, the way Jobscan and
     Enhancv do, because recruiters weigh them differently from tools. */
  const SOFT_SKILLS = ['leadership', 'communication', 'problem solving', 'problem-solving', 'mentoring', 'collaboration', 'teamwork', 'time management',
    'adaptability', 'attention to detail', 'critical thinking', 'stakeholder management', 'presentation', 'presentation skills', 'negotiation',
    'public speaking', 'cross-functional', 'cross-functional collaboration', 'decision making', 'decision-making', 'organization', 'organizational skills',
    'interpersonal', 'interpersonal skills', 'creativity', 'initiative', 'ownership', 'accountability', 'coaching', 'conflict resolution', 'empathy',
    'customer focus', 'analytical', 'analytical skills', 'strategic thinking', 'prioritization', 'self-motivated', 'work independently', 'fast-paced',
    'multitasking', 'written communication', 'verbal communication', 'relationship building', 'influencing', 'facilitation', 'active listening'];
  const SOFT_SET = new Set(SOFT_SKILLS);

  /* Recruiters search literally, so "AWS" does not find "Amazon Web
     Services". Treat these pairs as equivalent when matching, and tell the
     AI to write both forms. */
  const SYNONYMS = [
    ['aws', 'amazon web services'], ['gcp', 'google cloud', 'google cloud platform'], ['ml', 'machine learning'], ['ai', 'artificial intelligence'],
    ['ci/cd', 'continuous integration', 'continuous delivery', 'continuous deployment'], ['k8s', 'kubernetes'], ['js', 'javascript'], ['ts', 'typescript'],
    ['seo', 'search engine optimization', 'search engine optimisation'], ['sem', 'search engine marketing'], ['crm', 'customer relationship management'],
    ['qa', 'quality assurance'], ['ui', 'user interface'], ['ux', 'user experience'], ['ui/ux', 'ui ux', 'user interface and user experience'],
    ['api', 'apis', 'application programming interface'], ['rest api', 'rest apis', 'restful api', 'restful apis', 'restful'], ['nlp', 'natural language processing'],
    ['etl', 'extract transform load'], ['kpi', 'kpis', 'key performance indicators'], ['okr', 'okrs', 'objectives and key results'], ['b2b', 'business to business', 'business-to-business'],
    ['b2c', 'business to consumer', 'business-to-consumer'], ['saas', 'software as a service', 'software-as-a-service'], ['pm', 'project management'],
    ['tdd', 'test driven development', 'test-driven development'], ['oop', 'object oriented programming', 'object-oriented programming'],
    ['sql server', 'mssql', 'microsoft sql server'], ['postgres', 'postgresql'], ['mongo', 'mongodb'], ['node', 'node.js', 'nodejs'], ['react.js', 'react', 'reactjs'],
    ['vue.js', 'vue', 'vuejs'], ['next', 'next.js', 'nextjs'], ['dotnet', '.net'], ['golang', 'go'], ['ga4', 'google analytics 4', 'google analytics'],
    ['ppc', 'pay per click', 'pay-per-click'], ['sla', 'service level agreement'], ['hr', 'human resources'], ['p&l', 'profit and loss', 'profit & loss'],
    ['ms office', 'microsoft office'], ['ms excel', 'microsoft excel', 'excel'], ['powerpoint', 'ms powerpoint', 'microsoft powerpoint'],
    ['gen ai', 'genai', 'generative ai'], ['llm', 'llms', 'large language models', 'large language model'], ['rag', 'retrieval augmented generation', 'retrieval-augmented generation']
  ];
  const SYN_INDEX = new Map();
  SYNONYMS.forEach(group => group.forEach(t => SYN_INDEX.set(t, group)));
  function variants(term) { return SYN_INDEX.get(term.toLowerCase()) || [term]; }
  /* Count occurrences of a term or any of its synonyms in normalised text. */
  function countAny(normText, term) {
    let n = 0;
    variants(term).forEach(v => {
      const re = new RegExp('(^|[^a-z0-9])' + escapeRe(v.toLowerCase().replace(/\s+/g, ' ')) + '([^a-z0-9]|$)', 'g');
      const m = normText.match(re); if (m) n += m.length;
    });
    return n;
  }

  /* Openers that recruiters and the Resume Worded / Rezi checkers flag as weak. */
  const WEAK_OPENERS = /^(responsible for|responsibilities included|duties included|helped|assisted|assisted with|worked on|worked with|involved in|participated in|tasked with|was|were|part of|member of|handled|dealt with|in charge of|supported)\b/i;
  const PASSIVE = /\b(was|were|been|being|is|are)\s+(\w+ed|built|made|given|taken|led|run|set|put|held|won|done|seen|shown|known|grown|driven|written|chosen)\b/i;
  const VAGUE = /\b(various|several|many|numerous|multiple|some|a number of|a range of|things|stuff|etc\.?)\b/i;

  const BUZZWORDS = ['team player', 'hard worker', 'hard-working', 'synergy', 'go-getter', 'think outside the box', 'results-driven', 'results driven', 'detail-oriented', 'detail oriented',
    'self-starter', 'self starter', 'go-to person', 'dynamic', 'guru', 'ninja', 'rockstar', 'passionate', 'motivated', 'proactive', 'excellent communication skills',
    'responsible for', 'duties included', 'references available', 'seasoned', 'best of breed', 'value add', 'thought leader', 'strategic thinker'];

  const STANDARD_HEADINGS = ['summary', 'professional summary', 'profile', 'about', 'experience', 'work experience', 'professional experience', 'employment', 'employment history',
    'education', 'skills', 'technical skills', 'core competencies', 'projects', 'certifications', 'licenses', 'licenses & certifications', 'awards', 'awards & honors', 'honors',
    'languages', 'volunteering', 'volunteer experience', 'publications', 'interests', 'additional information', 'leadership', 'activities', 'training', 'references'];

  function norm(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[–—]/g, '-').replace(/[^a-z0-9+#./ -]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function contains(normText, phrase) {
    const p = phrase.toLowerCase().replace(/\s+/g, ' ');
    return new RegExp('(^|[^a-z0-9])' + escapeRe(p) + '([^a-z0-9]|$)').test(normText);
  }

  /* ---------- keyword extraction from a job description ---------- */
  function extractKeywords(jd, max = 30) {
    const text = norm(jd);
    if (text.trim().length < 20) return [];
    const scores = new Map();
    const bump = (k, v) => scores.set(k, (scores.get(k) || 0) + v);

    // Curated skill phrases present in the JD score highest.
    SKILL_PHRASES.forEach(p => { if (contains(text, p)) bump(p, 3); });
    SOFT_SKILLS.forEach(p => { if (contains(text, p)) bump(p, 2.5); });
    // Multi-word synonym forms ("amazon web services") would never survive the
    // bigram scan below, so look for every variant and credit the form the
    // posting actually used.
    SYNONYMS.forEach(group => {
      const used = group.find(v => contains(text, v));
      if (used) bump(used, 3);
    });

    // Single tokens and bigrams by frequency.
    const tokens = text.trim().split(' ').map(t => t.replace(/^[./-]+|[./-]+$/g, '')).filter(t => t && t.length > 1 && !/^\d+$/.test(t));
    const isGood = t => !STOP.has(t) && /[a-z]/.test(t);
    tokens.forEach((t, i) => {
      if (isGood(t)) bump(t, 1);
      const n = tokens[i + 1];
      if (n && isGood(t) && isGood(n)) bump(t + ' ' + n, 1.6);
    });

    // Remove single words that only ever appear inside a stronger bigram / skill phrase.
    const entries = Array.from(scores.entries()).filter(([k, v]) => v >= 2 || SKILL_PHRASES.includes(k) || SOFT_SET.has(k));
    entries.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    const chosen = [];
    const seenGroup = new Set();
    for (const [k] of entries) {
      if (chosen.some(c => c !== k && (c.includes(' ') && c.split(' ').includes(k)))) continue; // "power bi" already covers "bi"
      if (chosen.some(c => k.includes(' ') && k.split(' ').every(w => chosen.includes(w)))) {
        // keep the bigram, drop the pieces
        chosen.splice(0, chosen.length, ...chosen.filter(c => !k.split(' ').includes(c)));
      }
      // One entry per synonym group ("aws" and "amazon web services" are the same keyword).
      const g = SYN_INDEX.get(k); const gk = g ? g[0] : null;
      if (gk) { if (seenGroup.has(gk)) continue; seenGroup.add(gk); }
      chosen.push(k);
      if (chosen.length >= max) break;
    }
    // Drop any phrase wholly contained in a longer chosen phrase
    // ("cross-functional" inside "cross-functional collaboration").
    return chosen.filter(k => !chosen.some(o => o !== k && o.length > k.length && contains(' ' + o + ' ', k)));
  }

  /* Rich keyword report: hard vs soft, with how often each appears in the
     resume and in the posting. */
  function keywordReport(jd, resumeText) {
    const kws = extractKeywords(jd, 40);
    const jdN = norm(jd), resN = norm(resumeText);
    const rows = kws.map(k => ({
      term: k,
      type: SOFT_SET.has(k) ? 'soft' : 'hard',
      inResume: countAny(resN, k),
      inJd: Math.max(1, countAny(jdN, k)),
      synonyms: variants(k).filter(v => v !== k)
    })).map(r => Object.assign(r, { matched: r.inResume > 0 }));
    const hard = rows.filter(r => r.type === 'hard'), soft = rows.filter(r => r.type === 'soft');
    const pct = list => list.length ? Math.round(list.filter(r => r.matched).length / list.length * 100) : 0;
    const matched = rows.filter(r => r.matched), missing = rows.filter(r => !r.matched);
    // Stuffing: near-total coverage, or a term hammered far beyond how the
    // posting uses it. Four mentions of a core skill across two pages is normal.
    const overused = rows.filter(r => r.inResume >= 6 && r.inResume > r.inJd * 4).map(r => r.term);
    const stuffing = (rows.length >= 8 && pct(rows) > 92) || overused.length > 0;
    return {
      all: rows.map(r => r.term), matched: matched.map(r => r.term), missing: missing.map(r => r.term),
      pct: pct(rows), hard, soft, hardPct: pct(hard), softPct: pct(soft), stuffing, overused, rows
    };
  }

  /* Line-by-line critique of bullets, in the spirit of Resume Worded and
     Rezi's real-time checks. Returns only bullets with something to fix. */
  function lintBullets(state) {
    const out = [];
    const check = (where, text) => {
      const b = clean(text); if (!b) return;
      const flags = [];
      const words = b.split(/\s+/);
      const first = words[0].toLowerCase().replace(/[^a-z]/g, '');
      if (WEAK_OPENERS.test(b)) flags.push({ id: 'weak', label: 'Weak opener', tip: 'Start with what you did: "Led", "Built", "Cut"…' });
      else if (!RB.ACTION_VERB_SET.has(first)) flags.push({ id: 'verb', label: 'No action verb', tip: 'Open with a strong past-tense verb.' });
      if (!/\d/.test(b) && !/\b(percent|million|thousand|billion|dozen|hundred|double|triple|half)\b/i.test(b)) flags.push({ id: 'metric', label: 'No number', tip: 'Add a result: %, $, time saved, users, team size.' });
      if (/\b(i|me|my|mine|we|our|us)\b/i.test(b)) flags.push({ id: 'pronoun', label: 'Pronoun', tip: 'Drop "I / we / my"; resumes use implied first person.' });
      // Only the main clause matters; "…3 were promoted" later in a bullet is fine.
      if (PASSIVE.test(words.slice(0, 7).join(' '))) flags.push({ id: 'passive', label: 'Passive voice', tip: 'Say who did it: "Built X" not "X was built".' });
      if (VAGUE.test(b)) flags.push({ id: 'vague', label: 'Vague', tip: 'Replace "various / several" with the actual count or names.' });
      if (words.length > 32) flags.push({ id: 'long', label: 'Too long', tip: 'Keep to one or two lines (under ~30 words).' });
      else if (words.length < 5) flags.push({ id: 'short', label: 'Too short', tip: 'Add the task and the result.' });
      if (flags.length) out.push({ where, text: b, flags });
    };
    (state.experience || []).forEach(e => (e.bullets || []).forEach(b => check(clean(e.role) || clean(e.company) || 'Experience', b)));
    (state.projects || []).forEach(p => (p.bullets || []).forEach(b => check(clean(p.name) || 'Project', b)));
    return out;
  }

  /* ---------- analysis ---------- */
  function analyze(state, jd, opts = {}) {
    const checks = [];
    const add = (group, id, label, status, detail, weight) => checks.push({ group, id, label, status, detail, weight });
    const P = 'pass', W = 'warn', F = 'fail';
    const p = state.personal;
    const text = window.Preview.toText(state);
    const ntext = norm(text);
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const visible = key => !state.hiddenSections.includes(key);

    // ----- Contact & basics -----
    const G1 = 'Contact & basics';
    if (!clean(p.fullName)) add(G1, 'name', 'Full name', F, 'Add your full name at the top of the resume.', 6);
    else add(G1, 'name', 'Full name', P, 'Present.', 6);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(p.email));
    if (!clean(p.email)) add(G1, 'email', 'Email address', F, 'Recruiters and ATS parsers look for an email address in the header.', 6);
    else if (!emailOk) add(G1, 'email', 'Email address', W, `"${clean(p.email)}" does not look like a valid email.`, 6);
    else if (/\b(hotmail|aol|yahoo)\./i.test(p.email) || /\d{4,}/.test(p.email.split('@')[0])) add(G1, 'email', 'Email address', W, 'Valid, but consider a simple firstname.lastname style address on a modern provider.', 6);
    else add(G1, 'email', 'Email address', P, 'Valid and professional.', 6);

    const digits = clean(p.phone).replace(/\D/g, '');
    if (!digits) add(G1, 'phone', 'Phone number', F, 'Add a phone number.', 5);
    else if (digits.length < 10) add(G1, 'phone', 'Phone number', W, 'Phone number looks incomplete. Include the area code.', 5);
    else add(G1, 'phone', 'Phone number', P, 'Present.', 5);

    if (!clean(p.location)) add(G1, 'location', 'Location', W, 'Add "City, State" (or country). Many ATS filters match on location; a street address is not needed.', 3);
    else if (/\d{3,}/.test(p.location)) add(G1, 'location', 'Location', W, 'Looks like a full street address. City and state are enough and safer for privacy.', 3);
    else add(G1, 'location', 'Location', P, 'Present.', 3);

    if (!clean(p.linkedin) && !clean(p.website) && !clean(p.github)) add(G1, 'links', 'LinkedIn / portfolio', W, 'Add a LinkedIn URL or portfolio link. Most recruiters check it.', 3);
    else add(G1, 'links', 'LinkedIn / portfolio', P, 'Present.', 3);

    if (!clean(p.title)) add(G1, 'title', 'Professional title', W, 'A headline under your name (e.g. "Senior Accountant") helps both scanners and readers categorise you instantly. Match it to the job you want.', 3);
    else add(G1, 'title', 'Professional title', P, `"${clean(p.title)}"`, 3);

    // ----- Content quality -----
    const G2 = 'Content quality';
    const sumWords = clean(state.summary) ? clean(state.summary).split(/\s+/).length : 0;
    if (!visible('summary') || !sumWords) add(G2, 'summary', 'Professional summary', W, 'A 2–4 sentence summary at the top is the first thing screeners read and a natural place for keywords.', 5);
    else if (sumWords < 30) add(G2, 'summary', 'Professional summary', W, `Only ${sumWords} words. Aim for 40–90: role, years of experience, top skills, one headline achievement.`, 5);
    else if (sumWords > 110) add(G2, 'summary', 'Professional summary', W, `${sumWords} words is long. Trim to under 90 so it is read, not skimmed.`, 5);
    else add(G2, 'summary', 'Professional summary', P, `${sumWords} words.`, 5);

    const exp = visible('experience') ? state.experience.filter(e => clean(e.role) || clean(e.company)) : [];
    const allBullets = [];
    exp.forEach(e => (e.bullets || []).forEach(b => { if (clean(b)) allBullets.push(clean(b)); }));
    if (visible('projects')) state.projects.forEach(pr => (pr.bullets || []).forEach(b => { if (clean(b)) allBullets.push(clean(b)); }));
    state.custom.forEach(cs => { if (visible('custom:' + cs.id)) cs.items.forEach(it => (it.bullets || []).forEach(b => { if (clean(b)) allBullets.push(clean(b)); })); });

    if (!exp.length) add(G2, 'experience', 'Work experience', F, 'Add at least one position. If you are a student, add internships, part-time work, or projects.', 8);
    else {
      const noBullets = exp.filter(e => !(e.bullets || []).some(clean));
      if (noBullets.length) add(G2, 'experience', 'Work experience', W, `${noBullets.length} position${noBullets.length > 1 ? 's have' : ' has'} no bullet points. Add 2–5 achievements for each recent role.`, 8);
      else add(G2, 'experience', 'Work experience', P, `${exp.length} position${exp.length > 1 ? 's' : ''} with achievements listed.`, 8);
    }

    if (allBullets.length) {
      const verbStart = allBullets.filter(b => RB.ACTION_VERB_SET.has(b.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''))).length;
      const pct = Math.round(verbStart / allBullets.length * 100);
      if (pct >= 80) add(G2, 'verbs', 'Bullets start with action verbs', P, `${pct}% of bullets open with a strong verb.`, 6);
      else if (pct >= 50) add(G2, 'verbs', 'Bullets start with action verbs', W, `${pct}% of bullets open with a strong verb. Rewrite the rest: "Led", "Built", "Reduced"… Use the ⚡ Action verbs button.`, 6);
      else add(G2, 'verbs', 'Bullets start with action verbs', F, `Only ${pct}% of bullets open with a strong verb. Start each bullet with what you did, not with "Responsible for".`, 6);

      const quant = allBullets.filter(b => /\d/.test(b) || /\b(percent|million|thousand|billion|dozen|hundred)\b/i.test(b)).length;
      const qpct = Math.round(quant / allBullets.length * 100);
      if (qpct >= 40) add(G2, 'numbers', 'Quantified achievements', P, `${qpct}% of bullets include a number, percentage, or dollar figure.`, 7);
      else if (qpct >= 20) add(G2, 'numbers', 'Quantified achievements', W, `${qpct}% of bullets include a number. Add metrics: revenue, % improvement, users, team size, time saved.`, 7);
      else add(G2, 'numbers', 'Quantified achievements', F, `Only ${qpct}% of bullets include a number. Results with metrics are what separate a strong resume from a job description.`, 7);

      const long = allBullets.filter(b => b.split(/\s+/).length > 32).length;
      const short = allBullets.filter(b => b.split(/\s+/).length < 5).length;
      if (!long && !short) add(G2, 'blen', 'Bullet length', P, 'All bullets are between 5 and 32 words.', 3);
      else add(G2, 'blen', 'Bullet length', W, `${long ? long + ' bullet(s) run over 32 words. ' : ''}${short ? short + ' bullet(s) are under 5 words.' : ''} Aim for one or two lines each.`, 3);

      const pronoun = allBullets.filter(b => /\b(i|me|my|mine|we|our|us)\b/i.test(b)).length + (/\b(i|me|my|mine)\b/i.test(state.summary) ? 1 : 0);
      if (pronoun) add(G2, 'pronouns', 'No first-person pronouns', W, `${pronoun} line(s) use "I", "my", "we"… Resumes are written in implied first person: "Managed a team" not "I managed a team".`, 3);
      else add(G2, 'pronouns', 'No first-person pronouns', P, 'Good.', 3);

      const dupes = allBullets.length - new Set(allBullets.map(b => b.toLowerCase())).size;
      if (dupes) add(G2, 'dupes', 'No duplicate bullets', W, `${dupes} bullet(s) repeat elsewhere. Vary your achievements per role.`, 2);
      else add(G2, 'dupes', 'No duplicate bullets', P, 'Good.', 2);
    } else {
      add(G2, 'verbs', 'Bullets start with action verbs', F, 'No bullet points yet.', 6);
      add(G2, 'numbers', 'Quantified achievements', F, 'No bullet points yet.', 7);
    }

    const found = BUZZWORDS.filter(b => contains(ntext, b));
    if (found.length) add(G2, 'buzz', 'Avoid clichés and filler', W, `Found: ${found.map(f => '"' + f + '"').join(', ')}. Replace with concrete evidence of the trait.`, 3);
    else add(G2, 'buzz', 'Avoid clichés and filler', P, 'No clichés detected.', 3);

    const edu = visible('education') ? state.education.filter(e => clean(e.school) || clean(e.degree)) : [];
    if (!edu.length) add(G2, 'education', 'Education', W, 'Most ATS filters expect an education section. Add your highest qualification.', 4);
    else add(G2, 'education', 'Education', P, `${edu.length} entr${edu.length > 1 ? 'ies' : 'y'}.`, 4);

    const skillCount = visible('skills') ? state.skills.reduce((n, s) => n + clean(s.items).split(',').filter(x => x.trim()).length, 0) : 0;
    if (!skillCount) add(G2, 'skills', 'Skills section', F, 'A dedicated skills section is the main place ATS keyword matching happens. Add 8–20 relevant skills.', 7);
    else if (skillCount < 6) add(G2, 'skills', 'Skills section', W, `${skillCount} skills listed. Add more of the tools, methods and competencies the job asks for (aim for 8–20).`, 7);
    else if (skillCount > 35) add(G2, 'skills', 'Skills section', W, `${skillCount} skills is a lot. Keep the ones relevant to the target role so the important ones stand out.`, 7);
    else add(G2, 'skills', 'Skills section', P, `${skillCount} skills listed.`, 7);

    const missingDates = exp.filter(e => !clean(e.start)).length + edu.filter(e => !clean(e.end) && !clean(e.start)).length;
    if (missingDates) add(G2, 'dates', 'Dates on every entry', W, `${missingDates} entr${missingDates > 1 ? 'ies are' : 'y is'} missing dates. ATS parsers use dates to build your timeline; "Jan 2021 – Present" or "2021 – 2023" both work.`, 4);
    else add(G2, 'dates', 'Dates on every entry', P, 'All positions and education entries have dates.', 4);

    // ----- Formatting & length -----
    const G3 = 'Formatting & length';
    const pages = opts.pages || 1;
    const expYears = exp.length;
    if (words < 250) add(G3, 'length', 'Resume length', W, `${words} words on about ${pages} page${pages > 1 ? 's' : ''}. That is thin; add detail to your recent roles until you fill most of a page.`, 5);
    else if (pages > 2) add(G3, 'length', 'Resume length', W, `About ${pages} pages. Cut to 2 pages at most (1 page if you have under ~7 years of experience).`, 5);
    else if (pages === 2 && expYears <= 2) add(G3, 'length', 'Resume length', W, 'Two pages with limited experience. Trimming to one page usually reads stronger.', 5);
    else add(G3, 'length', 'Resume length', P, `${words} words, about ${pages} page${pages > 1 ? 's' : ''}.`, 5);

    const badTitles = [];
    Object.entries(state.sectionTitles).forEach(([k, v]) => { if (!state.hiddenSections.includes(k) && !STANDARD_HEADINGS.includes(clean(v).toLowerCase())) badTitles.push(v); });
    state.custom.forEach(c => { if (!state.hiddenSections.includes('custom:' + c.id) && !STANDARD_HEADINGS.includes(clean(c.title).toLowerCase())) badTitles.push(c.title); });
    if (badTitles.length) add(G3, 'headings', 'Standard section headings', W, `Non-standard heading${badTitles.length > 1 ? 's' : ''}: ${badTitles.map(t => '"' + t + '"').join(', ')}. Parsers recognise conventional names like "Work Experience", "Education", "Skills".`, 4);
    else add(G3, 'headings', 'Standard section headings', P, 'All headings use conventional names.', 4);

    add(G3, 'layout', 'Single-column layout, real text', P, 'This builder uses a single column, standard fonts, and text-based PDF output, so no tables, columns, icons, or images get in the way of parsing.', 5);
    add(G3, 'font', 'ATS-safe font', RB.SAFE_FONTS.includes(state.settings.font) ? P : W, `${state.settings.font}, ${state.settings.fontSize}pt.`, 2);
    if (state.settings.fontSize < 10) add(G3, 'fontsize', 'Readable font size', W, `${state.settings.fontSize}pt is small. Stay at 10pt or above for body text.`, 2);
    else add(G3, 'fontsize', 'Readable font size', P, `${state.settings.fontSize}pt body text.`, 2);

    const special = (text.match(/[^\x00-\x7F–—’‘“”•éèáóúñüöäç]/g) || []).length;
    if (special > 3) add(G3, 'chars', 'Plain characters', W, `${special} unusual symbols or emoji found. Some parsers garble them; stick to plain text.`, 2);
    else add(G3, 'chars', 'Plain characters', P, 'No problematic symbols.', 2);

    // ----- Job match -----
    let keywords = null;
    if (clean(jd).length >= 20) {
      keywords = keywordReport(jd, text);
      const G4 = 'Job match';
      const k = keywords;
      if (!k.all.length) add(G4, 'kw', 'Keyword match', W, 'Could not extract keywords from the text provided. Paste the full job description.', 1);
      else {
        // Hard skills carry most of the weight, as in every major checker.
        const h = k.hard, hm = h.filter(r => r.matched).length;
        if (!h.length) add(G4, 'hard', 'Hard skills', W, 'No tools or technical skills were found in the posting.', 2);
        else if (k.hardPct >= 70) add(G4, 'hard', 'Hard skills', P, `${hm} of ${h.length} tools and technical skills from the posting appear in your resume (${k.hardPct}%).`, 16);
        else if (k.hardPct >= 45) add(G4, 'hard', 'Hard skills', W, `${hm} of ${h.length} tools and technical skills found (${k.hardPct}%). Add the missing ones you genuinely have, using the posting's exact wording.`, 16);
        else add(G4, 'hard', 'Hard skills', F, `Only ${hm} of ${h.length} tools and technical skills found (${k.hardPct}%). This is what recruiters search for first.`, 16);

        const s = k.soft, sm = s.filter(r => r.matched).length;
        if (s.length) {
          if (k.softPct >= 60) add(G4, 'soft', 'Soft skills', P, `${sm} of ${s.length} soft skills from the posting are reflected (${k.softPct}%).`, 5);
          else add(G4, 'soft', 'Soft skills', W, `${sm} of ${s.length} soft skills reflected. Show them through achievements ("led a team of 5") rather than listing them.`, 5);
        }

        // Too much matching reads as keyword stuffing and gets resumes binned by humans.
        if (k.stuffing) add(G4, 'stuff', 'Not keyword-stuffed', W, k.overused.length ? `"${k.overused.slice(0, 3).join('", "')}" appear${k.overused.length === 1 ? 's' : ''} far more often than in the posting. Aim for 75–80% coverage, not 100%.` : 'Almost every keyword is present. Recruiters spot stuffing; aim for 75–80% and let achievements carry the rest.', 4);
        else add(G4, 'stuff', 'Not keyword-stuffed', P, 'Keyword use looks natural.', 4);
      }

      const titleWords = norm(clean(p.title)).trim();
      const jdn = norm(jd);
      const jdTitle = window.Tailor ? window.Tailor.detectTitle(jd) : '';
      if (titleWords && contains(jdn, titleWords)) add(G4, 'titlematch', 'Job title match', P, 'Your headline matches the posting. Exact title matches are a strong ranking signal.', 6);
      else if (jdTitle) add(G4, 'titlematch', 'Job title match', W, `The posting calls this role "${jdTitle}". Use it as your headline if it honestly describes you; recruiters search by exact title.`, 6);
      else add(G4, 'titlematch', 'Job title match', W, 'Use the exact job title from the posting as your headline if it honestly describes you.', 6);
    }

    // ----- Line-by-line bullet critique -----
    const lines = lintBullets(state);

    const total = checks.reduce((n, c) => n + c.weight, 0);
    const earned = checks.reduce((n, c) => n + (c.status === P ? c.weight : c.status === W ? c.weight / 2 : 0), 0);
    const score = total ? Math.round(earned / total * 100) : 0;
    const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs work' : 'Weak';
    return { score, grade, checks, keywords, lines, words, pages };
  }

  window.ATS = { analyze, extractKeywords, keywordReport, lintBullets, SKILL_PHRASES, SOFT_SKILLS, SYNONYMS };
})();
