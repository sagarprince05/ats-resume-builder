/* =====================================================================
   Resume import: reads PDF / Word / text files and extracts contact
   details, summary, experience, education, skills, projects and more
   into the app's data model. Heuristic, so the user reviews the result.
   Exposes window.ResumeParser
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const clean = s => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------------- file readers ---------------- */
  async function pdfToLines(file) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('The PDF reader did not load. Try a Word or text file instead.');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        const h = Math.abs(it.transform[3]) || it.height || 10;
        let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, str: it.str, w: it.width || 0, h });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        let line = '', lastEnd = null;
        r.items.forEach(it => {
          if (lastEnd != null) {
            const gap = it.x - lastEnd;
            if (gap > it.h * 2.5) line += ' | ';
            else if (gap > it.h * 0.15 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
          }
          line += it.str;
          lastEnd = it.x + it.w;
        });
        lines.push(clean(line));
      });
      lines.push('');
    }
    return lines;
  }

  async function docxToLines(file) {
    const mammoth = window.mammoth;
    if (!mammoth) throw new Error('The Word reader did not load. Try a PDF or text file instead.');
    const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const doc = new DOMParser().parseFromString('<div>' + res.value + '</div>', 'text/html');
    const lines = [];
    const walk = node => {
      node.childNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        if (tag === 'li') { lines.push('• ' + clean(n.textContent)); return; }
        if (tag === 'tr') { lines.push(Array.from(n.querySelectorAll('td,th')).map(c => clean(c.textContent)).filter(Boolean).join(' | ')); return; }
        if (/^(p|h[1-6])$/.test(tag)) { lines.push(clean(n.textContent)); if (/^h/.test(tag)) lines.push(''); return; }
        if (tag === 'br') { lines.push(''); return; }
        walk(n);
      });
    };
    walk(doc.body.firstChild);
    return lines;
  }

  async function parseFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.json')) {
      const state = await window.Exporter.readJSONFile(file);
      return { state, source: 'json', found: describe(state) };
    }
    let lines;
    if (name.endsWith('.pdf') || file.type === 'application/pdf') lines = await pdfToLines(file);
    else if (name.endsWith('.docx')) lines = await docxToLines(file);
    else if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.rtf') || file.type.startsWith('text/')) lines = (await file.text()).split(/\r?\n/).map(clean);
    else if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save it as .docx or PDF from Word first.');
    else throw new Error('Unsupported file type. Use a PDF, Word (.docx), text file, or a backup (.json).');
    if (!lines.some(l => l)) throw new Error('No readable text was found. If this is a scanned PDF, export a text-based PDF or Word file from your editor first.');
    return parseLines(lines);
  }

  function parseText(text) { return parseLines(String(text || '').split(/\r?\n/).map(clean)); }

  /* ---------------- patterns ---------------- */
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE = `(?:${MONTH}\\s*,?\\s*)?(?:19|20)\\d{2}|\\d{1,2}\\/(?:19|20)?\\d{2}`;
  const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until|through|till)\\s*(${DATE}|present|current|now|ongoing|today|to date|till date)`, 'i');
  const YEAR = /\b(?:19|20)\d{2}\b/;
  const BULLET = /^\s*(?:[••▪●◦‣⁃➢✓\-\*·▪○●■➢►]|\d+[.)])\s+/;
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
  const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?/i;
  const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
  const URL = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|app|ai|tech|design|info|us|uk|in|ca|de|fr|es|it|nl|se|ch|xyz|site|page|portfolio)\b(?:\/[\w./-]*)?/i;
  const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|YT|NU';
  const COUNTRIES = 'USA|U\\.S\\.A?\\.?|United States|UK|U\\.K\\.|United Kingdom|England|Scotland|Wales|Ireland|India|Canada|Germany|France|Australia|Singapore|Netherlands|Spain|Italy|UAE|United Arab Emirates|Japan|China|Brazil|Mexico|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Portugal|Poland|New Zealand|South Africa|Pakistan|Bangladesh|Sri Lanka|Nepal|Philippines|Indonesia|Malaysia|Vietnam|Thailand|Israel|Turkey|Egypt|Nigeria|Kenya|Argentina|Chile|Colombia|Saudi Arabia|Qatar|Hong Kong|South Korea|Taiwan|Czech Republic|Hungary|Romania|Greece|Ukraine|Russia';
  const CITY = "[A-Z][a-zA-Z.'-]+(?:\\s[A-Z][a-zA-Z.'-]+){0,2}";
  const LOCATION = new RegExp(`\\b(${CITY},\\s*(?:(?:${STATES})\\b|(?:${COUNTRIES})\\b))(?:\\s\\d{5})?`);
  const TRAILING_LOC = new RegExp(`(?:^|,\\s*|\\s[-–|]\\s)(${CITY},\\s*(?:(?:${STATES})\\b|(?:${COUNTRIES})\\b))(?:\\s\\d{5})?\\s*$`);
  const WORK_MODE = /^(?:remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|internship|freelance|temporary|seasonal)$/i;
  const ROLE_WORDS = /\b(engineer|developer|manager|analyst|designer|specialist|coordinator|director|lead|consultant|accountant|nurse|associate|administrator|scientist|architect|intern|representative|technician|officer|assistant|executive|strategist|writer|editor|marketer|recruiter|teacher|instructor|therapist|pharmacist|physician|paralegal|attorney|controller|auditor|planner|buyer|supervisor|operator|clerk|agent|advisor|partner|head|vp|president|cto|cfo|coo|ceo|founder|owner|freelance|contractor|programmer|researcher|fellow|professor|lecturer|tutor|trainer|sales|support|producer|artist|photographer|chef|cook|driver|mechanic|electrician|plumber|welder|carpenter|mentor|volunteer|coach|member|chair|chairperson|ambassador|organizer|organiser|secretary|treasurer|captain|student|apprentice|generalist)\b/i;
  const STRONG_COMPANY = /\b(inc|llc|ltd|limited|corp|corporation|company|gmbh|plc|pvt|s\.a\.|ag|holdings|incorporated)\b\.?/i;
  const COMPANY_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|labs|group|solutions|systems|software|studio|studios|agency|partners|consulting|bank|hospital|clinic|university|college|school|institute|foundation|gmbh|plc|pvt|s\.a\.|ag|holdings|enterprises|industries|ventures)\b\.?/i;
  const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|faculty|iit|mit|nit|iim)\b/i;
  const DEGREE_WORDS = /\b(bachelor|master|b\.?\s?(?:sc|s|a|e|tech|eng|com|ba)\b|m\.?\s?(?:sc|s|a|e|tech|eng|com|ba|phil)\b|mba|ph\.?d|doctor|associate|diploma|certificate|a\.?a\.?s?|high school|secondary|matriculation|b\.?\s?arch|llb|llm|md|bsn|msn|bba|bca|mca|honours|hons)\b/i;

  const HEADINGS = [
    { key: 'summary', re: /^(?:professional\s+|career\s+|executive\s+|personal\s+)?(?:summary|profile|objective|about(?:\s+me)?|overview|introduction)\b/i },
    { key: 'experience', re: /^(?:work|professional|employment|relevant|career|industry)?\s*(?:experience|history|employment|background)\b|^career\b|^positions?\s+held/i },
    { key: 'education', re: /^(?:education|academic|qualifications|academics|educational)/i },
    { key: 'skills', re: /^(?:technical\s+|core\s+|key\s+|professional\s+|relevant\s+)?(?:skills|competencies|technologies|expertise|tech(?:nical)?\s+stack|tools|proficiencies|strengths)/i },
    { key: 'projects', re: /^(?:personal\s+|key\s+|selected\s+|notable\s+|academic\s+|side\s+)?projects?\b/i },
    { key: 'certifications', re: /^(?:certifications?|licenses?|licences?|certificates?|credentials|professional\s+development)/i },
    { key: 'awards', re: /^(?:awards?|honou?rs?|achievements?|recognition|accomplishments)/i },
    { key: 'languages', re: /^languages?\b/i },
    { key: 'custom', re: /^(?:volunteer(?:ing)?|community|publications?|interests?|hobbies|activities|leadership|extracurricular|references|additional(?:\s+information)?|speaking|presentations?|training|courses?|coursework|memberships?|affiliations?|patents?|research)/i }
  ];

  function isBullet(l) { return BULLET.test(l); }
  function stripBullet(l) { return clean(l.replace(BULLET, '')); }
  function headingFor(line) {
    const l = clean(line).replace(/[:\-–—_]+$/, '').trim();
    if (!l || l.length > 42 || l.split(' ').length > 5 || isBullet(line) || RANGE.test(l) || l.includes('|')) return null;
    const upper = l === l.toUpperCase();
    const titleCase = /^[A-Z]/.test(l);
    if (!upper && !titleCase && !/:$/.test(clean(line))) return null;
    for (const h of HEADINGS) if (h.re.test(l)) return { key: h.key, title: l.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase()) };
    return null;
  }
  function extractRange(text) {
    const m = RANGE.exec(text);
    if (!m) return null;
    const end = m[2];
    const current = /present|current|now|ongoing|today|date/i.test(end);
    return { start: tidyDate(m[1]), end: current ? '' : tidyDate(end), current, raw: m[0] };
  }
  function tidyDate(s) { return clean(s).replace(/\./g, '').replace(/,/g, '').replace(/\b(\w{3})\w*\b/g, (m, a) => /^(?:19|20)\d{2}$/.test(m) ? m : a[0].toUpperCase() + a.slice(1).toLowerCase()); }
  function looksLikeTitle(l) {
    return l.split(' ').length <= 9 && !/[.!?]$/.test(l) && (ROLE_WORDS.test(l) || COMPANY_WORDS.test(l) || /^[A-Z][\w&.,'()\-\s]+$/.test(l) && l.split(' ').filter(w => /^[A-Z]/.test(w)).length >= Math.ceil(l.split(' ').length * 0.6));
  }

  /* ---------------- main ---------------- */
  function parseLines(rawLines) {
    const lines = rawLines.map(clean);
    const state = RB.defaultState();
    const found = {};

    // 1. Split into sections.
    const sections = [];            // {key, title, lines}
    let header = [];
    let cur = null;
    lines.forEach(line => {
      const h = headingFor(line);
      if (h) { cur = { key: h.key, title: h.title, lines: [] }; sections.push(cur); return; }
      if (cur) cur.lines.push(line); else header.push(line);
    });

    // 2. Contact block: header lines, or the first lines of the document if nothing preceded a heading.
    const headerText = header.filter(Boolean).join('\n');
    const allText = lines.join('\n');
    const p = state.personal;
    const email = EMAIL.exec(headerText) || EMAIL.exec(allText);
    if (email) p.email = email[0];
    const li = LINKEDIN.exec(allText); if (li) p.linkedin = li[0].replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const gh = GITHUB.exec(allText); if (gh) p.github = gh[0].replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const phoneSrc = headerText || allText;
    const phones = (phoneSrc.match(new RegExp(PHONE.source, 'g')) || []).filter(x => x.replace(/\D/g, '').length >= 10 && x.replace(/\D/g, '').length <= 15 && !YEAR.test(x.replace(/\D/g, '').slice(0, 0)));
    if (phones.length) p.phone = clean(phones[0]);
    const scrub = s => s.replace(EMAIL, ' ').replace(LINKEDIN, ' ').replace(GITHUB, ' ').replace(p.phone ? p.phone : /$^/, ' ');
    const headScrubbed = header.map(scrub);
    const urls = (scrub(headerText).match(new RegExp(URL.source, 'gi')) || []).filter(u => !/linkedin|github/i.test(u) && !(p.email && p.email.includes(u)));
    if (urls.length) p.website = urls[0].replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const loc = LOCATION.exec(scrub(headerText).replace(/[|•·]/g, '\n'));
    if (loc) p.location = clean(loc[1]);
    else { const rm = /\b(remote)\b/i.exec(scrub(headerText)); if (rm) p.location = 'Remote'; }

    // Name: first plausible short line of the header (or of the document).
    const candidates = (header.filter(Boolean).length ? headScrubbed : lines.slice(0, 6)).flatMap(l => l.split(/\s*[|•·]\s*/)).map(clean).filter(Boolean);
    const isName = s => { const w = s.split(' '); return w.length >= 2 && w.length <= 4 && /^[A-Za-z][A-Za-z.'\-]*(?:\s[A-Za-z][A-Za-z.'\-]*)+$/.test(s) && !ROLE_WORDS.test(s) && !/resume|curriculum|vitae|cv\b/i.test(s) && !LOCATION.test(s) && !RANGE.test(s); };
    const nameIdx = candidates.findIndex(isName);
    if (nameIdx > -1) p.fullName = candidates[nameIdx].replace(/\b\w/g, c => c.toUpperCase());
    const titleCand = candidates.find((c, i) => i !== nameIdx && c.split(' ').length <= 6 && !/\d/.test(c) && !LOCATION.test(c) && !URL.test(c) && !/@/.test(c) && (ROLE_WORDS.test(c) || (nameIdx > -1 && i === nameIdx + 1 && /^[A-Z]/.test(c))));
    if (titleCand) p.title = titleCand;
    found.contact = [p.fullName, p.email, p.phone].filter(Boolean).length;

    // 3. Sections.
    const order = [];
    sections.forEach(sec => {
      const body = sec.lines;
      switch (sec.key) {
        case 'summary': {
          const txt = body.filter(Boolean).map(stripBullet).join(' ');
          if (txt) { state.summary = (state.summary ? state.summary + ' ' : '') + txt; pushOrder(order, 'summary'); }
          break;
        }
        case 'experience': {
          const entries = parseEntries(body);
          entries.forEach(e => {
            const it = RB.newItem('experience');
            Object.assign(it, resolveHeader(e.headerLines), { bullets: e.bullets });
            if (it.role || it.company || it.bullets.length) state.experience.push(it);
          });
          if (state.experience.length) pushOrder(order, 'experience');
          break;
        }
        case 'projects': {
          const entries = parseEntries(body);
          entries.forEach(e => {
            const it = RB.newItem('projects');
            const head = e.headerLines.join(' | ');
            const r = extractRange(head);
            if (r) { it.start = r.start; it.end = r.current ? 'Present' : r.end; }
            let rest = r ? head.replace(r.raw, '') : head;
            const url = URL.exec(rest); if (url) { it.link = url[0]; rest = rest.replace(url[0], ''); }
            const parts = rest.split(/\s*[|•·—–]\s*/).map(clean).filter(Boolean);
            it.name = parts[0] || '';
            if (parts[1]) it.tech = parts.slice(1).join(', ');
            it.bullets = e.bullets.filter(b => {
              const m = /^(?:technologies|tech(?:nology)?\s*stack|tech|stack|tools|built with)\s*:\s*(.+)$/i.exec(b);
              if (m) { it.tech = it.tech ? it.tech + ', ' + m[1] : m[1]; return false; }
              return true;
            });
            if (it.name || it.bullets.length) state.projects.push(it);
          });
          if (state.projects.length) pushOrder(order, 'projects');
          break;
        }
        case 'education': {
          parseEducation(body).forEach(e => state.education.push(e));
          if (state.education.length) pushOrder(order, 'education');
          break;
        }
        case 'skills': {
          parseSkills(body).forEach(s => state.skills.push(s));
          if (state.skills.length) pushOrder(order, 'skills');
          break;
        }
        case 'certifications': {
          body.filter(Boolean).forEach(l => {
            const it = RB.newItem('certifications');
            let t = stripBullet(l);
            const y = YEAR.exec(t); if (y) { it.date = y[0]; t = t.replace(/\(?\b(?:19|20)\d{2}\b\)?/, ''); }
            const url = URL.exec(t); if (url && /credly|credential|verify|badge|cert/i.test(url[0])) { it.link = url[0]; t = t.replace(url[0], ''); }
            const parts = t.split(/\s*[|•·—–]\s*|\s+-\s+|\s*,\s*|\s+by\s+|\s+from\s+|\s*\(\s*|\s*\)\s*/).map(clean).filter(Boolean);
            it.name = parts[0] || ''; it.issuer = parts.slice(1).join(', ');
            if (it.name) state.certifications.push(it);
          });
          if (state.certifications.length) pushOrder(order, 'certifications');
          break;
        }
        case 'awards': {
          body.filter(Boolean).forEach(l => {
            const it = RB.newItem('awards');
            let t = stripBullet(l);
            const y = YEAR.exec(t); if (y) { it.date = y[0]; t = t.replace(/\(?\b(?:19|20)\d{2}\b\)?/, ''); }
            const parts = t.split(/\s*[|•·—–]\s*|\s+-\s+|\s*,\s*/).map(clean).filter(Boolean);
            it.title = parts[0] || ''; it.issuer = parts[1] || ''; it.description = parts.slice(2).join(', ');
            if (it.title) state.awards.push(it);
          });
          if (state.awards.length) pushOrder(order, 'awards');
          break;
        }
        case 'languages': {
          body.filter(Boolean).flatMap(l => stripBullet(l).split(/\s*[,|•·;]\s*/)).map(clean).filter(Boolean).forEach(t => {
            const m = /^([A-Za-zÀ-ɏ ]+?)\s*(?:[(:\-–—]\s*([^)]+?)\)?)?$/.exec(t);
            if (!m) return;
            const it = RB.newItem('languages'); it.name = clean(m[1]); it.level = clean(m[2] || '');
            if (it.name && it.name.length < 30) state.languages.push(it);
          });
          if (state.languages.length) pushOrder(order, 'languages');
          break;
        }
        default: {
          const items = body.filter(Boolean).map(stripBullet);
          if (!items.length) break;
          const cs = RB.newItem('customSection'); cs.title = sec.title;
          const entries = parseEntries(body);
          const structured = entries.length > 1 || (entries[0] && entries[0].bullets.length && entries[0].headerLines.length);
          if (structured) {
            entries.forEach(e => {
              const h = resolveHeader(e.headerLines);
              const it = RB.newItem('customItem');
              it.heading = h.role || h.company; it.subheading = h.role ? h.company : ''; it.location = h.location;
              it.date = h.start ? (h.start + (h.current ? ' – Present' : h.end ? ' – ' + h.end : '')) : '';
              it.bullets = e.bullets;
              if (it.heading || it.bullets.length) cs.items.push(it);
            });
          } else {
            const it = RB.newItem('customItem'); it.bullets = items; cs.items.push(it);
          }
          state.custom.push(cs);
          pushOrder(order, 'custom:' + cs.id);
        }
      }
    });

    // Nothing recognised: keep every line so the user can sort it out.
    if (!sections.length) {
      const rest = lines.filter(Boolean).filter(l => !headScrubbed.includes(l));
      if (rest.length) {
        const cs = RB.newItem('customSection'); cs.title = 'Imported Content';
        const it = RB.newItem('customItem'); it.bullets = rest.map(stripBullet); cs.items.push(it);
        state.custom.push(cs); pushOrder(order, 'custom:' + cs.id);
      }
    }
    RB.DEFAULT_ORDER.forEach(k => pushOrder(order, k));
    state.sectionOrder = order;
    const normalized = RB.normalize(state);
    return { state: normalized, source: 'text', found: describe(normalized), text: rawLines.map(clean).join('\n').replace(/\n{3,}/g, '\n\n').trim() };
  }

  function pushOrder(order, key) { if (!order.includes(key)) order.push(key); }

  function parseEntries(body) {
    const entries = [];
    let cur = null;
    const start = () => { cur = { headerLines: [], bullets: [], dated: false }; entries.push(cur); };
    const nonEmpty = body.map((l, i) => ({ l, i })).filter(x => x.l);
    nonEmpty.forEach((x, n) => {
      const l = x.l;
      const next = nonEmpty[n + 1] ? nonEmpty[n + 1].l : '';
      const blankBefore = x.i > 0 && body[x.i - 1] === '';
      if (isBullet(l)) { if (!cur) start(); cur.bullets.push(stripBullet(l)); return; }
      const hasDate = RANGE.test(l);
      const nextHasDate = next && !isBullet(next) && RANGE.test(next);
      if (!cur) { start(); cur.headerLines.push(l); cur.dated = hasDate; return; }
      if (cur.bullets.length) {
        if (hasDate || nextHasDate || (blankBefore && looksLikeTitle(l)) || looksLikeTitle(l) && l.length < 60) { start(); cur.headerLines.push(l); cur.dated = hasDate; return; }
        const last = cur.bullets[cur.bullets.length - 1];
        if (last && !/[.!?;:]$/.test(last) && /^[a-z(]/.test(l)) cur.bullets[cur.bullets.length - 1] = last + ' ' + l;
        else cur.bullets.push(l);
        return;
      }
      // Current entry has only header lines so far.
      if ((cur.dated && hasDate) || (cur.headerLines.length >= 2 && blankBefore) || cur.headerLines.length >= 3) {
        if (looksLikeTitle(l) || hasDate) { start(); cur.headerLines.push(l); cur.dated = hasDate; return; }
        cur.bullets.push(l); return;
      }
      if (cur.headerLines.length >= 1 && !hasDate && !nextHasDate && !looksLikeTitle(l) && l.length > 60) { cur.bullets.push(l); return; }
      cur.headerLines.push(l); if (hasDate) cur.dated = true;
    });
    return entries.filter(e => e.headerLines.length || e.bullets.length);
  }

  /* Split a header-ish string into parts, pulling any "City, ST" off the end of each part. */
  function splitParts(text, out) {
    let parts = text.split(/\s*\|\s*/).flatMap(p => p.split(/\s+at\s+|\s+@\s+|\s[•·—–]\s|\s-\s/)).map(clean).filter(Boolean);
    const kept = [];
    parts.forEach(p => {
      const whole = new RegExp('^' + LOCATION.source.slice(2) + '$').exec(p);
      if (whole) { if (!out.location) out.location = clean(whole[1]); return; }
      const m = TRAILING_LOC.exec(p);
      if (m) { if (!out.location) out.location = clean(m[1]); p = clean(p.slice(0, m.index)); if (!p) return; }
      if (WORK_MODE.test(p)) { if (!out.location && /remote|hybrid/i.test(p)) out.location = p; return; }
      kept.push(p);
    });
    parts = kept;
    if (parts.length === 1 && parts[0].includes(', ')) parts = parts[0].split(/,\s*/).map(clean).filter(Boolean);
    const uniq = []; parts.forEach(p => { if (!uniq.some(u => u.toLowerCase() === p.toLowerCase())) uniq.push(p); });
    return uniq;
  }

  function resolveHeader(headerLines) {
    const out = { role: '', company: '', location: '', start: '', end: '', current: false };
    let text = headerLines.join(' | ');
    const r = extractRange(text);
    if (r) { out.start = r.start; out.end = r.end; out.current = r.current; text = text.replace(r.raw, ' | '); }
    const parts = splitParts(text, out);
    const isRole = p => ROLE_WORDS.test(p) && !STRONG_COMPANY.test(p);
    const roleIdx = parts.findIndex(isRole);
    const compIdx = parts.findIndex((p, i) => i !== roleIdx && (STRONG_COMPANY.test(p) || COMPANY_WORDS.test(p)));
    if (roleIdx > -1) out.role = parts[roleIdx];
    if (compIdx > -1) out.company = parts[compIdx];
    const rest = parts.filter((p, i) => i !== roleIdx && i !== compIdx);
    if (!out.role) out.role = rest.shift() || '';
    if (!out.company) out.company = rest.shift() || '';
    return out;
  }

  function parseEducation(body) {
    const items = [];
    let cur = null;
    const start = () => { cur = RB.newItem('education'); items.push(cur); };
    body.filter(Boolean).forEach(raw => {
      const l = stripBullet(raw);
      const r = extractRange(l);
      const single = !r && YEAR.exec(l);
      let t = r ? l.replace(r.raw, ' ') : l;
      const gpa = /\b(?:gpa|cgpa|grade)\s*[:\-]?\s*([\d.]+(?:\s*\/\s*[\d.]+)?)/i.exec(t);
      const hasSchool = SCHOOL_WORDS.test(t), hasDegree = DEGREE_WORDS.test(t);
      if (!cur || (hasSchool && cur.school) || (hasDegree && cur.degree && !hasSchool)) start();
      if (r) { cur.start = r.start; cur.end = r.current ? 'Expected' : r.end; }
      else if (single && !cur.end) { cur.end = single[0]; t = t.replace(single[0], ' '); }
      if (gpa) { cur.gpa = gpa[1]; t = t.replace(gpa[0], ' '); }
      const holder = { location: '' };
      const parts = t.split(/\s*\|\s*/).flatMap(p => p.split(/\s[•·—–]\s|\s-\s/)).map(clean).filter(Boolean).map(p => {
        const m = TRAILING_LOC.exec(p);
        if (m) { if (!holder.location) holder.location = clean(m[1]); return clean(p.slice(0, m.index)); }
        return p;
      }).filter(Boolean);
      if (holder.location && !cur.location) cur.location = holder.location;
      parts.forEach(part => {
        part = part.replace(/^[;,:\s]+|[;,:\s]+$/g, '');
        if (!part) return;
        if (SCHOOL_WORDS.test(part) && !cur.school) { cur.school = part; return; }
        if (DEGREE_WORDS.test(part) && !cur.degree) {
          let m = /^(.+?)\s+in\s+(.+)$/i.exec(part) || /^(.+?),\s*(.+)$/.exec(part);
          if (m && DEGREE_WORDS.test(m[1])) { cur.degree = clean(m[1]); cur.field = clean(m[2]); } else cur.degree = part;
          return;
        }
        if (!cur.school && !cur.degree && /^[A-Z]/.test(part) && part.split(' ').length <= 8) { cur.school = part; return; }
        cur.details = cur.details ? cur.details + '; ' + part : part;
      });
    });
    return items.filter(e => e.school || e.degree);
  }

  function parseSkills(body) {
    const groups = [];
    const loose = [];
    body.filter(Boolean).forEach(raw => {
      const l = stripBullet(raw);
      const m = /^([^:]{2,40}):\s*(.+)$/.exec(l);
      if (m) { const g = RB.newItem('skills'); g.category = clean(m[1]); g.items = splitSkills(m[2]).join(', '); if (g.items) groups.push(g); return; }
      if (/[,|•·;]/.test(l) || l.split(' ').length <= 4) loose.push(...splitSkills(l));
      else loose.push(l);
    });
    if (loose.length) { const g = RB.newItem('skills'); g.category = groups.length ? 'Other' : ''; g.items = Array.from(new Set(loose)).join(', '); groups.push(g); }
    return groups;
  }
  function splitSkills(s) { return s.split(/\s*[,|•·;]\s*|\s{2,}/).map(clean).filter(x => x && x.length < 50); }

  function describe(state) {
    const b = state.experience.reduce((n, e) => n + (e.bullets || []).filter(x => x.trim()).length, 0);
    return {
      name: state.personal.fullName, email: state.personal.email, phone: state.personal.phone, title: state.personal.title, location: state.personal.location,
      summary: !!state.summary.trim(), experience: state.experience.length, bullets: b, education: state.education.length,
      skills: state.skills.reduce((n, s) => n + s.items.split(',').filter(x => x.trim()).length, 0), projects: state.projects.length,
      certifications: state.certifications.length, awards: state.awards.length, languages: state.languages.length, custom: state.custom.map(c => c.title)
    };
  }

  window.ResumeParser = { parseFile, parseText, parseLines };
})();
