/* =====================================================================
   Data model, defaults, sample resume, persistence helpers.
   Exposes window.RB
   ===================================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'atsResumeBuilder.v1';
  const PREFS_KEY = 'atsResumeBuilder.prefs';

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  const SECTION_TITLES = {
    summary: 'Professional Summary',
    experience: 'Work Experience',
    education: 'Education',
    skills: 'Skills',
    projects: 'Projects',
    certifications: 'Certifications',
    awards: 'Awards & Honors',
    languages: 'Languages'
  };
  const SECTION_ICONS = {
    personal: '\u{1F464}', summary: '\u{1F4DD}', experience: '\u{1F4BC}', education: '\u{1F393}', skills: '\u{1F6E0}',
    projects: '\u{1F4C1}', certifications: '\u{1F4DC}', awards: '\u{1F3C6}', languages: '\u{1F310}', custom: '➕',
    design: '\u{1F3A8}', layout: '☰'
  };
  const DEFAULT_ORDER = ['summary', 'experience', 'skills', 'education', 'projects', 'certifications', 'awards', 'languages'];

  const SAFE_FONTS = ['Arial', 'Calibri', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Cambria', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Book Antiqua'];
  const FONT_STACKS = {
    'Arial': 'Arial, Helvetica, sans-serif',
    'Calibri': 'Calibri, Carlito, "Segoe UI", sans-serif',
    'Helvetica': 'Helvetica, Arial, sans-serif',
    'Georgia': 'Georgia, "Times New Roman", serif',
    'Times New Roman': '"Times New Roman", Times, serif',
    'Garamond': 'Garamond, "EB Garamond", Georgia, serif',
    'Cambria': 'Cambria, Georgia, serif',
    'Verdana': 'Verdana, Geneva, sans-serif',
    'Tahoma': 'Tahoma, Verdana, sans-serif',
    'Trebuchet MS': '"Trebuchet MS", Tahoma, sans-serif',
    'Book Antiqua': '"Book Antiqua", Palatino, "Palatino Linotype", serif'
  };

  const TEMPLATES = [
    { id: 'classic', name: 'Classic', desc: 'Centered header, ruled headings. The safest all-round choice.' },
    { id: 'modern', name: 'Modern', desc: 'Left-aligned with an accent colour on the name and headings.' },
    { id: 'minimal', name: 'Minimal', desc: 'Quiet, no rules, plenty of white space.' },
    { id: 'compact', name: 'Compact', desc: 'Tighter spacing to fit more on one page.' },
    { id: 'executive', name: 'Executive', desc: 'Formal double rules and centered headings.' }
  ];

  const ACCENT_PRESETS = ['#1f3a5f', '#0f766e', '#7c2d12', '#4c1d95', '#1e40af', '#374151', '#9f1239', '#065f46'];

  const ACTION_VERBS = {
    'Leadership': ['Led', 'Directed', 'Managed', 'Coordinated', 'Mentored', 'Supervised', 'Oversaw', 'Spearheaded', 'Guided', 'Chaired'],
    'Achievement': ['Achieved', 'Delivered', 'Exceeded', 'Increased', 'Reduced', 'Improved', 'Accelerated', 'Generated', 'Boosted', 'Cut'],
    'Building': ['Built', 'Designed', 'Developed', 'Engineered', 'Implemented', 'Architected', 'Automated', 'Deployed', 'Integrated', 'Migrated', 'Refactored', 'Optimized'],
    'Analysis': ['Analyzed', 'Evaluated', 'Researched', 'Identified', 'Measured', 'Forecasted', 'Assessed', 'Audited', 'Modeled', 'Diagnosed'],
    'Communication': ['Presented', 'Negotiated', 'Authored', 'Collaborated', 'Facilitated', 'Advised', 'Trained', 'Documented', 'Persuaded', 'Consulted'],
    'Initiative': ['Created', 'Launched', 'Initiated', 'Established', 'Founded', 'Pioneered', 'Introduced', 'Transformed', 'Streamlined', 'Standardized']
  };

  const ACTION_VERB_SET = new Set(Object.values(ACTION_VERBS).flat().map(v => v.toLowerCase()).concat([
    'accomplished', 'adapted', 'administered', 'allocated', 'applied', 'arranged', 'assembled', 'assisted', 'attained', 'balanced', 'budgeted',
    'calculated', 'captured', 'centralized', 'championed', 'clarified', 'coached', 'coded', 'compiled', 'completed', 'composed', 'conceived',
    'conducted', 'configured', 'consolidated', 'constructed', 'contributed', 'converted', 'crafted', 'cultivated', 'customized', 'debugged',
    'decreased', 'defined', 'demonstrated', 'derived', 'devised', 'digitized', 'discovered', 'distributed', 'doubled', 'drafted', 'drove',
    'earned', 'edited', 'eliminated', 'enabled', 'enforced', 'enhanced', 'ensured', 'executed', 'expanded', 'expedited', 'experimented',
    'formulated', 'fostered', 'grew', 'handled', 'headed', 'hired', 'hosted', 'influenced', 'informed', 'inspected', 'installed', 'instituted',
    'instructed', 'interviewed', 'invented', 'investigated', 'maintained', 'marketed', 'maximized', 'minimized', 'mobilized', 'moderated',
    'modernized', 'monitored', 'motivated', 'navigated', 'onboarded', 'operated', 'orchestrated', 'organized', 'originated', 'outperformed',
    'overhauled', 'owned', 'partnered', 'performed', 'planned', 'prioritized', 'produced', 'programmed', 'promoted', 'proposed', 'prototyped',
    'provided', 'published', 'quantified', 'raised', 'recruited', 'redesigned', 'reengineered', 'remodeled', 'reorganized', 'replaced',
    'resolved', 'restored', 'restructured', 'revamped', 'reviewed', 'revitalized', 'saved', 'scaled', 'scheduled', 'secured', 'selected',
    'served', 'shaped', 'shipped', 'simplified', 'solved', 'sourced', 'specified', 'steered', 'strengthened', 'structured', 'succeeded',
    'supported', 'surpassed', 'sustained', 'synthesized', 'targeted', 'tested', 'tracked', 'translated', 'tripled', 'troubleshot', 'unified',
    'upgraded', 'utilized', 'validated', 'verified', 'visualized', 'won', 'wrote'
  ]));

  function defaultSettings() {
    return {
      template: 'classic',
      font: 'Arial',
      fontSize: 10.5,
      lineHeight: 1.35,
      margin: 0.6,
      sectionGap: 1,
      accent: '#1f3a5f',
      paper: 'letter'
    };
  }

  function defaultState() {
    return {
      version: 1,
      settings: defaultSettings(),
      sectionOrder: DEFAULT_ORDER.slice(),
      hiddenSections: [],
      sectionTitles: Object.assign({}, SECTION_TITLES),
      personal: { fullName: '', title: '', email: '', phone: '', location: '', linkedin: '', website: '', github: '' },
      summary: '',
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      awards: [],
      languages: [],
      custom: []
    };
  }

  function newItem(type) {
    const id = uid();
    switch (type) {
      case 'experience': return { id, company: '', role: '', location: '', start: '', end: '', current: false, bullets: [] };
      case 'education': return { id, school: '', degree: '', field: '', location: '', start: '', end: '', gpa: '', details: '' };
      case 'skills': return { id, category: '', items: '' };
      case 'projects': return { id, name: '', link: '', tech: '', start: '', end: '', bullets: [] };
      case 'certifications': return { id, name: '', issuer: '', date: '', link: '' };
      case 'awards': return { id, title: '', issuer: '', date: '', description: '' };
      case 'languages': return { id, name: '', level: '' };
      case 'customItem': return { id, heading: '', subheading: '', date: '', location: '', bullets: [] };
      case 'customSection': return { id, title: 'Additional Section', items: [] };
      default: return { id };
    }
  }

  function sampleState() {
    const s = defaultState();
    s.personal = {
      fullName: 'Jordan Rivera',
      title: 'Senior Software Engineer',
      email: 'jordan.rivera@example.com',
      phone: '(415) 555-0142',
      location: 'San Francisco, CA',
      linkedin: 'linkedin.com/in/jordanrivera',
      website: 'jordanrivera.dev',
      github: 'github.com/jrivera'
    };
    s.summary = 'Senior software engineer with 8+ years building high-traffic web platforms and cloud infrastructure. Led a team of 6 engineers to re-architect a payments service that now processes $2.1B annually with 99.99% uptime. Skilled in TypeScript, Go, AWS, and Kubernetes, with a track record of cutting infrastructure costs and shipping reliable products on schedule.';
    s.experience = [
      { id: uid(), company: 'Northwind Technologies', role: 'Senior Software Engineer', location: 'San Francisco, CA', start: 'Mar 2021', end: '', current: true, bullets: [
        'Led re-architecture of the payments platform from a monolith to 12 Go microservices on Kubernetes, cutting p95 latency by 62% and reducing incidents by 40%',
        'Mentored 6 engineers through weekly design reviews and pair programming; 3 were promoted within 18 months',
        'Reduced AWS spend by $480K per year by right-sizing EKS clusters and introducing spot instances for batch workloads',
        'Designed an event-driven reconciliation system using Kafka that processes 30M transactions daily with zero data loss'
      ] },
      { id: uid(), company: 'Bluebird Labs', role: 'Software Engineer', location: 'Oakland, CA', start: 'Jun 2018', end: 'Feb 2021', current: false, bullets: [
        'Built a React and TypeScript customer dashboard used by 120K monthly active users, increasing self-service resolution by 35%',
        'Implemented CI/CD pipelines with GitHub Actions and Terraform, shortening release cycles from two weeks to daily deploys',
        'Improved PostgreSQL query performance by 8x for the reporting module by adding partial indexes and rewriting N+1 queries'
      ] },
      { id: uid(), company: 'Coastal Analytics', role: 'Junior Developer', location: 'San Diego, CA', start: 'Aug 2016', end: 'May 2018', current: false, bullets: [
        'Developed Python ETL jobs ingesting 2TB of daily sensor data into Redshift for a fleet-tracking product',
        'Automated regression testing with Selenium, reducing manual QA time by 15 hours per release'
      ] }
    ];
    s.education = [
      { id: uid(), school: 'University of California, San Diego', degree: 'Bachelor of Science', field: 'Computer Science', location: 'San Diego, CA', start: '2012', end: '2016', gpa: '3.8', details: 'Dean’s List (6 semesters); Teaching Assistant for Data Structures' }
    ];
    s.skills = [
      { id: uid(), category: 'Languages', items: 'TypeScript, JavaScript, Go, Python, SQL' },
      { id: uid(), category: 'Frameworks', items: 'React, Node.js, Next.js, Express, Django' },
      { id: uid(), category: 'Cloud & DevOps', items: 'AWS (EKS, Lambda, RDS), Kubernetes, Docker, Terraform, GitHub Actions' },
      { id: uid(), category: 'Data', items: 'PostgreSQL, Redis, Kafka, Elasticsearch, Redshift' }
    ];
    s.projects = [
      { id: uid(), name: 'OpenLedger', link: 'github.com/jrivera/openledger', tech: 'Go, gRPC, PostgreSQL', start: '2022', end: 'Present', bullets: [
        'Created an open-source double-entry ledger library with 1.2K GitHub stars and 40+ contributors',
        'Wrote comprehensive documentation and a benchmark suite that sustains 50K writes per second on commodity hardware'
      ] }
    ];
    s.certifications = [
      { id: uid(), name: 'AWS Certified Solutions Architect – Professional', issuer: 'Amazon Web Services', date: '2023', link: '' },
      { id: uid(), name: 'Certified Kubernetes Administrator (CKA)', issuer: 'Cloud Native Computing Foundation', date: '2022', link: '' }
    ];
    s.awards = [
      { id: uid(), title: 'Engineering Excellence Award', issuer: 'Northwind Technologies', date: '2023', description: 'Recognized for leading the payments platform migration with zero customer-facing downtime' }
    ];
    s.languages = [
      { id: uid(), name: 'English', level: 'Native' },
      { id: uid(), name: 'Spanish', level: 'Professional working proficiency' }
    ];
    return s;
  }

  /* Make any loaded / imported object safe to use. */
  function normalize(input) {
    const base = defaultState();
    if (!input || typeof input !== 'object') return base;
    const out = base;
    out.settings = Object.assign(defaultSettings(), isObj(input.settings) ? input.settings : {});
    if (!TEMPLATES.some(t => t.id === out.settings.template)) out.settings.template = 'classic';
    if (!SAFE_FONTS.includes(out.settings.font)) out.settings.font = 'Arial';
    out.settings.fontSize = clamp(num(out.settings.fontSize, 10.5), 9, 13);
    out.settings.lineHeight = clamp(num(out.settings.lineHeight, 1.35), 1.1, 1.7);
    out.settings.margin = clamp(num(out.settings.margin, 0.6), 0.4, 1.2);
    out.settings.sectionGap = clamp(num(out.settings.sectionGap, 1), 0.6, 1.6);
    if (!/^#[0-9a-f]{6}$/i.test(String(out.settings.accent))) out.settings.accent = '#1f3a5f';
    if (out.settings.paper !== 'a4') out.settings.paper = 'letter';

    out.personal = Object.assign(out.personal, pickStrings(input.personal, Object.keys(out.personal)));
    out.summary = str(input.summary);
    out.sectionTitles = Object.assign(out.sectionTitles, pickStrings(input.sectionTitles, Object.keys(SECTION_TITLES)));

    const listKeys = ['experience', 'education', 'skills', 'projects', 'certifications', 'awards', 'languages'];
    listKeys.forEach(k => {
      out[k] = (Array.isArray(input[k]) ? input[k] : []).filter(isObj).map(it => {
        const fresh = newItem(k);
        Object.keys(fresh).forEach(f => {
          if (f === 'id') { fresh.id = str(it.id) || uid(); }
          else if (Array.isArray(fresh[f])) { fresh[f] = toLines(it[f]); }
          else if (typeof fresh[f] === 'boolean') { fresh[f] = !!it[f]; }
          else { fresh[f] = str(it[f]); }
        });
        return fresh;
      });
    });

    out.custom = (Array.isArray(input.custom) ? input.custom : []).filter(isObj).map(sec => ({
      id: str(sec.id) || uid(),
      title: str(sec.title) || 'Additional Section',
      items: (Array.isArray(sec.items) ? sec.items : []).filter(isObj).map(it => ({
        id: str(it.id) || uid(),
        heading: str(it.heading), subheading: str(it.subheading), date: str(it.date), location: str(it.location),
        bullets: toLines(it.bullets)
      }))
    }));

    // Section order: keep valid entries from input, then append anything missing.
    const validKeys = new Set(DEFAULT_ORDER.concat(out.custom.map(c => 'custom:' + c.id)));
    const order = (Array.isArray(input.sectionOrder) ? input.sectionOrder : []).filter(k => validKeys.has(k));
    validKeys.forEach(k => { if (!order.includes(k)) order.push(k); });
    out.sectionOrder = Array.from(new Set(order));
    out.hiddenSections = (Array.isArray(input.hiddenSections) ? input.hiddenSections : []).filter(k => validKeys.has(k));
    return out;
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return v == null ? '' : String(v); }
  function num(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function pickStrings(src, keys) { const o = {}; if (isObj(src)) keys.forEach(k => { if (src[k] != null) o[k] = str(src[k]); }); return o; }
  function toLines(v) {
    if (Array.isArray(v)) return v.map(str);
    if (typeof v === 'string') return v.split('\n');
    return [];
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { console.warn('Could not load saved resume', e); }
    return defaultState();
  }
  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { console.warn('Could not save resume', e); return false; }
  }
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

  function isEmpty(state) {
    const p = state.personal;
    return !Object.values(p).some(Boolean) && !state.summary &&
      ['experience', 'education', 'skills', 'projects', 'certifications', 'awards', 'languages', 'custom'].every(k => !state[k].length);
  }

  /* Path helpers used by the editor: "experience.2.bullets" */
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }

  window.RB = {
    STORAGE_KEY, uid, SECTION_TITLES, SECTION_ICONS, DEFAULT_ORDER, SAFE_FONTS, FONT_STACKS, TEMPLATES, ACCENT_PRESETS,
    ACTION_VERBS, ACTION_VERB_SET, defaultState, newItem, sampleState, normalize, load, save, loadPrefs, savePrefs,
    isEmpty, getPath, setPath
  };
})();
