/* =====================================================================
   Turns state into the resume HTML shown in the preview and printed to
   PDF, plus a structured plain-text version used by the TXT export and
   the ATS analyser. Exposes window.Preview
   ===================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = s => String(s == null ? '' : s).trim();
  const lines = arr => (arr || []).map(clean).filter(Boolean);
  const DASH = ' – ';

  function linkText(u) { return clean(u).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''); }
  function linkHref(u) { u = clean(u); if (!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u; }
  function range(start, end, current) {
    start = clean(start); end = current ? 'Present' : clean(end);
    if (start && end) return start + DASH + end;
    return start || end;
  }

  function isHidden(state, key) { return state.hiddenSections.includes(key); }

  /* ---------- HTML ---------- */
  function render(state) {
    const s = state.settings;
    let html = `<div class="resume tpl-${esc(s.template)}">`;
    html += header(state);
    state.sectionOrder.forEach(key => {
      if (isHidden(state, key)) return;
      html += sectionHtml(state, key);
    });
    html += '</div>';
    return html;
  }

  function header(state) {
    const p = state.personal;
    const contact = [];
    if (clean(p.email)) contact.push(`<span><a href="mailto:${esc(clean(p.email))}">${esc(clean(p.email))}</a></span>`);
    if (clean(p.phone)) contact.push(`<span>${esc(clean(p.phone))}</span>`);
    if (clean(p.location)) contact.push(`<span>${esc(clean(p.location))}</span>`);
    ['linkedin', 'website', 'github'].forEach(k => {
      if (clean(p[k])) contact.push(`<span><a href="${esc(linkHref(p[k]))}">${esc(linkText(p[k]))}</a></span>`);
    });
    return `<header class="r-header">
      <div class="r-identity">
        <h1 class="r-name">${esc(clean(p.fullName)) || 'Your Name'}</h1>
        ${clean(p.title) ? `<div class="r-title">${esc(clean(p.title))}</div>` : ''}
      </div>
      ${contact.length ? `<div class="r-contact">${contact.join('')}</div>` : ''}
    </header>`;
  }

  function wrap(title, inner, cls) {
    if (!inner) return '';
    return `<section class="r-section ${cls || ''}"><h2>${esc(title)}</h2>${inner}</section>`;
  }
  function bullets(arr) {
    const b = lines(arr);
    return b.length ? `<ul>${b.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  }
  function head(primary, date) {
    return `<div class="r-item-head"><span class="r-primary">${esc(primary)}</span>${date ? `<span class="r-date">${esc(date)}</span>` : ''}</div>`;
  }
  function sub(secondary, loc, italic = true) {
    if (!secondary && !loc) return '';
    return `<div class="r-item-sub"><span class="${italic ? 'r-secondary' : ''}">${esc(secondary)}</span>${loc ? `<span class="r-loc">${esc(loc)}</span>` : ''}</div>`;
  }

  function sectionHtml(state, key) {
    const t = state.sectionTitles;
    switch (key) {
      case 'summary':
        return clean(state.summary) ? wrap(t.summary, `<p class="r-summary">${esc(clean(state.summary))}</p>`) : '';
      case 'experience': {
        const items = state.experience.filter(e => clean(e.role) || clean(e.company) || lines(e.bullets).length);
        return wrap(t.experience, items.map(e => `<div class="r-item">${head(clean(e.role) || clean(e.company), range(e.start, e.end, e.current))}${clean(e.role) ? sub(clean(e.company), clean(e.location)) : sub('', clean(e.location))}${bullets(e.bullets)}</div>`).join(''));
      }
      case 'education': {
        const items = state.education.filter(e => clean(e.school) || clean(e.degree));
        return wrap(t.education, items.map(e => {
          const degree = [clean(e.degree), clean(e.field)].filter(Boolean).join(', ');
          const details = [clean(e.gpa) ? 'GPA: ' + clean(e.gpa) : '', clean(e.details)].filter(Boolean).join(' | ');
          return `<div class="r-item">${head(degree || clean(e.school), range(e.start, e.end))}${degree ? sub(clean(e.school), clean(e.location)) : sub('', clean(e.location))}${details ? `<div class="r-desc">${esc(details)}</div>` : ''}</div>`;
        }).join(''));
      }
      case 'skills': {
        const rows = state.skills.filter(s => clean(s.items));
        return wrap(t.skills, rows.map(s => `<div class="r-skill-row">${clean(s.category) ? `<span class="r-skill-cat">${esc(clean(s.category))}</span>` : ''}<span>${esc(clean(s.items))}</span></div>`).join(''), 'r-skills');
      }
      case 'projects': {
        const items = state.projects.filter(p => clean(p.name) || lines(p.bullets).length);
        return wrap(t.projects, items.map(p => {
          const meta = [clean(p.tech) ? 'Technologies: ' + clean(p.tech) : '', clean(p.link) ? linkText(p.link) : ''].filter(Boolean).join(' | ');
          return `<div class="r-item">${head(clean(p.name), range(p.start, p.end))}${meta ? `<div class="r-meta">${esc(meta)}</div>` : ''}${bullets(p.bullets)}</div>`;
        }).join(''));
      }
      case 'certifications': {
        const items = state.certifications.filter(c => clean(c.name));
        return wrap(t.certifications, items.map(c => `<div class="r-item">${head(clean(c.name), clean(c.date))}${sub([clean(c.issuer), clean(c.link) ? linkText(c.link) : ''].filter(Boolean).join(' | '), '')}</div>`).join(''));
      }
      case 'awards': {
        const items = state.awards.filter(a => clean(a.title));
        return wrap(t.awards, items.map(a => `<div class="r-item">${head(clean(a.title), clean(a.date))}${sub(clean(a.issuer), '')}${clean(a.description) ? `<div class="r-desc">${esc(clean(a.description))}</div>` : ''}</div>`).join(''));
      }
      case 'languages': {
        const items = state.languages.filter(l => clean(l.name));
        return wrap(t.languages, items.length ? `<div class="r-inline-list">${items.map(l => `<span>${esc(clean(l.name))}${clean(l.level) ? ` (${esc(clean(l.level))})` : ''}</span>`).join('')}</div>` : '');
      }
      default: {
        if (!key.startsWith('custom:')) return '';
        const sec = state.custom.find(c => 'custom:' + c.id === key);
        if (!sec) return '';
        const items = sec.items.filter(i => clean(i.heading) || clean(i.subheading) || lines(i.bullets).length);
        return wrap(sec.title, items.map(i => `<div class="r-item">${head(clean(i.heading) || clean(i.subheading), clean(i.date))}${clean(i.heading) ? sub(clean(i.subheading), clean(i.location)) : sub('', clean(i.location))}${bullets(i.bullets)}</div>`).join(''));
      }
    }
  }

  /* ---------- Structured plain text ----------
     Returns { header: {name,title,contact[]}, sections: [{title, blocks:[{title, date, sub, loc, lines[] , text}]}] } */
  function structure(state) {
    const p = state.personal;
    const contact = [clean(p.email), clean(p.phone), clean(p.location), linkText(p.linkedin), linkText(p.website), linkText(p.github)].filter(Boolean);
    const out = { name: clean(p.fullName), title: clean(p.title), contact, sections: [] };
    const t = state.sectionTitles;
    state.sectionOrder.forEach(key => {
      if (isHidden(state, key)) return;
      const sec = { key, title: '', blocks: [] };
      switch (key) {
        case 'summary':
          if (!clean(state.summary)) return;
          sec.title = t.summary; sec.blocks.push({ text: clean(state.summary) }); break;
        case 'experience':
          sec.title = t.experience;
          state.experience.forEach(e => { if (clean(e.role) || clean(e.company)) sec.blocks.push({ title: clean(e.role), sub: clean(e.company), loc: clean(e.location), date: range(e.start, e.end, e.current), lines: lines(e.bullets) }); });
          break;
        case 'education':
          sec.title = t.education;
          state.education.forEach(e => { if (clean(e.school) || clean(e.degree)) sec.blocks.push({ title: [clean(e.degree), clean(e.field)].filter(Boolean).join(', '), sub: clean(e.school), loc: clean(e.location), date: range(e.start, e.end), text: [clean(e.gpa) ? 'GPA: ' + clean(e.gpa) : '', clean(e.details)].filter(Boolean).join(' | ') }); });
          break;
        case 'skills':
          sec.title = t.skills;
          state.skills.forEach(s => { if (clean(s.items)) sec.blocks.push({ text: (clean(s.category) ? clean(s.category) + ': ' : '') + clean(s.items), category: clean(s.category), items: clean(s.items) }); });
          break;
        case 'projects':
          sec.title = t.projects;
          state.projects.forEach(p => { if (clean(p.name) || lines(p.bullets).length) sec.blocks.push({ title: clean(p.name), date: range(p.start, p.end), text: [clean(p.tech) ? 'Technologies: ' + clean(p.tech) : '', linkText(p.link)].filter(Boolean).join(' | '), lines: lines(p.bullets) }); });
          break;
        case 'certifications':
          sec.title = t.certifications;
          state.certifications.forEach(c => { if (clean(c.name)) sec.blocks.push({ title: clean(c.name), sub: [clean(c.issuer), linkText(c.link)].filter(Boolean).join(' | '), date: clean(c.date) }); });
          break;
        case 'awards':
          sec.title = t.awards;
          state.awards.forEach(a => { if (clean(a.title)) sec.blocks.push({ title: clean(a.title), sub: clean(a.issuer), date: clean(a.date), text: clean(a.description) }); });
          break;
        case 'languages': {
          sec.title = t.languages;
          const l = state.languages.filter(x => clean(x.name)).map(x => clean(x.name) + (clean(x.level) ? ` (${clean(x.level)})` : ''));
          if (l.length) sec.blocks.push({ text: l.join(', ') });
          break;
        }
        default: {
          const cs = state.custom.find(c => 'custom:' + c.id === key);
          if (!cs) return;
          sec.title = cs.title;
          cs.items.forEach(i => { if (clean(i.heading) || clean(i.subheading) || lines(i.bullets).length) sec.blocks.push({ title: clean(i.heading), sub: clean(i.subheading), loc: clean(i.location), date: clean(i.date), lines: lines(i.bullets) }); });
        }
      }
      if (sec.blocks.length) out.sections.push(sec);
    });
    return out;
  }

  function toText(state) {
    const s = structure(state);
    const out = [];
    if (s.name) out.push(s.name.toUpperCase());
    if (s.title) out.push(s.title);
    if (s.contact.length) out.push(s.contact.join(' | '));
    s.sections.forEach(sec => {
      out.push('', sec.title.toUpperCase(), '-'.repeat(Math.min(60, sec.title.length + 4)));
      sec.blocks.forEach(b => {
        const headParts = [b.title, b.sub, b.loc].filter(Boolean).join(' | ');
        if (headParts) out.push(headParts + (b.date ? ' | ' + b.date : ''));
        else if (b.date) out.push(b.date);
        if (b.text) out.push(b.text);
        (b.lines || []).forEach(l => out.push('- ' + l));
        if (b.title || b.lines) out.push('');
      });
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  window.Preview = { render, structure, toText, range, linkText };
})();
