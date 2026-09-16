/* =====================================================================
   Job-description tailoring. Makes conservative, reversible changes:
     - orders skills (and skill groups) so matches come first
     - orders bullet points within each role / project by relevance
     - orders projects by relevance
     - surfaces skills already mentioned elsewhere into the Skills section
     - suggests the posting's job title as the headline
   It never invents experience. Exposes window.Tailor
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const clean = s => String(s == null ? '' : s).trim();

  function norm(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[–—]/g, '-').replace(/[^a-z0-9+#./ -]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function has(normText, phrase) {
    return new RegExp('(^|[^a-z0-9])' + escapeRe(phrase.toLowerCase()) + '([^a-z0-9]|$)').test(normText);
  }
  function matches(text, keywords) {
    const n = norm(text);
    return keywords.filter(k => has(n, k));
  }
  function stableSort(arr, scoreFn) {
    return arr.map((v, i) => ({ v, i, s: scoreFn(v) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map(x => x.v);
  }
  function sameOrder(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
  function pretty(kw) {
    // Prefer the casing the user already uses; otherwise Title Case, keeping known acronyms.
    const ACR = { aws: 'AWS', gcp: 'GCP', sql: 'SQL', nosql: 'NoSQL', html: 'HTML', css: 'CSS', api: 'API', apis: 'APIs', etl: 'ETL', nlp: 'NLP', tdd: 'TDD',
      seo: 'SEO', sem: 'SEM', ppc: 'PPC', crm: 'CRM', erp: 'ERP', sap: 'SAP', gdpr: 'GDPR', hipaa: 'HIPAA', sre: 'SRE', ui: 'UI', ux: 'UX', 'ui/ux': 'UI/UX',
      'ci/cd': 'CI/CD', kpis: 'KPIs', okrs: 'OKRs', 'a/b testing': 'A/B Testing', 'node.js': 'Node.js', 'next.js': 'Next.js', 'vue': 'Vue', 'graphql': 'GraphQL',
      'postgresql': 'PostgreSQL', 'mysql': 'MySQL', 'mongodb': 'MongoDB', 'javascript': 'JavaScript', 'typescript': 'TypeScript', 'devops': 'DevOps',
      'github': 'GitHub', 'gitlab': 'GitLab', 'powershell': 'PowerShell', 'pytorch': 'PyTorch', 'tensorflow': 'TensorFlow', 'matlab': 'MATLAB',
      'autocad': 'AutoCAD', 'solidworks': 'SolidWorks', 'quickbooks': 'QuickBooks', 'hubspot': 'HubSpot', 'c#': 'C#', 'c++': 'C++', '.net': '.NET', 'php': 'PHP',
      'ios': 'iOS', 'macos': 'macOS', 'linkedin': 'LinkedIn', 'r': 'R', 'sas': 'SAS', 'spss': 'SPSS', 'rest api': 'REST API', 'rest apis': 'REST APIs' };
    if (ACR[kw]) return ACR[kw];
    return kw.split(' ').map(w => w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()).join(' ');
  }
  function casedFromResume(text, kw) {
    const m = new RegExp('(^|[^A-Za-z0-9])(' + escapeRe(kw).replace(/ /g, '\\s+') + ')([^A-Za-z0-9]|$)', 'i').exec(text);
    return m ? m[2].replace(/\s+/g, ' ') : null;
  }

  // Too generic to be worth listing as a skill or naming in a change description.
  const GENERIC = new Set(['marketing', 'sales', 'management', 'leadership', 'communication', 'research', 'training', 'support', 'security', 'design',
    'testing', 'analysis', 'engineering', 'development', 'data', 'business', 'product', 'customer', 'team', 'strategy', 'growth', 'operations',
    'planning', 'reporting', 'quality', 'service', 'services', 'software', 'technology', 'technical', 'digital', 'content', 'media', 'finance',
    'accounting', 'compliance', 'recruiting', 'onboarding', 'mentoring', 'consulting', 'administration', 'coordination', 'documentation']);

  const ROLE_WORDS = /\b(engineer|developer|manager|analyst|designer|specialist|coordinator|director|lead|consultant|accountant|nurse|associate|administrator|scientist|architect|intern|representative|technician|officer|assistant|executive|strategist|writer|editor|marketer|recruiter|teacher|instructor|therapist|pharmacist|physician|paralegal|attorney|controller|auditor|planner|buyer|supervisor|operator|clerk|agent|advisor|partner|head|vp|president|cto|cfo|coo|ceo)\b/i;

  function detectTitle(jd) {
    const text = clean(jd).replace(/\r/g, '');
    if (!text) return '';
    const cap = s => s.replace(/\s+/g, ' ').replace(/^[\s:\-–—•*]+|[\s:\-–—•*.,]+$/g, '').trim();
    const good = t => t && t.split(' ').length <= 7 && t.length <= 60 && ROLE_WORDS.test(t);
    const patterns = [
      /(?:job title|position title|role|position|title)\s*[:\-–]\s*([^\n]+)/i,
      /(?:hiring|looking for|seeking|searching for|recruiting)\s+(?:an?\s+|our next\s+|a new\s+)?((?:[A-Z][\w+#./&-]*|of|and|&)(?:\s+(?:[A-Z][\w+#./&-]*|of|and|&|[IV]+)){0,5})/,
      /(?:as|for)\s+(?:an?|our)\s+((?:[A-Z][\w+#./&-]*|of|and|&)(?:\s+(?:[A-Z][\w+#./&-]*|of|and|&|[IV]+)){0,5})/
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) { const t = cap(m[1]).replace(/\s+(to|who|that|with|in|at|for|on)\b.*$/i, ''); if (good(t)) return t; }
    }
    const firstLines = text.split('\n').map(cap).filter(Boolean).slice(0, 4);
    for (const l of firstLines) { const t = l.replace(/\s*[\(\[|].*$/, '').replace(/\s+-\s+.*$/, ''); if (good(t)) return t; }
    return '';
  }

  /* Apply tailoring in place. Returns { changes: [{text, action?}], count } */
  function apply(state, jd) {
    const changes = [];
    const keywords = window.ATS.extractKeywords(jd, 40);
    if (!keywords.length) return { changes, count: 0, keywords };
    const kwSet = keywords;

    // 1. Skills: reorder items in each group, then reorder groups.
    state.skills.forEach(row => {
      const items = clean(row.items).split(',').map(s => s.trim()).filter(Boolean);
      if (items.length < 2) return;
      const sorted = stableSort(items, it => matches(it, kwSet).length ? 1 : 0);
      if (!sameOrder(items, sorted)) {
        const moved = sorted.filter(it => matches(it, kwSet).length && items.indexOf(it) > sorted.indexOf(it));
        row.items = sorted.join(', ');
        if (moved.length) changes.push({ text: `Moved ${moved.map(m => '"' + m + '"').join(', ')} to the front of ${row.category ? '"' + row.category + '"' : 'your skills'}.` });
      }
    });
    // (skill groups are ordered in step 4b, after any surfaced skills have been added)

    // 2. Bullets in each role.
    const reorderBullets = (bullets, label) => {
      const list = (bullets || []).map(clean).filter(Boolean);
      if (list.length < 2) return list;
      const sorted = stableSort(list, b => matches(b, kwSet).length);
      if (!sameOrder(list, sorted)) {
        const all = matches(sorted[0], kwSet);
        const specific = all.filter(k => !GENERIC.has(k));
        const top = specific.slice(0, 2).map(pretty).join(' and ');
        changes.push({ text: `Reordered bullets under ${label} to lead with the one ${top ? 'mentioning ' + top : 'that best matches the posting'}.` });
      }
      return sorted;
    };
    state.experience.forEach(e => {
      const label = [clean(e.role), clean(e.company)].filter(Boolean).join(' at ') || 'a role';
      e.bullets = reorderBullets(e.bullets, label);
    });
    state.projects.forEach(p => { p.bullets = reorderBullets(p.bullets, clean(p.name) ? '"' + clean(p.name) + '"' : 'a project'); });
    state.custom.forEach(c => c.items.forEach(it => { it.bullets = reorderBullets(it.bullets, clean(it.heading) ? '"' + clean(it.heading) + '"' : '"' + c.title + '"'); }));

    // 3. Projects by relevance.
    if (state.projects.length > 1) {
      const before = state.projects.slice();
      const sorted = stableSort(state.projects, p => matches([p.name, p.tech, (p.bullets || []).join(' ')].join(' '), kwSet).length);
      if (!sameOrder(before, sorted)) {
        state.projects.splice(0, state.projects.length, ...sorted);
        changes.push({ text: `Moved project "${clean(sorted[0].name)}" to the top of Projects.` });
      }
    }

    // 4. Surface keywords already present elsewhere into Skills.
    const skillsText = norm(state.skills.map(s => s.category + ' ' + s.items).join(' , '));
    const elsewhere = [
      { where: 'your summary', text: state.summary },
      { where: 'your work experience', text: state.experience.map(e => [e.role, (e.bullets || []).join(' ')].join(' ')).join(' ') },
      { where: 'your projects', text: state.projects.map(p => [p.name, p.tech, (p.bullets || []).join(' ')].join(' ')).join(' ') },
      { where: 'your certifications', text: state.certifications.map(c => c.name).join(' ') }
    ];
    const surfaced = [];
    const titleText = norm(state.personal.title);
    kwSet.forEach(kw => {
      if (GENERIC.has(kw) || has(titleText, kw)) return;
      if (has(skillsText, kw)) return;
      const src = elsewhere.find(x => has(norm(x.text), kw));
      if (!src) return;
      const isSkill = window.ATS.SKILL_PHRASES.includes(kw) || state.projects.some(p => has(norm(p.tech), kw)) || /[A-Z]/.test(casedFromResume(src.text, kw) || '') && kw.length > 2 && !/^[a-z]+ing$/.test(kw);
      if (!isSkill) return;
      const label = casedFromResume(src.text, kw) || pretty(kw);
      surfaced.push({ label, where: src.where });
    });
    if (surfaced.length) {
      let row = state.skills.find(s => /^(additional|other|relevant) skills$/i.test(clean(s.category)));
      if (!row) { row = RB.newItem('skills'); row.category = 'Additional Skills'; state.skills.push(row); }
      const items = clean(row.items).split(',').map(s => s.trim()).filter(Boolean);
      surfaced.forEach(s => { if (!items.some(i => i.toLowerCase() === s.label.toLowerCase())) items.push(s.label); });
      row.items = items.join(', ');
      state.hiddenSections = state.hiddenSections.filter(k => k !== 'skills');
      const byWhere = {};
      surfaced.forEach(s => { (byWhere[s.where] = byWhere[s.where] || []).push('"' + s.label + '"'); });
      Object.entries(byWhere).forEach(([w, ls]) => changes.push({ text: `Added ${ls.join(', ')} to Skills because ${ls.length > 1 ? 'they are' : 'it is'} already mentioned in ${w}.` }));
    }

    // 4b. Skill groups: most relevant group first (stable, so ties keep the user's order).
    if (state.skills.length > 1) {
      const before = state.skills.slice();
      const sorted = stableSort(state.skills, row => matches(row.items, kwSet).length);
      if (!sameOrder(before, sorted)) {
        state.skills.splice(0, state.skills.length, ...sorted);
        const movedUp = sorted.filter((row, i) => before.indexOf(row) > i).map(r => r.category ? '"' + r.category + '"' : 'an unnamed group');
        changes.push({ text: `Reordered skill groups: ${movedUp.join(', ')} moved up because ${movedUp.length > 1 ? 'they match' : 'it matches'} more of the posting.` });
      }
    }

    // 5. Headline suggestion.
    const title = detectTitle(jd);
    if (title && clean(state.personal.title).toLowerCase() !== title.toLowerCase()) {
      if (!clean(state.personal.title)) {
        state.personal.title = title;
        changes.push({ text: `Set your headline to "${title}", the title used in the posting.` });
      } else {
        changes.push({ text: `The posting calls this role "${title}". Your headline is "${clean(state.personal.title)}".`, action: { type: 'use-title', title } });
      }
    }

    return { changes, count: changes.filter(c => !c.action).length, keywords: kwSet };
  }

  window.Tailor = { apply, detectTitle };
})();
