/* =====================================================================
   Section editor: a rail of steps on the left, one section at a time in
   the panel. Reports changes through emit('value' | 'structural', detail).
   Exposes window.Editor
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
  const clean = s => String(s == null ? '' : s).trim();

  let root, rail, state, emit, opts = {};
  let active = 'upload';
  let uploadStatusHtml = '';
  let jdResultsHtml = '';
  const collapsedItems = new Set();
  let dragKey = null;
  let lastBulletTa = null;
  let railTimer = null;

  const META = {
    upload: { label: 'Upload resume', icon: 'upload', title: 'Upload your existing resume', desc: 'Drop in a PDF, Word or text file. Your details are extracted into the sections below so you only have to review them.' },
    jd: { label: 'Job description', icon: 'sparkles', title: 'Job description', desc: 'Paste the posting you are applying for. The resume is re-optimised automatically every time this text changes: relevant skills and achievements move to the front, and matching keywords you already have are surfaced.' },
    personal: { label: 'Contact', icon: 'user', title: 'Contact details', desc: 'How employers reach you. Keep it to essentials; a street address is not needed.' },
    summary: { label: 'Summary', icon: 'align-left', desc: 'Two to four sentences that sell you in ten seconds: who you are, years of experience, strongest skills, one headline result.' },
    experience: { label: 'Experience', icon: 'briefcase', desc: 'Most recent first. Each bullet should start with a strong verb and include a number wherever you can.' },
    education: { label: 'Education', icon: 'graduation', desc: 'Degree, school, dates. Add GPA only if it is 3.5 or higher or you are a recent graduate.' },
    skills: { label: 'Skills', icon: 'tool', desc: 'Group skills by category so they scan easily. Use the exact terms from the job posting.' },
    projects: { label: 'Projects', icon: 'folder', desc: 'Great for students, career changers, and anyone whose job titles do not tell the whole story.' },
    certifications: { label: 'Certifications', icon: 'award', desc: 'Use the official name, the issuing organisation, and the year.' },
    awards: { label: 'Awards', icon: 'star', desc: 'Keep to awards a hiring manager would recognise or that show measurable achievement.' },
    languages: { label: 'Languages', icon: 'globe', desc: 'State proficiency honestly: Native, Fluent, Professional working proficiency, Conversational, Basic.' },
    design: { label: 'Design', icon: 'palette', title: 'Design & formatting', desc: 'Every template is single-column with real text and standard headings, so all of them parse cleanly in applicant tracking systems. Pick by taste.' },
    layout: { label: 'Order & visibility', icon: 'layers', title: 'Section order & visibility', desc: 'Drag to reorder, or use the arrows. Lead with your strongest section: experienced candidates start with work history; students and career changers often lead with education or projects.' }
  };
  const TIPS = {
    summary: ['Skip "I" and objective statements; write in implied first person.', 'Mention 2–3 skills the job posting asks for.', 'End with one quantified achievement.'],
    experience: ['3–5 bullets for recent roles, 1–2 for older ones.', 'Formula: Verb + what you did + measurable result.', 'Press Enter inside a bullet to add the next one.'],
    skills: ['8–20 skills is the sweet spot.', 'Spell out acronyms once: "Search Engine Optimization (SEO)".', 'Tools, methods and certifications all count.'],
    education: ['List the highest qualification first.', 'Recent graduates can add relevant coursework and honours.'],
    projects: ['Name the technologies used so keyword scanners pick them up.', 'Include a link if the work is public.']
  };
  const ADD_LABEL = { experience: 'position', education: 'education', skills: 'skill group', projects: 'project', certifications: 'certification', awards: 'award', languages: 'language' };
  const EMPTY = {
    experience: ['No positions yet', 'Add your most recent job first. Internships and part-time work count.'],
    education: ['No education yet', 'Add your highest qualification, or the one in progress.'],
    skills: ['No skills yet', 'Add a group such as "Technical", "Tools" or "Languages" and list skills separated by commas.'],
    projects: ['No projects yet', 'Side projects, coursework and open source all belong here.'],
    certifications: ['No certifications yet', 'Professional certifications, licences and completed courses.'],
    awards: ['No awards yet', 'Recognition, scholarships, competition wins.'],
    languages: ['No languages yet', 'Spoken languages with your proficiency level.'],
    custom: ['Nothing here yet', 'Add an entry. Each one can have a heading, sub-heading, date and bullets.']
  };

  /* ---------------- public ---------------- */
  function init(rootEl, railEl, st, cb, options) { root = rootEl; rail = railEl; state = st; emit = cb; opts = options || {}; renderAll(); bind(); }
  function setState(st) { state = st; if (!steps().some(s => s.key === active)) active = 'personal'; renderAll(); }
  function setUploadStatus(html) { uploadStatusHtml = html || ''; if (active === 'upload') renderPanel(); }
  function setJdResults(html) {
    jdResultsHtml = html || '';
    const box = root.querySelector('#jdResults');
    if (box) box.innerHTML = jdResultsHtml; else if (active === 'jd') renderPanel();
  }
  function getJd() { return (opts.getJd ? opts.getJd() : '') || ''; }
  function go(key) { if (!steps().some(s => s.key === key)) return; active = key; renderAll(); root.scrollTop = 0; }
  function getActive() { return active; }
  function focusFirst() { const f = root.querySelector('input[type="text"], textarea'); if (f) f.focus(); }

  /* ---------------- steps & status ---------------- */
  function steps() {
    const s = [{ key: 'upload' }, { key: 'jd' }, { key: 'personal' }];
    state.sectionOrder.forEach(k => s.push({ key: k }));
    s.push({ key: 'design' }, { key: 'layout' });
    return s;
  }
  function labelFor(key) {
    if (key.startsWith('custom:')) { const c = state.custom.find(x => 'custom:' + x.id === key); return c ? (clean(c.title) || 'Custom section') : 'Custom'; }
    return META[key] ? META[key].label : key;
  }
  function iconFor(key) { return key.startsWith('custom:') ? 'plus-square' : (META[key] ? META[key].icon : 'file-text'); }
  function status(key) {
    const p = state.personal;
    switch (key) {
      case 'upload': return null;
      case 'jd': return getJd().trim().length >= 20 ? 'done' : 'empty';
      case 'personal': return clean(p.fullName) && clean(p.email) && clean(p.phone) ? 'done' : 'empty';
      case 'summary': return clean(state.summary).split(/\s+/).filter(Boolean).length >= 15 ? 'done' : 'empty';
      case 'experience': return state.experience.some(e => (clean(e.role) || clean(e.company)) && (e.bullets || []).some(clean)) ? 'done' : 'empty';
      case 'education': return state.education.some(e => clean(e.school) || clean(e.degree)) ? 'done' : 'empty';
      case 'skills': return state.skills.some(s => clean(s.items)) ? 'done' : 'empty';
      case 'projects': return state.projects.some(p => clean(p.name)) ? 'done' : 'empty';
      case 'certifications': return state.certifications.some(c => clean(c.name)) ? 'done' : 'empty';
      case 'awards': return state.awards.some(a => clean(a.title)) ? 'done' : 'empty';
      case 'languages': return state.languages.some(l => clean(l.name)) ? 'done' : 'empty';
      case 'design': case 'layout': return null;
      default: { const c = state.custom.find(x => 'custom:' + x.id === key); return c && c.items.some(i => clean(i.heading) || clean(i.subheading)) ? 'done' : 'empty'; }
    }
  }
  const ESSENTIALS = ['personal', 'summary', 'experience', 'education', 'skills'];
  function progress() { const done = ESSENTIALS.filter(k => status(k) === 'done').length; return { done, total: ESSENTIALS.length }; }

  /* ---------------- rendering ---------------- */
  function renderAll() { renderRail(); renderPanel(); }

  function renderRail() {
    const pg = progress();
    const item = key => {
      const st = status(key);
      const hidden = state.hiddenSections.includes(key);
      return `<button type="button" class="rail-item${key === active ? ' active' : ''}${hidden ? ' is-hidden' : ''}${st === 'done' ? ' done-mini' : ''}" data-action="go" data-key="${esc(key)}" title="${esc(labelFor(key))}${hidden ? ' (hidden on resume)' : ''}">
        ${icon(iconFor(key))}<span class="lbl">${esc(labelFor(key))}</span>
        ${st ? `<span class="st${st === 'done' ? ' done' : ''}" aria-label="${st === 'done' ? 'complete' : 'empty'}">${icon('check')}</span>` : ''}
      </button>`;
    };
    rail.innerHTML = `<button type="button" class="rail-item rail-back" data-action="back-simple" title="Back to the simple view">${icon('chevron-left')}<span class="lbl">Simple view</span></button>` +
      `<div class="rail-group">Start</div>` + item('upload') + item('jd') +
      `<div class="rail-group">Resume</div>` +
      item('personal') + state.sectionOrder.map(item).join('') +
      `<button type="button" class="rail-item rail-add" data-action="add-custom-section" title="Add a custom section">${icon('plus')}<span class="lbl">Add section</span></button>` +
      `<div class="rail-group">Setup</div>` + item('design') + item('layout') +
      `<div class="rail-progress"><div class="pg-label"><span>Essentials</span><b>${pg.done} / ${pg.total}</b></div><div class="bar"><i style="width:${Math.round(pg.done / pg.total * 100)}%"></i></div></div>`;
  }
  function scheduleRail() { clearTimeout(railTimer); railTimer = setTimeout(renderRail, 250); }

  function panelShell({ key, title, desc, body, tools }) {
    const list = steps();
    const i = list.findIndex(s => s.key === key);
    const prev = list[i - 1], next = list[i + 1];
    return `<div class="panel-head">
        <div><h2 class="panel-title">${esc(title)}</h2><p class="panel-desc">${esc(desc || '')}</p></div>
        ${tools ? `<div class="panel-tools">${tools}</div>` : ''}
      </div>
      ${body}
      <div class="panel-foot">
        ${prev ? `<button type="button" class="btn" data-action="go" data-key="${esc(prev.key)}">${icon('chevron-left')} ${esc(labelFor(prev.key))}</button>` : '<span></span>'}
        <span class="step">Step ${i + 1} of ${list.length}</span>
        ${next ? `<button type="button" class="btn btn-primary" data-action="go" data-key="${esc(next.key)}">${esc(labelFor(next.key))} ${icon('chevron-right')}</button>` : `<button type="button" class="btn btn-primary" data-action="finish">${icon('download')} Download</button>`}
      </div>`;
  }
  function sectionTools(key, titlePath, title) {
    const hidden = state.hiddenSections.includes(key);
    return `<label class="heading-edit" title="The heading printed on the resume">${icon('edit')}<input type="text" data-path="${titlePath}" value="${esc(title)}" aria-label="Heading on resume"></label>
      <label class="switch" title="${hidden ? 'This section is hidden on the resume' : 'Shown on the resume'}"><input type="checkbox" data-toggle-hidden="${esc(key)}"${hidden ? '' : ' checked'}><span>${hidden ? 'Hidden' : 'Shown on resume'}</span></label>`;
  }
  function tipsCard(key) {
    const t = TIPS[key];
    return t ? `<div class="card tips"><div class="card-title">${icon('info')} Tips</div><ul>${t.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  }

  function renderPanel() {
    const key = active;
    let html = '';
    if (key === 'upload') html = panelShell({ key, title: META.upload.title, desc: META.upload.desc, body: renderUpload() });
    else if (key === 'jd') html = panelShell({ key, title: META.jd.title, desc: META.jd.desc, body: renderJd() });
    else if (key === 'personal') html = renderPersonal();
    else if (key === 'design') html = panelShell({ key, title: META.design.title, desc: META.design.desc, body: renderDesign() });
    else if (key === 'layout') html = panelShell({ key, title: META.layout.title, desc: META.layout.desc, body: renderLayout() });
    else if (key.startsWith('custom:')) html = renderCustomPanel(key);
    else html = renderBuiltin(key);
    root.innerHTML = html;
    autogrowAll();
  }

  function field(label, path, value, o = {}) {
    return `<label class="fld ${o.cls || ''}"><span>${esc(label)}${o.opt ? ' <em>(optional)</em>' : ''}</span>
      <input type="${o.type || 'text'}" data-path="${path}" value="${esc(value)}" placeholder="${esc(o.ph || '')}"${o.disabled ? ' disabled' : ''}${o.list ? ` list="${o.list}"` : ''}${o.autocomplete ? ` autocomplete="${o.autocomplete}"` : ''}></label>`;
  }

  function aiCard() { return opts.aiCardHtml ? opts.aiCardHtml() : ''; }

  function renderUpload() {
    return `${aiCard()}<div class="dropzone" id="dropzone" data-action="pick-file" role="button" tabindex="0" aria-label="Upload a resume file" style="margin-top:12px">
        <div class="dz-icon">${icon('upload')}</div>
        <b>Drop your resume here, or click to browse</b>
        <span>PDF, Word (.docx), plain text, or a backup from this tool (.json). Nothing is uploaded anywhere; the file is read on this device.</span>
      </div>
      ${uploadStatusHtml}
      <div class="card" style="margin-top:12px">
        <div class="or-row">
          <div class="hint">No resume yet? Fill in the sections by hand, or look at the sample to see what a strong one looks like.</div>
          <button type="button" class="btn btn-sm" data-action="go" data-key="personal">${icon('edit')} Start from scratch</button>
          <button type="button" class="btn btn-sm" data-action="load-sample">${icon('sparkles')} Load sample</button>
        </div>
      </div>
      <div class="card tips"><div class="card-title">${icon('info')} How extraction works</div><ul>
        <li>Standard headings (Experience, Education, Skills…) are recognised and each entry is split into title, company, dates and bullets.</li>
        <li>Text-based PDFs work best. Scanned images cannot be read.</li>
        <li>Review each section afterwards; anything unrecognised is kept in an extra section so nothing is lost.</li></ul></div>`;
  }

  function renderJd() {
    const jd = getJd();
    return `${aiCard()}<div class="card" style="margin-top:12px">
        <label class="fld"><span>Paste the job posting</span>
          <textarea id="jdInput" class="jd-input" placeholder="Paste the full job description here: responsibilities, requirements, preferred skills. The more complete it is, the better the match.">${esc(jd)}</textarea></label>
        <div id="jdResults">${jdResultsHtml}</div>
      </div>
      <div class="card tips"><div class="card-title">${icon('info')} What gets optimised</div><ul>
        <li>Skills and skill groups are reordered so matches to the posting come first.</li>
        <li>Bullet points under each role and project are reordered so the most relevant achievement leads.</li>
        <li>Skills the posting asks for that you already mention elsewhere are added to your Skills section.</li>
        <li>The posting's job title is offered as your headline. Nothing is invented; every change is listed and can be undone.</li></ul></div>`;
  }

  function renderPersonal() {
    const p = state.personal;
    const body = `<div class="card"><div class="grid">
      ${field('Full name', 'personal.fullName', p.fullName, { ph: 'Jordan Rivera', autocomplete: 'name' })}
      ${field('Professional title', 'personal.title', p.title, { ph: 'Senior Software Engineer' })}
      ${field('Email', 'personal.email', p.email, { type: 'email', ph: 'you@example.com', autocomplete: 'email' })}
      ${field('Phone', 'personal.phone', p.phone, { type: 'tel', ph: '(555) 123-4567', autocomplete: 'tel' })}
      ${field('Location', 'personal.location', p.location, { ph: 'City, State' })}
      ${field('LinkedIn', 'personal.linkedin', p.linkedin, { ph: 'linkedin.com/in/yourname', opt: true })}
      ${field('Website / portfolio', 'personal.website', p.website, { ph: 'yourname.dev', opt: true })}
      ${field('GitHub / other link', 'personal.github', p.github, { ph: 'github.com/yourname', opt: true })}
    </div></div>
    <div class="card tips"><div class="card-title">${icon('info')} Tips</div><ul>
      <li>Use a plain, professional email address.</li>
      <li>Your title should match the job you want, e.g. "Marketing Manager".</li>
      <li>Links print as text so scanners can read them.</li></ul></div>`;
    return panelShell({ key: 'personal', title: META.personal.title, desc: META.personal.desc, body });
  }

  function renderBuiltin(key) {
    const title = state.sectionTitles[key];
    const tools = sectionTools(key, `sectionTitles.${key}`, title);
    let body = '';
    if (key === 'summary') {
      const words = clean(state.summary) ? clean(state.summary).split(/\s+/).length : 0;
      body = `<div class="card">
        <label class="fld"><span>Summary</span><textarea data-path="summary" rows="6" placeholder="Results-driven marketing manager with 6 years of experience growing B2B pipelines. Increased qualified leads 140% at Acme by…">${esc(state.summary)}</textarea></label>
        <div class="counter${words > 100 ? ' warn' : ''}">${words} words · aim for 40–90</div>
      </div>${tipsCard(key)}`;
    } else {
      const list = state[key];
      body = list.length
        ? list.map((it, i) => renderItem(key, it, i, list.length)).join('')
        : `<div class="empty-state">${icon(iconFor(key))}<b>${esc(EMPTY[key][0])}</b>${esc(EMPTY[key][1])}</div>`;
      body += `<button type="button" class="btn btn-add" data-action="add-item" data-sec="${key}">${icon('plus')} Add ${ADD_LABEL[key]}</button>${tipsCard(key)}`;
    }
    return panelShell({ key, title, desc: META[key].desc, body, tools });
  }

  function bulletsField(base, lines, o = {}) {
    const arr = (lines || []).length ? lines : [''];
    const n = arr.filter(l => clean(l)).length;
    const rows = arr.map((l, i) => `<div class="bullet-row"><span class="dot">•</span>
        <textarea rows="1" data-path="${base}.${i}" data-kind="bullet" placeholder="${esc(i === 0 ? (o.ph || 'Led migration of 40 services to Kubernetes, cutting deploy time by 70%') : 'Next achievement…')}">${esc(l)}</textarea>
        <button type="button" class="ibtn sm danger" data-action="remove-bullet" data-base="${base}" data-idx="${i}" title="Remove bullet">${icon('x')}</button></div>`).join('');
    return `<div class="fld full"><span>${esc(o.label || 'Achievements')} <em>· start with a verb, add a number</em></span>
      <div class="bullets" data-bullets="${base}">${rows}</div>
      <div class="bullets-tools">
        <button type="button" class="btn btn-sm" data-action="add-bullet" data-base="${base}">${icon('plus')} Add bullet</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="verbs" title="Insert a strong action verb at the cursor">${icon('zap')} Action verbs</button>
        <span class="counter">${n} bullet${n === 1 ? '' : 's'}</span>
      </div></div>`;
  }

  function itemShell(sec, it, i, len, title, sub, body, extra = {}) {
    const collapsed = collapsedItems.has(it.id) ? ' collapsed' : '';
    const ci = extra.ci != null ? ` data-ci="${extra.ci}"` : '';
    return `<div class="item${collapsed}" data-id="${it.id}">
      <div class="item-head">
        <span class="caret" data-action="toggle-item" title="Collapse / expand">${icon('chevron-down')}</span>
        <span class="item-title" data-action="toggle-item">${esc(title) || '<span class="untitled">Untitled</span>'}${sub ? ` <small>· ${esc(sub)}</small>` : ''}</span>
        <div class="item-tools">
          <button type="button" class="ibtn sm" data-action="move-item" data-sec="${sec}"${ci} data-idx="${i}" data-dir="-1" title="Move up"${i === 0 ? ' disabled' : ''}>${icon('arrow-up')}</button>
          <button type="button" class="ibtn sm" data-action="move-item" data-sec="${sec}"${ci} data-idx="${i}" data-dir="1" title="Move down"${i === len - 1 ? ' disabled' : ''}>${icon('arrow-down')}</button>
          <button type="button" class="ibtn sm" data-action="dup-item" data-sec="${sec}"${ci} data-idx="${i}" title="Duplicate">${icon('copy')}</button>
          <button type="button" class="ibtn sm danger" data-action="remove-item" data-sec="${sec}"${ci} data-idx="${i}" title="Remove">${icon('trash')}</button>
        </div>
      </div>
      <div class="item-body">${body}</div>
    </div>`;
  }

  function renderItem(sec, it, i, len) {
    const p = `${sec}.${i}`;
    switch (sec) {
      case 'experience':
        return itemShell(sec, it, i, len, it.role, it.company, `<div class="grid">
          ${field('Job title', p + '.role', it.role, { ph: 'Product Manager' })}
          ${field('Company', p + '.company', it.company, { ph: 'Acme Corp' })}
          ${field('Location', p + '.location', it.location, { ph: 'Austin, TX or Remote' })}
          <div class="fld"><span>&nbsp;</span><label class="check"><input type="checkbox" data-path="${p}.current"${it.current ? ' checked' : ''}> I currently work here</label></div>
          ${field('Start date', p + '.start', it.start, { ph: 'Jan 2021', list: 'dateHints' })}
          ${field('End date', p + '.end', it.current ? 'Present' : it.end, { ph: 'Dec 2023', disabled: it.current, list: 'dateHints' })}
          ${bulletsField(p + '.bullets', it.bullets)}
        </div>`);
      case 'education':
        return itemShell(sec, it, i, len, it.degree ? `${it.degree}${it.field ? ', ' + it.field : ''}` : it.school, it.degree ? it.school : '', `<div class="grid">
          ${field('School / university', p + '.school', it.school, { ph: 'University of Texas at Austin' })}
          ${field('Degree', p + '.degree', it.degree, { ph: 'Bachelor of Science' })}
          ${field('Field of study', p + '.field', it.field, { ph: 'Computer Science' })}
          ${field('Location', p + '.location', it.location, { ph: 'Austin, TX', opt: true })}
          ${field('Start', p + '.start', it.start, { ph: '2016' })}
          ${field('End (or expected)', p + '.end', it.end, { ph: '2020' })}
          ${field('GPA', p + '.gpa', it.gpa, { ph: '3.8/4.0', opt: true })}
          ${field('Honors / details', p + '.details', it.details, { ph: 'Dean’s List; relevant coursework…', opt: true })}
        </div>`);
      case 'skills':
        return itemShell(sec, it, i, len, it.category, (it.items || '').split(',').filter(s => s.trim()).length + ' skills', `<div class="grid">
          ${field('Category', p + '.category', it.category, { ph: 'Programming Languages' })}
          ${field('Skills, separated by commas', p + '.items', it.items, { cls: 'full', ph: 'Python, SQL, Java, TypeScript' })}
        </div>`);
      case 'projects':
        return itemShell(sec, it, i, len, it.name, it.tech, `<div class="grid">
          ${field('Project name', p + '.name', it.name, { ph: 'Inventory Forecasting Tool' })}
          ${field('Link', p + '.link', it.link, { ph: 'github.com/you/project', opt: true })}
          ${field('Technologies', p + '.tech', it.tech, { cls: 'full', ph: 'Python, Pandas, Flask' })}
          ${field('Start', p + '.start', it.start, { ph: '2023' })}
          ${field('End', p + '.end', it.end, { ph: 'Present' })}
          ${bulletsField(p + '.bullets', it.bullets, { label: 'What you built and the result', ph: 'Built a forecasting model that reduced stock-outs by 18% across 30 stores' })}
        </div>`);
      case 'certifications':
        return itemShell(sec, it, i, len, it.name, it.issuer, `<div class="grid">
          ${field('Certification', p + '.name', it.name, { ph: 'PMP – Project Management Professional' })}
          ${field('Issuer', p + '.issuer', it.issuer, { ph: 'Project Management Institute' })}
          ${field('Date', p + '.date', it.date, { ph: '2024' })}
          ${field('Credential link', p + '.link', it.link, { ph: 'credly.com/…', opt: true })}
        </div>`);
      case 'awards':
        return itemShell(sec, it, i, len, it.title, it.issuer, `<div class="grid">
          ${field('Award', p + '.title', it.title, { ph: 'Employee of the Year' })}
          ${field('Issuer', p + '.issuer', it.issuer, { ph: 'Acme Corp' })}
          ${field('Date', p + '.date', it.date, { ph: '2023' })}
          ${field('Description', p + '.description', it.description, { ph: 'Selected from 400 employees for…', opt: true })}
        </div>`);
      case 'languages':
        return itemShell(sec, it, i, len, it.name, it.level, `<div class="grid">
          ${field('Language', p + '.name', it.name, { ph: 'Spanish' })}
          ${field('Proficiency', p + '.level', it.level, { ph: 'Professional working proficiency', list: 'levelHints' })}
        </div>`);
    }
    return '';
  }

  function renderCustomPanel(key) {
    const ci = state.custom.findIndex(c => 'custom:' + c.id === key);
    if (ci < 0) return '';
    const sec = state.custom[ci];
    const items = sec.items.map((it, i) => itemShell('customItems', it, i, sec.items.length, it.heading, it.subheading, `<div class="grid">
        ${field('Heading', `custom.${ci}.items.${i}.heading`, it.heading, { ph: 'Volunteer Coordinator' })}
        ${field('Sub-heading', `custom.${ci}.items.${i}.subheading`, it.subheading, { ph: 'Red Cross', opt: true })}
        ${field('Date', `custom.${ci}.items.${i}.date`, it.date, { ph: '2022 – 2023', opt: true })}
        ${field('Location', `custom.${ci}.items.${i}.location`, it.location, { ph: 'Denver, CO', opt: true })}
        ${bulletsField(`custom.${ci}.items.${i}.bullets`, it.bullets, { label: 'Details', ph: 'Organised 12 fundraising events raising $45K' })}
      </div>`, { ci })).join('');
    const body = (items || `<div class="empty-state">${icon('plus-square')}<b>${esc(EMPTY.custom[0])}</b>${esc(EMPTY.custom[1])}</div>`) +
      `<button type="button" class="btn btn-add" data-action="add-custom-item" data-ci="${ci}">${icon('plus')} Add entry</button>
      <div class="card" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div class="hint">Rename the heading above to anything you need: Volunteering, Publications, Speaking, Interests. Keep it conventional so scanners can categorise it.</div>
        <button type="button" class="btn btn-danger btn-sm" data-action="remove-custom-section" data-ci="${ci}">${icon('trash')} Delete section</button>
      </div>`;
    return panelShell({ key, title: clean(sec.title) || 'Custom section', desc: 'A flexible section for anything the standard ones do not cover.', body, tools: sectionTools(key, `custom.${ci}.title`, sec.title) });
  }

  function renderDesign() {
    const s = state.settings;
    const tpl = RB.TEMPLATES.map(t => `<button type="button" class="tpl-card${s.template === t.id ? ' active' : ''}" data-action="set-template" data-tpl="${t.id}" style="--tpl-accent:${esc(s.accent)}">
        <div class="tpl-thumb ${t.id}"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="tpl-name">${esc(t.name)}</div><div class="tpl-desc">${esc(t.desc)}</div></button>`).join('');
    const fonts = RB.SAFE_FONTS.map(f => `<option value="${esc(f)}"${s.font === f ? ' selected' : ''}>${esc(f)}</option>`).join('');
    const swatches = RB.ACCENT_PRESETS.map(c => `<button type="button" class="swatch${s.accent.toLowerCase() === c ? ' active' : ''}" data-action="set-accent" data-color="${c}" style="background:${c}" title="${c}" aria-label="Accent ${c}"></button>`).join('');
    return `<div class="card"><div class="card-title">Template</div><div class="tpl-grid">${tpl}</div></div>
      <div class="card"><div class="card-title">Typography & spacing</div><div class="grid">
        <label class="fld"><span>Font</span><select data-path="settings.font">${fonts}</select></label>
        <div class="fld"><span>Paper size</span><div class="seg">
          <button type="button" data-action="set-paper" data-paper="letter" class="${s.paper === 'letter' ? 'active' : ''}">US Letter</button>
          <button type="button" data-action="set-paper" data-paper="a4" class="${s.paper === 'a4' ? 'active' : ''}">A4</button></div></div>
        <div class="fld"><span>Font size</span><div class="range-row"><input type="range" data-path="settings.fontSize" data-kind="number" data-unit="pt" min="9" max="13" step="0.5" value="${s.fontSize}"><output>${s.fontSize}pt</output></div></div>
        <div class="fld"><span>Line height</span><div class="range-row"><input type="range" data-path="settings.lineHeight" data-kind="number" data-unit="" min="1.1" max="1.7" step="0.05" value="${s.lineHeight}"><output>${s.lineHeight}</output></div></div>
        <div class="fld"><span>Page margins</span><div class="range-row"><input type="range" data-path="settings.margin" data-kind="number" data-unit="in" min="0.4" max="1.2" step="0.05" value="${s.margin}"><output>${s.margin}in</output></div></div>
        <div class="fld"><span>Section spacing</span><div class="range-row"><input type="range" data-path="settings.sectionGap" data-kind="number" data-unit="x" min="0.6" max="1.6" step="0.05" value="${s.sectionGap}"><output>${s.sectionGap}x</output></div></div>
        <div class="fld full"><span>Accent colour <em>(Modern template)</em></span><div class="swatches">${swatches}<input type="color" data-path="settings.accent" value="${esc(s.accent)}" title="Custom colour"></div></div>
      </div></div>`;
  }

  function renderLayout() {
    const rows = state.sectionOrder.map((key, i) => {
      const hidden = state.hiddenSections.includes(key);
      return `<div class="order-row${hidden ? ' hidden-row' : ''}" draggable="true" data-key="${esc(key)}">
        <span class="grip" aria-hidden="true">${icon('grip')}</span>
        <span class="name">${esc(sectionHeading(key))}</span>
        <button type="button" class="ibtn sm" data-action="toggle-hidden" data-key="${esc(key)}" title="${hidden ? 'Show on resume' : 'Hide from resume'}">${icon(hidden ? 'eye-off' : 'eye')}</button>
        <button type="button" class="ibtn sm" data-action="move-section" data-key="${esc(key)}" data-dir="-1" title="Move up"${i === 0 ? ' disabled' : ''}>${icon('arrow-up')}</button>
        <button type="button" class="ibtn sm" data-action="move-section" data-key="${esc(key)}" data-dir="1" title="Move down"${i === state.sectionOrder.length - 1 ? ' disabled' : ''}>${icon('arrow-down')}</button>
      </div>`;
    }).join('');
    return `<div class="card"><div class="order-list">${rows}</div></div>`;
  }
  function sectionHeading(key) {
    if (key.startsWith('custom:')) { const c = state.custom.find(x => 'custom:' + x.id === key); return c ? c.title : 'Custom'; }
    return state.sectionTitles[key] || key;
  }

  /* ---------------- events ---------------- */
  function bind() {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    rail.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('focusin', e => { if (e.target.matches('textarea[data-kind="bullet"]')) lastBulletTa = e.target; });
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', e => {
      const dz = e.target.closest && e.target.closest('#dropzone');
      if (dz) { e.preventDefault(); dz.classList.add('over'); return; }
      onDragOver(e);
    });
    root.addEventListener('dragleave', e => {
      const dz = e.target.closest && e.target.closest('#dropzone'); if (dz) dz.classList.remove('over');
      const r = e.target.closest && e.target.closest('.order-row'); if (r) r.classList.remove('drag-over');
    });
    root.addEventListener('drop', e => {
      const dz = e.target.closest && e.target.closest('#dropzone');
      if (dz) { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) emit('upload', { file: f }); return; }
      onDrop(e);
    });
    // Files dropped anywhere on the page are treated as an upload too.
    document.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', e => {
      if (e.target.closest && e.target.closest('#dropzone')) return;
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); emit('upload', { file: f }); }
    });
    root.addEventListener('keydown', e => { if (e.target.id === 'dropzone' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); emit('pick-file'); } });
    root.addEventListener('dragend', () => { dragKey = null; root.querySelectorAll('.order-row').forEach(r => r.classList.remove('dragging', 'drag-over')); });

    const pop = document.getElementById('verbPopover');
    pop.addEventListener('click', e => {
      const chip = e.target.closest('[data-verb]');
      if (chip) { insertVerb(pop._target, chip.dataset.verb); pop.hidden = true; return; }
      if (e.target.closest('[data-close]')) pop.hidden = true;
    });
    document.addEventListener('click', e => {
      if (!pop.hidden && !e.target.closest('#verbPopover') && !e.target.closest('[data-action="verbs"]')) pop.hidden = true;
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });

    if (!document.getElementById('dateHints')) {
      const dl = document.createElement('datalist'); dl.id = 'dateHints';
      const now = new Date();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      ['Present'].concat(...[0, 1, 2].map(d => months.map(m => `${m} ${now.getFullYear() - d}`))).forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
      document.body.appendChild(dl);
      const ll = document.createElement('datalist'); ll.id = 'levelHints';
      ['Native', 'Fluent', 'Professional working proficiency', 'Conversational', 'Basic'].forEach(v => { const o = document.createElement('option'); o.value = v; ll.appendChild(o); });
      document.body.appendChild(ll);
    }
  }

  // Modern browsers size the textarea to its content natively (CSS field-sizing); older ones get a JS fallback.
  const NATIVE_GROW = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));
  function autogrow(ta) {
    if (NATIVE_GROW || !ta.offsetWidth) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(600, Math.max(38, ta.scrollHeight + 2)) + 'px';
  }
  function autogrowAll() { if (!NATIVE_GROW) requestAnimationFrame(() => root.querySelectorAll('textarea[data-kind="bullet"]').forEach(autogrow)); }

  function applyField(el) {
    const path = el.dataset.path;
    if (!path) return false;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.dataset.kind === 'number') value = parseFloat(el.value);
    else value = el.value;
    RB.setPath(state, path, value);
    if (el.type === 'range') { const out = el.parentElement.querySelector('output'); if (out) out.textContent = el.value + (el.dataset.unit || ''); }
    if (el.dataset.kind === 'bullet') {
      autogrow(el);
      const box = el.closest('.bullets');
      const c = box && box.parentElement.querySelector('.counter');
      if (c) { const n = Array.from(box.querySelectorAll('textarea')).filter(t => t.value.trim()).length; c.textContent = `${n} bullet${n === 1 ? '' : 's'}`; }
    }
    if (path === 'summary') {
      const c = el.closest('.card').querySelector('.counter');
      const w = el.value.trim() ? el.value.trim().split(/\s+/).length : 0;
      if (c) { c.textContent = `${w} words · aim for 40–90`; c.classList.toggle('warn', w > 100); }
    }
    if (path.startsWith('custom.') && path.endsWith('.title')) {
      const t = root.querySelector('.panel-title'); if (t) t.textContent = el.value || 'Custom section';
    }
    return true;
  }

  function onInput(e) {
    const el = e.target;
    if (el.id === 'jdInput') { emit('jd', { text: el.value }); scheduleRail(); return; }
    if (el.type === 'checkbox' || el.tagName === 'SELECT') return;
    if (applyField(el)) {
      updateItemTitle(el);
      scheduleRail();
      emit('value', { path: el.dataset.path });
    }
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.toggleHidden) {
      const key = el.dataset.toggleHidden;
      if (el.checked) state.hiddenSections = state.hiddenSections.filter(k => k !== key);
      else if (!state.hiddenSections.includes(key)) state.hiddenSections.push(key);
      renderAll(); emit('structural'); return;
    }
    if (!(el.type === 'checkbox' || el.tagName === 'SELECT')) return;
    if (applyField(el)) {
      if (el.type === 'checkbox') renderPanel();
      emit('structural', { path: el.dataset.path });
    }
  }
  function updateItemTitle(el) {
    const item = el.closest('.item');
    if (!item) return;
    const titleEl = item.querySelector('.item-title');
    const head = item.querySelector('.item-body .grid');
    if (!titleEl || !head) return;
    const inputs = head.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"]');
    const first = inputs[0] ? inputs[0].value : '';
    const second = inputs[1] ? inputs[1].value : '';
    titleEl.innerHTML = (esc(first) || '<span class="untitled">Untitled</span>') + (second ? ` <small>· ${esc(second)}</small>` : '');
  }

  function onKeydown(e) {
    const el = e.target;
    if (!el.matches || !el.matches('textarea[data-kind="bullet"]')) return;
    const base = el.closest('.bullets').dataset.bullets;
    const idx = parseInt(el.dataset.path.slice(base.length + 1), 10);
    const list = ensureList(base);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Split at the caret: text after the caret moves to the new bullet.
      const pos = el.selectionStart == null ? el.value.length : el.selectionStart;
      const before = el.value.slice(0, pos), after = el.value.slice(pos);
      list[idx] = before;
      list.splice(idx + 1, 0, after);
      renderPanel(); focusBullet(base, idx + 1, 0); emit('structural');
    } else if (e.key === 'Backspace' && el.value === '' && list.length > 1) {
      e.preventDefault();
      list.splice(idx, 1);
      renderPanel(); focusBullet(base, Math.max(0, idx - 1), 'end'); emit('structural');
    } else if (e.key === 'ArrowUp' && idx > 0 && el.selectionStart === 0) {
      e.preventDefault(); focusBullet(base, idx - 1, 'end');
    } else if (e.key === 'ArrowDown' && idx < list.length - 1 && el.selectionStart === el.value.length) {
      e.preventDefault(); focusBullet(base, idx + 1, 0);
    }
  }
  function ensureList(base) {
    let list = RB.getPath(state, base);
    if (!Array.isArray(list)) { list = []; RB.setPath(state, base, list); }
    return list;
  }
  function focusBullet(base, idx, caret) {
    const ta = root.querySelector(`textarea[data-path="${base}.${idx}"]`);
    if (!ta) return;
    ta.focus();
    const pos = caret === 'end' ? ta.value.length : caret;
    ta.setSelectionRange(pos, pos);
  }

  function listFor(sec, ci) { return sec === 'customItems' ? state.custom[ci].items : state[sec]; }

  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    const sec = btn.dataset.sec;
    const ci = btn.dataset.ci != null ? parseInt(btn.dataset.ci, 10) : null;
    const idx = btn.dataset.idx != null ? parseInt(btn.dataset.idx, 10) : null;

    switch (a) {
      case 'go': go(btn.dataset.key); return;
      case 'finish': emit('finish'); return;
      case 'pick-file': emit('pick-file'); return;
      case 'ai-settings': emit('ai-settings'); return;
      case 'retry-ai': emit('retry-ai'); return;
      case 'back-simple': emit('back-simple'); return;
      case 'load-sample': emit('load-sample'); return;
      case 'revert-tailor': emit('revert-tailor'); return;
      case 'use-title': emit('use-title', { title: btn.dataset.title }); return;
      case 'add-keyword': emit('add-keyword', { kw: btn.dataset.kw }); return;
      case 'toggle-item': {
        const item = btn.closest('.item');
        item.classList.toggle('collapsed');
        if (item.classList.contains('collapsed')) collapsedItems.add(item.dataset.id); else collapsedItems.delete(item.dataset.id);
        return;
      }
      case 'add-item': {
        const it = RB.newItem(sec);
        state[sec].push(it);
        renderAll(); focusItem(it.id); emit('structural'); return;
      }
      case 'add-custom-item': {
        const it = RB.newItem('customItem');
        state.custom[ci].items.push(it);
        renderAll(); focusItem(it.id); emit('structural'); return;
      }
      case 'remove-item': listFor(sec, ci).splice(idx, 1); renderAll(); emit('structural', { removed: true }); return;
      case 'dup-item': {
        const list = listFor(sec, ci);
        const copy = JSON.parse(JSON.stringify(list[idx])); copy.id = RB.uid();
        list.splice(idx + 1, 0, copy);
        renderAll(); emit('structural'); return;
      }
      case 'move-item': {
        const list = listFor(sec, ci);
        const dir = parseInt(btn.dataset.dir, 10), j = idx + dir;
        if (j < 0 || j >= list.length) return;
        [list[idx], list[j]] = [list[j], list[idx]];
        renderPanel(); emit('structural'); return;
      }
      case 'add-bullet': {
        const base = btn.dataset.base;
        const list = ensureList(base);
        if (list.length && !clean(list[list.length - 1])) { focusBullet(base, list.length - 1, 'end'); return; }
        list.push('');
        renderPanel(); focusBullet(base, list.length - 1, 0); emit('structural'); return;
      }
      case 'remove-bullet': {
        const base = btn.dataset.base;
        const list = ensureList(base);
        if (list.length <= 1) { list.splice(0, list.length); } else list.splice(idx, 1);
        renderPanel(); emit('structural'); return;
      }
      case 'add-custom-section': {
        const s = RB.newItem('customSection');
        state.custom.push(s);
        state.sectionOrder.push('custom:' + s.id);
        active = 'custom:' + s.id;
        renderAll();
        const inp = root.querySelector('.heading-edit input');
        if (inp) { inp.focus(); inp.select(); }
        emit('structural'); return;
      }
      case 'remove-custom-section': {
        const s = state.custom[ci];
        if (s.items.length && !confirm(`Delete the "${s.title}" section and its ${s.items.length} entr${s.items.length === 1 ? 'y' : 'ies'}?`)) return;
        const list = steps(); const i = list.findIndex(x => x.key === 'custom:' + s.id);
        state.sectionOrder = state.sectionOrder.filter(k => k !== 'custom:' + s.id);
        state.hiddenSections = state.hiddenSections.filter(k => k !== 'custom:' + s.id);
        state.custom.splice(ci, 1);
        active = list[Math.max(0, i - 1)].key;
        renderAll(); emit('structural', { removed: true }); return;
      }
      case 'move-section': {
        const key = btn.dataset.key, dir = parseInt(btn.dataset.dir, 10);
        const i = state.sectionOrder.indexOf(key), j = i + dir;
        if (i < 0 || j < 0 || j >= state.sectionOrder.length) return;
        [state.sectionOrder[i], state.sectionOrder[j]] = [state.sectionOrder[j], state.sectionOrder[i]];
        renderAll(); emit('structural'); return;
      }
      case 'toggle-hidden': {
        const key = btn.dataset.key;
        if (state.hiddenSections.includes(key)) state.hiddenSections = state.hiddenSections.filter(k => k !== key);
        else state.hiddenSections.push(key);
        renderAll(); emit('structural'); return;
      }
      case 'set-template': state.settings.template = btn.dataset.tpl; renderPanel(); emit('structural', { path: 'settings.template' }); return;
      case 'set-accent': state.settings.accent = btn.dataset.color; renderPanel(); emit('structural', { path: 'settings.accent' }); return;
      case 'set-paper': state.settings.paper = btn.dataset.paper; renderPanel(); emit('structural', { path: 'settings.paper' }); return;
      case 'verbs': {
        const box = btn.closest('.fld').querySelector('.bullets');
        let ta = lastBulletTa && box.contains(lastBulletTa) ? lastBulletTa : null;
        if (!ta) { const all = box.querySelectorAll('textarea'); ta = Array.from(all).find(t => !t.value.trim()) || all[all.length - 1]; }
        openVerbs(btn, ta); return;
      }
    }
  }

  function focusItem(id) {
    const item = root.querySelector(`.item[data-id="${id}"]`);
    if (!item) return;
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const inp = item.querySelector('input[type="text"]');
    if (inp) inp.focus();
  }

  /* ---- drag & drop for section order ---- */
  function onDragStart(e) {
    const row = e.target.closest && e.target.closest('.order-row');
    if (!row) return;
    dragKey = row.dataset.key;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragKey); } catch (err) { /* ignore */ }
  }
  function onDragOver(e) {
    const row = e.target.closest && e.target.closest('.order-row');
    if (!row || !dragKey) return;
    e.preventDefault();
    root.querySelectorAll('.order-row.drag-over').forEach(r => r.classList.remove('drag-over'));
    if (row.dataset.key !== dragKey) row.classList.add('drag-over');
  }
  function onDrop(e) {
    const row = e.target.closest && e.target.closest('.order-row');
    if (!row || !dragKey) return;
    e.preventDefault();
    const from = state.sectionOrder.indexOf(dragKey), to = state.sectionOrder.indexOf(row.dataset.key);
    if (from < 0 || to < 0 || from === to) return;
    const [k] = state.sectionOrder.splice(from, 1);
    state.sectionOrder.splice(to, 0, k);
    dragKey = null;
    renderAll(); emit('structural');
  }

  /* ---- action verb popover ---- */
  function openVerbs(btn, textarea) {
    const pop = document.getElementById('verbPopover');
    pop._target = textarea;
    pop.innerHTML = `<div class="pop-head"><span>Click a verb to insert it at the cursor</span><button type="button" class="ibtn sm" data-close aria-label="Close">${icon('x')}</button></div>` +
      Object.entries(RB.ACTION_VERBS).map(([g, vs]) => `<h4>${esc(g)}</h4><div class="chips">${vs.map(v => `<button type="button" class="chip" data-verb="${esc(v)}">${esc(v)}</button>`).join('')}</div>`).join('');
    const r = btn.getBoundingClientRect();
    pop.hidden = false;
    const w = Math.min(380, window.innerWidth - 20);
    const left = Math.min(r.left, window.innerWidth - w - 10);
    let top = r.bottom + 6;
    if (top + 360 > window.innerHeight) top = Math.max(10, r.top - 366);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function insertVerb(ta, verb) {
    if (!ta) return;
    const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const end = ta.selectionEnd == null ? start : ta.selectionEnd;
    const before = ta.value.slice(0, start), after = ta.value.slice(end);
    const text = (before === '' || before.endsWith(' ') || before.endsWith('\n') ? '' : ' ') + verb + ' ';
    ta.value = before + text + after;
    const pos = start + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function refreshAiCards() { if (active === 'upload' || active === 'jd') renderPanel(); }
  window.Editor = { init, setState, go, getActive, focusFirst, renderRail, setUploadStatus, setJdResults, refreshAiCards, steps: () => steps().map(s => s.key) };
})();
