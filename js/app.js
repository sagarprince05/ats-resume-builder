/* =====================================================================
   Application wiring: state, persistence, undo/redo, preview layout,
   menus, live ATS score, resume upload, job-description optimisation,
   modals, toasts, shortcuts, welcome screen, desktop/PWA hooks.
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
  const IS_DESKTOP = /[?&]desktop=1/.test(location.search);

  let state = RB.load();
  let prefs = Object.assign({ theme: 'light', zoom: 'fit', hidePdfTips: false, jd: '', welcomeDismissed: false, mode: 'simple', submitted: false, lastRunJd: '' }, RB.loadPrefs());
  const TAILOR_BASE_KEY = 'atsResumeBuilder.tailorBase';

  const els = {
    editor: $('editor'), rail: $('rail'), page: $('page'), pageWrap: $('pageWrap'), previewScroll: $('previewScroll'), pageInfo: $('pageInfo'),
    zoomLabel: $('zoomLabel'), saveStatus: $('saveStatus'), drawer: $('atsDrawer'), backdrop: $('backdrop'),
    scoreRing: $('scoreRing'), scoreValue: $('scoreValue'), scoreGrade: $('scoreGrade'), scoreHint: $('scoreHint'),
    checkResults: $('checkResults'), modalRoot: $('modalRoot'), toastRoot: $('toastRoot'), importFile: $('importFile'),
    workspace: document.querySelector('.workspace'), welcome: $('welcome'), atsChip: $('atsChip'), atsChipVal: $('atsChipVal'),
    flow: $('flow')
  };

  /* ---------------- simple flow vs full editor ---------------- */
  function setMode(m) {
    els.workspace.dataset.mode = m;
    prefs.mode = m; savePrefs();
    if (m === 'simple') window.Flow.refreshAll(); else window.Editor.renderRail();
    renderPreview();   // the simple view gates the preview until Optimise is clicked
  }
  function isSimple() { return els.workspace.dataset.mode === 'simple'; }

  /* ---------------- undo / redo ---------------- */
  const history = [], future = [];
  let committed = JSON.stringify(state);
  let lastChangeAt = 0;
  function recordChange(kind) {
    const json = JSON.stringify(state);
    if (json === committed) return;
    const now = Date.now();
    if (kind === 'structural' || now - lastChangeAt > 900) {
      history.push(committed);
      if (history.length > 100) history.shift();
      future.length = 0;
    }
    committed = json;
    lastChangeAt = now;
    updateUndoButtons();
  }
  function undo() {
    if (!history.length) return;
    future.push(JSON.stringify(state));
    state = RB.normalize(JSON.parse(history.pop()));
    committed = JSON.stringify(state);
    afterRestore('Undone');
  }
  function redo() {
    if (!future.length) return;
    history.push(JSON.stringify(state));
    state = RB.normalize(JSON.parse(future.pop()));
    committed = JSON.stringify(state);
    afterRestore('Redone');
  }
  function afterRestore(msg) {
    window.Editor.setState(state);
    window.Flow.refreshAll();
    renderPreview(); scheduleSave(); scheduleChip();
    if (drawerOpen()) scheduleAts();
    updateUndoButtons();
    toast(msg);
  }
  function updateUndoButtons() { $('btnUndo').disabled = !history.length; $('btnRedo').disabled = !future.length; }

  /* ---------------- persistence ---------------- */
  let saveTimer = null;
  function scheduleSave() {
    els.saveStatus.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const ok = RB.save(state);
      const t = new Date();
      els.saveStatus.textContent = ok ? `Saved ${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · on this device` : 'Could not save (storage full or blocked)';
    }, 400);
  }
  function savePrefs() { RB.savePrefs(prefs); }

  /* ---------------- preview ---------------- */
  let previewTimer = null;
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
  function pageSizePx() {
    return state.settings.paper === 'a4' ? { w: 210 / 25.4 * 96, h: 297 / 25.4 * 96 } : { w: 8.5 * 96, h: 11 * 96 };
  }
  function renderPreview() {
    const s = state.settings;
    const page = els.page;
    page.dataset.paper = s.paper;
    page.style.setProperty('--r-font', RB.FONT_STACKS[s.font] || s.font);
    page.style.setProperty('--r-fs', s.fontSize + 'pt');
    page.style.setProperty('--r-lh', s.lineHeight);
    page.style.setProperty('--r-gap', s.sectionGap);
    page.style.setProperty('--r-accent', s.accent);
    page.style.setProperty('--r-margin', s.margin + 'in');
    const empty = RB.isEmpty(state);
    // In the simple flow the result is shown only after Optimise is clicked.
    const gated = isSimple() && !prefs.submitted;
    if (empty) page.innerHTML = '<div class="empty-page"><div>Your resume appears here.</div></div>';
    else if (gated) page.innerHTML = '<div class="empty-page"><div>Your CV is loaded.<br>Click <b>Submit</b> and the optimised resume appears here.</div></div>';
    else page.innerHTML = window.Preview.render(state);
    els.welcome.hidden = !(empty && !prefs.welcomeDismissed);
    const bar = $('previewActions'); if (bar) bar.hidden = empty || gated;
    window.Exporter.ensurePrintStyle(state);
    layoutPage();
  }
  function currentScale() {
    const { w } = pageSizePx();
    if (prefs.zoom === 'fit') {
      const avail = els.previewScroll.clientWidth - 56;
      return Math.max(0.2, Math.min(1.25, avail / w));
    }
    return prefs.zoom;
  }
  function pageCount() { const { h } = pageSizePx(); return Math.max(1, Math.ceil((els.page.offsetHeight - 2) / h)); }
  function layoutPage() {
    const { w, h } = pageSizePx();
    const scale = currentScale();
    const page = els.page;
    page.style.transform = `scale(${scale})`;
    page.querySelectorAll('.page-break-guide').forEach(g => g.remove());
    const pages = pageCount();
    for (let p = 1; p < pages; p++) {
      const g = document.createElement('div');
      g.className = 'page-break-guide'; g.style.top = (p * h) + 'px'; g.dataset.page = p + 1;
      page.appendChild(g);
    }
    els.pageWrap.style.width = (w * scale) + 'px';
    els.pageWrap.style.height = (page.offsetHeight * scale) + 'px';
    els.zoomLabel.textContent = Math.round(scale * 100) + '%';
    els.pageInfo.textContent = pages + (pages === 1 ? ' page' : ' pages');
    els.pageInfo.classList.toggle('over', pages > 2);
    els.pageInfo.title = pages > 2 ? 'Most recruiters expect one or two pages.' : 'Estimated page count when printed.';
  }
  function setZoom(z) { prefs.zoom = z; savePrefs(); layoutPage(); }

  /* ---------------- live ATS chip ---------------- */
  let chipTimer = null;
  function scheduleChip() { clearTimeout(chipTimer); chipTimer = setTimeout(updateChip, 600); }
  function updateChip() {
    if (RB.isEmpty(state)) { els.atsChipVal.textContent = '–'; els.atsChip.className = 'ats-chip'; return; }
    const res = window.ATS.analyze(state, prefs.jd || '', { pages: pageCount() });
    els.atsChipVal.textContent = res.score;
    els.atsChip.className = 'ats-chip ' + (res.score >= 80 ? 'good' : res.score >= 55 ? 'ok' : 'bad');
  }

  /* ---------------- AI settings ---------------- */
  function aiCardHtml() {
    if (window.AI.isBuiltIn()) return '';   // key is baked in; nothing to configure
    const a = window.AI.active();
    if (a.key) {
      return `<div class="ai-card on"><div class="ai-icon">${icon('sparkles')}</div><div class="ai-text"><b>AI rewriting is on · ${esc(a.spec.name)} ${esc(a.model)}</b><small>Uploaded resumes are read by AI and the resume is rewritten for each job description. Nothing is invented; every change is listed.</small></div><button type="button" class="btn btn-sm" data-action="ai-settings">Change</button></div>`;
    }
    return `<div class="ai-card"><div class="ai-icon">${icon('sparkles')}</div><div class="ai-text"><b>Turn on AI rewriting</b><small>Add a free Groq API key and the resume will be properly rewritten for each job description, not just reordered.</small></div><button type="button" class="btn btn-primary btn-sm" data-action="ai-settings">Set up</button></div>`;
  }
  function refreshAiUi() {
    const a = window.AI.active();
    // Built-in key or server relay: hide the whole AI settings entry.
    $('btnAi').hidden = window.AI.isBuiltIn();
    if (!window.AI.isBuiltIn()) $('aiMenuNote').textContent = a.key ? `On · ${a.model}` : 'Add your free Groq API key';
    window.Editor.refreshAiCards();
    window.Flow.refreshAll();
  }
  // A hosted copy whose relay is missing falls back to per-user keys.
  window.addEventListener('ai-config-changed', refreshAiUi);
  function openAiSettings() {
    closeMenus();
    if (window.AI.isBuiltIn()) return;      // no key settings when one is built in
    const cfg = window.AI.load();
    const draft = JSON.parse(JSON.stringify(cfg));
    const liveModels = {};   // provider -> [{id,name,note}]

    const modelOptions = p => {
      const spec = window.AI.PROVIDERS[p];
      const list = liveModels[p] || spec.models;
      const cur = draft[p].model;
      const opts = list.map(m => `<option value="${esc(m.id)}"${cur === m.id ? ' selected' : ''}>${esc(m.name)}${m.note ? ' — ' + esc(m.note) : ''}</option>`);
      if (!list.some(m => m.id === cur)) opts.unshift(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
      return opts.join('');
    };
    const loading = {};      // provider -> true while the live list is being fetched
    const fields = () => {
      const p = draft.provider, spec = window.AI.PROVIDERS[p];
      const tag = loading[p] ? 'checking your account…' : (liveModels[p] ? 'from your account' : '');
      return `<div class="hint" style="margin:10px 0">${esc(spec.note)} Get a key at <b>${esc(spec.keyUrl)}</b>.</div>
        <label class="fld"><span>${esc(spec.name)} API key</span><input type="password" id="aiKey" value="${esc(draft[p].key)}" placeholder="${esc(spec.keyHint)}" autocomplete="off" spellcheck="false"></label>
        <label class="fld"><span>Model ${tag ? `<em style="font-style:normal;color:var(--muted)">(${esc(tag)})</em>` : ''}</span><select id="aiModel">${modelOptions(p)}</select></label>`;
    };

    /* Ask the provider which models this key can actually use, so a
       hardcoded ID can never leave the app stuck on a retired model. */
    async function loadModels(p, key, opts) {
      if (!key || loading[p]) return;
      loading[p] = true;
      if (draft.provider === p) redraw();
      try {
        const list = await window.AI.listModels(p, key);
        if (list && list.length) {
          liveModels[p] = list;
          if (!list.some(m => m.id === draft[p].model)) {
            const best = window.AI.pickBest(p, list);
            const was = draft[p].model;
            draft[p].model = best;
            if (draft.provider === p && opts && opts.announce) {
              const s = $$('aiStatus');
              if (s) { s.className = 'status-line ok'; s.textContent = `"${was}" is not available on your key. Switched to ${best}.`; }
            }
          }
        }
      } catch (e) {
        if (draft.provider === p && opts && opts.announce) {
          const s = $$('aiStatus');
          if (s) { s.className = 'status-line err'; s.textContent = e.message; }
        }
      } finally {
        loading[p] = false;
        if (draft.provider === p) redraw();
      }
    }

    modal({
      title: 'AI settings',
      confirmText: 'Save', cancelText: 'Cancel',
      body: `<p>The AI layer calls <b>Groq</b> with <b>your own API key</b>. The key is stored only on this device and sent only to Groq. Usage counts against your Groq account.</p>
        <div id="aiFields" style="margin-top:12px">${fields()}</div>
        <label class="check"><input type="checkbox" id="aiParse"${draft.useForParse ? ' checked' : ''}> Also use AI to read uploaded resumes (much more accurate than pattern matching)</label>
        <div class="hint">To turn AI off, clear the key and save.</div>
        <div class="status-line" id="aiStatus"></div>`,
      extraHtml: '<button type="button" class="btn" id="aiTest">Test connection</button>',
      onConfirm: () => {
        stash();
        window.AI.save(draft);
        refreshAiUi();
        const a = window.AI.active();
        toast(a.key ? `AI rewriting is on (${a.spec.name}).` : 'AI rewriting is off.');
        if (a.key && hasJd() && !RB.isEmpty(state)) scheduleAiTailor(300);
      }
    });

    // Hold the dialog element itself: modal() detaches it before running
    // onConfirm, so document.getElementById would return null by then.
    const box = els.modalRoot.querySelector('.modal');
    const $$ = id => box.querySelector('#' + id);
    // Remember what is typed before the panel is re-rendered.
    function stash() {
      const k = $$('aiKey'), m = $$('aiModel'), p = $$('aiParse');
      if (k) draft[draft.provider].key = k.value.trim();
      if (m) draft[draft.provider].model = m.value;
      if (p) draft.useForParse = p.checked;
    }
    function redraw() { $$('aiFields').innerHTML = fields(); }

    // Refresh the list whenever a key is pasted in.
    $$('aiFields').addEventListener('change', e => {
      if (e.target.id !== 'aiKey') return;
      const p = draft.provider, key = e.target.value.trim();
      if (key && key !== draft[p].key) { draft[p].key = key; liveModels[p] = null; loadModels(p, key); }
    });

    const testBtn = $$('aiTest');
    testBtn.addEventListener('click', async () => {
      stash();
      const status = $$('aiStatus');
      const p = draft.provider, key = draft[p].key, model = draft[p].model;
      if (!key) { status.className = 'status-line err'; status.textContent = 'Enter an API key first.'; return; }
      status.className = 'status-line'; status.textContent = 'Testing…'; testBtn.disabled = true;
      try {
        // Refresh the model list first, so a retired saved ID does not fail the test.
        liveModels[p] = null;
        await loadModels(p, key, { announce: false });
        const chosen = draft[p].model;
        await window.AI.test(p, key, chosen);
        status.className = 'status-line ok';
        status.textContent = `Connected. ${window.AI.PROVIDERS[p].name} works with ${chosen}.`;
      } catch (e) {
        status.className = 'status-line err'; status.textContent = e.message;
      } finally {
        window.AI.save(cfg);   // don't let the test change saved settings until Save is pressed
        testBtn.disabled = false;
      }
    });

    // On open, read the real model list for whichever provider already has a key.
    if (draft[draft.provider].key) loadModels(draft.provider, draft[draft.provider].key, { announce: true });
  }

  /* ---------------- job description & optimisation ---------------- */
  let jdTimer = null;
  let lastTailor = null;      // { changes, count, at, ai, usage }
  let jdWorking = false;
  let jdError = '';
  let aiRun = 0;              // request counter so stale AI replies are ignored
  let aiAbort = null;
  function hasJd() { return (prefs.jd || '').trim().length >= 20; }
  function tailorBase() { try { return JSON.parse(localStorage.getItem(TAILOR_BASE_KEY) || 'null'); } catch (e) { return null; } }
  /* The baseline belongs to one specific resume. Whenever the resume is
     replaced wholesale (upload, import, sample, clear) the old baseline
     must go, or the next rewrite would re-tailor the previous resume and
     throw the new one away. */
  function resetTailorBase() { localStorage.removeItem(TAILOR_BASE_KEY); lastTailor = null; jdError = ''; }

  /* Automatic optimisation. Runs once both the CV and the job description
     are in place, but only when the user has finished with the text (clicked
     away, or stopped typing for a few seconds) and only if that exact text
     has not been optimised already. Keeps free-tier quota from being spent
     on every pause while typing. Submit remains for deliberate re-runs. */
  let lastRunJd = prefs.lastRunJd || '';
  let autoTimer = null;
  function autoRunIfReady() {
    clearTimeout(autoTimer);
    if (!isSimple() || jdWorking) return;
    const jdNow = (prefs.jd || '').trim();
    if (jdNow.length < 20 || RB.isEmpty(state)) return;
    if (jdNow === lastRunJd) return;      // already optimised for this text
    onSubmit();
  }
  function scheduleAutoRun(delay) { clearTimeout(autoTimer); autoTimer = setTimeout(autoRunIfReady, delay); }

  function onJdInput(text) {
    prefs.jd = text; savePrefs();
    if (isSimple()) { scheduleAutoRun(3000); return; }
    if (!isSimple()) {
      // The full editor keeps its live behaviour.
      jdWorking = true; jdError = '';
      renderJdResults();
      clearTimeout(jdTimer);
      jdTimer = setTimeout(() => {
        if (!hasJd()) { jdWorking = false; lastTailor = null; renderJdResults(); scheduleChip(); return; }
        if (window.AI.isConfigured()) aiTailor(); else { jdWorking = false; applyTailoring(); scheduleChip(); }
      }, window.AI.isConfigured() ? 1500 : 900);
    }
  }

  /* The Optimise button. */
  function onSubmit() {
    if (!hasJd() || RB.isEmpty(state)) return;
    clearTimeout(autoTimer);
    lastRunJd = (prefs.jd || '').trim();
    prefs.submitted = true; prefs.lastRunJd = lastRunJd; savePrefs();
    closeMenus();
    if (window.AI.isConfigured()) scheduleAiTailor(0);
    else { jdWorking = false; applyTailoring(); renderPreview(); scheduleChip(); }
    window.Flow.refreshAll();
    setTimeout(() => { const s3 = document.getElementById('step3'); if (s3) s3.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 150);
  }

  /* Start over with a fresh CV. Design settings are kept. */
  function tryAnother() {
    const next = RB.defaultState(); next.settings = Object.assign({}, state.settings);
    prefs.jd = ''; prefs.upload = null; prefs.submitted = false; prefs.welcomeDismissed = false; prefs.lastRunJd = ''; savePrefs();
    lastRunJd = '';
    cancelAiRun();
    resetTailorBase();
    window.Editor.setUploadStatus('');
    window.Flow.setUpload(null);
    replaceState(next, 'Ready for the next resume.');
    setMode('simple');
    els.flow.scrollTop = 0;
    renderJdResults();
  }
  function scheduleAiTailor(delay) { clearTimeout(jdTimer); jdWorking = true; renderJdResults(); jdTimer = setTimeout(aiTailor, delay || 0); }
  /* Drop any optimisation that is still running or queued. Used when the
     resume is replaced wholesale: a reply for the previous resume must not
     land on top of the new one. */
  function cancelAiRun() {
    clearTimeout(jdTimer); clearTimeout(autoTimer);
    aiRun++;                                   // any reply still in flight is now stale
    if (aiAbort) { try { aiAbort.abort(); } catch (e) { /* ignore */ } }
    aiAbort = null;
    jdWorking = false;
  }
  async function aiTailor() {
    if (!hasJd() || RB.isEmpty(state)) { jdWorking = false; renderJdResults(); return; }
    const run = ++aiRun;
    if (aiAbort) { try { aiAbort.abort(); } catch (e) { /* ignore */ } }
    aiAbort = new AbortController();
    jdWorking = true; jdError = ''; renderJdResults();
    if (!tailorBase()) { try { localStorage.setItem(TAILOR_BASE_KEY, JSON.stringify({ at: Date.now(), state })); } catch (e) { /* ignore */ } }
    // Always rewrite from the pre-optimisation version so successive postings do not compound edits.
    const base = tailorBase();
    const source = base ? RB.normalize(base.state) : state;
    try {
      const res = await window.AI.tailorResume(source, prefs.jd, { signal: aiAbort.signal });
      if (run !== aiRun) return; // a newer request superseded this one
      const changes = res.changes.slice();
      const title = (res.headlineSuggestion || '').trim();
      if (title && title.toLowerCase() !== res.state.personal.title.trim().toLowerCase()) changes.push({ text: `The posting's title is "${title}". Your headline was kept as "${res.state.personal.title}".`, action: { type: 'use-title', title } });
      const pname = res.providerName || window.AI.providerName();
      lastTailor = { changes, count: res.changes.length, at: Date.now(), ai: true, usage: res.usage, model: res.model, providerName: pname, fellBackFrom: res.fellBackFrom, coaching: res.coaching || [] };
      if (res.fellBackFrom) changes.unshift({ text: `The ${res.fellBackFrom} model was busy, so ${res.model} was used instead.` });
      // Keep the user's place if they are still typing in the job description box.
      const jdBox = document.getElementById('jdInput');
      const wasFocused = jdBox && document.activeElement === jdBox;
      const caret = wasFocused ? jdBox.selectionStart : 0;
      replaceState(res.state, `Resume rewritten for this posting by ${pname}: ${res.changes.length} change${res.changes.length === 1 ? '' : 's'}.`);
      if (wasFocused) { const nb = document.getElementById('jdInput'); if (nb) { nb.focus(); try { nb.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } } }
    } catch (e) {
      if (e.name === 'AbortError' || run !== aiRun) return;
      console.error(e);
      jdError = e.message || 'AI request failed';
      // Fall back to the rule-based reorder so the resume is still targeted.
      applyTailoring();
      lastTailor = lastTailor || { changes: [], count: 0, at: Date.now() };
      lastTailor.fallback = true;
    } finally {
      if (run === aiRun) { jdWorking = false; renderPreview(); renderJdResults(); scheduleChip(); }
    }
  }
  function applyTailoring() {
    if (!hasJd() || RB.isEmpty(state)) { renderJdResults(); return; }
    if (!tailorBase()) { try { localStorage.setItem(TAILOR_BASE_KEY, JSON.stringify({ at: Date.now(), state })); } catch (e) { /* ignore */ } }
    const before = JSON.stringify(state);
    const res = window.Tailor.apply(state, prefs.jd);
    const changed = JSON.stringify(state) !== before;
    if (changed || !lastTailor || !lastTailor.count) lastTailor = { changes: res.changes, count: res.count, at: Date.now() };
    if (changed) {
      recordChange('structural');
      window.Editor.setState(state);
      renderPreview(); scheduleSave();
      toast(`Resume optimised for this posting: ${res.count} change${res.count === 1 ? '' : 's'}.`);
    }
    scheduleChip();
    if (drawerOpen()) scheduleAts();
    renderJdResults();
  }
  /* What the simple flow needs to draw step 3. */
  function flowResult() {
    if (jdWorking) return { busy: true, busyText: window.AI.isConfigured() ? `Rewriting your resume with ${window.AI.providerName()}… this usually takes 20–60 seconds.` : 'Optimising…' };
    if (jdError) return { error: `AI rewrite failed: ${jdError} Applied the basic reorder instead.` };
    if (!lastTailor) return { count: null, changes: [], canRevert: !!tailorBase() };
    return { count: lastTailor.count, changes: lastTailor.changes, ai: !!lastTailor.ai, providerName: lastTailor.providerName || 'AI', canRevert: !!tailorBase() };
  }

  function renderJdResults() {
    window.Flow.refreshResult();
    let html = '';
    if (!hasJd()) {
      html = `<div class="jd-status idle"><span class="pulse"></span><span>Waiting for a job description</span></div>`;
    } else if (jdWorking) {
      html = `<div class="jd-status working"><span class="pulse"></span><span>${window.AI.isConfigured() ? `Rewriting your resume with ${esc(window.AI.providerName())}… this usually takes 20–60 seconds.` : 'Optimising your resume…'}</span></div>`;
    } else {
      const res = window.ATS.analyze(state, prefs.jd, { pages: pageCount() });
      const k = res.keywords;
      const count = lastTailor ? lastTailor.count : 0;
      const ai = lastTailor && lastTailor.ai;
      if (jdError) {
        html = `<div class="jd-status error"><span class="pulse"></span><span>AI rewrite failed: ${esc(jdError)} Applied the basic reorder instead.</span><button type="button" class="btn btn-sm" data-action="retry-ai">Retry</button></div>`;
      } else {
        html = `<div class="jd-status"><span class="pulse"></span><span>${ai ? 'Rewritten for this posting by ' + esc(lastTailor.providerName || 'AI') : 'Optimised for this posting'}${RB.isEmpty(state) ? ' (add or upload a resume first)' : ` · ${count} change${count === 1 ? '' : 's'}`}</span>
          ${tailorBase() ? `<button type="button" class="btn btn-sm btn-ghost" data-action="revert-tailor" title="Restore the resume to how it was before any optimisation">Revert</button>` : ''}</div>`;
      }
      if (ai && lastTailor.usage && lastTailor.usage.input) html += `<div class="ai-usage">${esc(lastTailor.model || '')} · ${lastTailor.usage.input.toLocaleString()} input / ${(lastTailor.usage.output || 0).toLocaleString()} output tokens</div>`;
      if (lastTailor && lastTailor.changes.length) {
        html += `<div class="tailor-changes" style="margin-top:10px">` + lastTailor.changes.map(c =>
          `<div class="tc${c.action ? ' suggest' : ''}"><span>${esc(c.text)}</span>${c.action && c.action.type === 'use-title' ? `<button type="button" class="btn btn-sm" data-action="use-title" data-title="${esc(c.action.title)}">Use it</button>` : ''}</div>`).join('') + `</div>`;
      }
      if (k && k.all.length) {
        html += `<div class="kw-group" style="margin-top:14px"><h4 style="font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:5px;font-weight:600">Keyword match: ${k.matched.length} of ${k.all.length} (${k.pct}%)</h4>
          ${k.missing.length ? `<div class="hint" style="margin-bottom:6px">Missing from your resume. Click one to add it to Skills, but only if it is genuinely true for you.</div><div class="chips">${k.missing.map(x => `<button type="button" class="chip missing" data-action="add-keyword" data-kw="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : '<div class="hint">Every extracted keyword already appears in your resume.</div>'}
          ${k.matched.length ? `<div class="chips" style="margin-top:8px">${k.matched.map(x => `<span class="chip matched">✓ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`;
      }
    }
    window.Editor.setJdResults(html);
  }
  function revertTailoring() {
    const base = tailorBase();
    if (!base) return;
    modal({
      title: 'Revert optimisation?',
      body: `<p>This restores the resume to how it was before the job description was first applied${base.at ? ' (' + new Date(base.at).toLocaleString() + ')' : ''}. Edits made since then will be lost. For step-by-step control use Undo instead.</p>`,
      confirmText: 'Revert', danger: true,
      onConfirm: () => {
        const restored = RB.normalize(base.state);
        cancelAiRun();
        resetTailorBase();
        replaceState(restored, 'Optimisation reverted');
        renderJdResults();
      }
    });
  }
  function useTitle(title) {
    state.personal.title = title;
    recordChange('structural'); window.Editor.setState(state); renderPreview(); scheduleSave();
    if (lastTailor) { lastTailor.changes = lastTailor.changes.map(c => c.action && c.action.type === 'use-title' ? { text: `Set your headline to "${title}".` } : c); lastTailor.count += 1; }
    renderJdResults(); scheduleChip();
    toast('Headline updated');
  }
  function addKeywordToSkills(kw) {
    const label = kw.split(' ').map(w => /^[a-z]/.test(w) && w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
    let row = state.skills.find(s => /^(additional|other|relevant) skills$/i.test(s.category.trim()));
    if (!row) { row = RB.newItem('skills'); row.category = 'Additional Skills'; state.skills.push(row); }
    const items = row.items.split(',').map(s => s.trim()).filter(Boolean);
    if (!items.some(i => i.toLowerCase() === label.toLowerCase())) items.push(label);
    row.items = items.join(', ');
    state.hiddenSections = state.hiddenSections.filter(k => k !== 'skills');
    recordChange('structural');
    window.Editor.setState(state);
    renderPreview(); scheduleSave(); renderJdResults(); scheduleChip();
    toast(`Added "${label}" to Skills. Make sure it is true for you.`);
  }

  /* ---------------- resume upload ---------------- */
  let uploading = false;
  async function handleUpload(file) {
    if (!file || uploading) return;
    uploading = true;
    const dz = document.getElementById('dropzone'); if (dz) dz.classList.add('busy');
    const setStatus = msg => {
      window.Editor.setUploadStatus(`<div class="card" style="margin-top:12px"><div class="jd-status working"><span class="pulse"></span><span>${esc(msg)}</span></div></div>`);
      window.Flow.setUploadBusy(msg);
    };
    setStatus(`Reading ${file.name}…`);
    try {
      const res = await window.ResumeParser.parseFile(file);
      let aiNote = '';
      const aiCfg = window.AI.load();
      const aiActive = window.AI.active();
      if (res.source === 'text' && res.text && aiActive.key && aiCfg.useForParse) {
        setStatus(`Reading ${file.name} with ${aiActive.spec.name}… this usually takes 20–40 seconds.`);
        try {
          const ai = await window.AI.parseResume(res.text, { fileName: file.name });
          res.state = ai.state;
          res.found = describeState(ai.state);
          aiNote = `Read by ${ai.providerName || aiActive.spec.name}. `;
        } catch (e) {
          console.error(e);
          toast('AI reading failed (' + (e.message || 'error') + '). Used the basic reader instead.', true);
          aiNote = `AI reading failed (${e.message || 'error'}), so the basic reader was used. Press Replace to try again. `;
        }
      }
      const apply = () => {
        dismissWelcome();
        cancelAiRun();             // a rewrite of the previous CV must not overwrite this one
        resetTailorBase();
        prefs.submitted = false;   // a new CV means a fresh run
        lastRunJd = ''; prefs.lastRunJd = '';   // the posting has not been run against this CV yet
        prefs.upload = { name: file.name, note: aiNote }; savePrefs();
        replaceState(res.state, hasJd() ? 'CV read. Click Submit when you are ready.' : 'CV read. Now paste the job description.');
        window.Editor.setUploadStatus(foundHtml(file.name, res.found, aiNote));
        window.Flow.setUpload({ name: file.name, found: res.found, note: aiNote });
        if (!isSimple()) {
          window.Editor.go('upload');
          if (hasJd()) { if (window.AI.isConfigured()) scheduleAiTailor(300); else setTimeout(applyTailoring, 300); }
        } else if (hasJd()) {
          scheduleAutoRun(600);   // CV arrived after the posting: optimise straight away
        } else {
          setTimeout(() => window.Flow.focusJd(), 250);
        }
      };
      window.Flow.setUploadBusy('');
      // A new file always replaces the current resume straight away; Undo
      // (Ctrl+Z / the toolbar arrow) brings the previous one back.
      apply();
    } catch (e) {
      console.error(e);
      window.Editor.setUploadStatus(`<div class="card" style="margin-top:12px;border-color:var(--danger)"><b style="color:var(--danger)">Could not read ${esc(file.name)}</b><div class="hint" style="margin-top:4px">${esc(e.message || 'Unknown error')}</div></div>`);
      window.Flow.setUploadError(`Could not read ${file.name}. ${e.message || ''}`);
      toast(e.message || 'Could not read the file', true);
    } finally {
      uploading = false;
      const dz2 = document.getElementById('dropzone'); if (dz2) dz2.classList.remove('busy');
    }
  }
  function describeState(s) {
    return {
      name: s.personal.fullName, email: s.personal.email, phone: s.personal.phone, title: s.personal.title, location: s.personal.location,
      summary: !!s.summary.trim(), experience: s.experience.length, bullets: s.experience.reduce((n, e) => n + (e.bullets || []).filter(x => x.trim()).length, 0),
      education: s.education.length, skills: s.skills.reduce((n, g) => n + g.items.split(',').filter(x => x.trim()).length, 0), projects: s.projects.length,
      certifications: s.certifications.length, awards: s.awards.length, languages: s.languages.length, custom: s.custom.map(c => c.title)
    };
  }
  function foundHtml(name, f, note) {
    const yes = v => v ? `<b>${esc(v === true ? 'Yes' : v)}</b>` : '<b class="no">Not found</b>';
    const n = v => v ? `<b>${v}</b>` : '<b class="no">0</b>';
    return `<div class="card" style="margin-top:12px">
      <div class="card-title">${icon('check')} Extracted from ${esc(name)}</div>
      <div class="found-grid">
        <div><span>Name</span>${yes(f.name)}</div><div><span>Title</span>${yes(f.title)}</div>
        <div><span>Email</span>${yes(f.email)}</div><div><span>Phone</span>${yes(f.phone)}</div>
        <div><span>Location</span>${yes(f.location)}</div><div><span>Summary</span>${yes(f.summary)}</div>
        <div><span>Positions</span>${n(f.experience)} <small style="color:var(--muted)">(${f.bullets} bullets)</small></div><div><span>Education</span>${n(f.education)}</div>
        <div><span>Skills</span>${n(f.skills)}</div><div><span>Projects</span>${n(f.projects)}</div>
        <div><span>Certifications</span>${n(f.certifications)}</div><div><span>Languages</span>${n(f.languages)}</div>
        ${f.custom && f.custom.length ? `<div style="grid-column:1/-1"><span>Other sections</span><b>${esc(f.custom.join(', '))}</b></div>` : ''}
      </div>
      <div class="hint" style="margin-top:10px">${esc(note || '')}Step through the sections on the left to check names, dates and bullets, then paste the job description.</div>
    </div>`;
  }

  /* ---------------- editor / flow callback ---------------- */
  function onEditorChange(kind, detail) {
    switch (kind) {
      case 'finish': openMenu('downloadMenu'); return;
      case 'jd': onJdInput(detail.text); return;
      case 'upload': handleUpload(detail.file); return;
      case 'pick-file': els.importFile.click(); return;
      case 'load-sample': loadSample(); return;
      case 'revert-tailor': revertTailoring(); return;
      case 'ai-settings': openAiSettings(); return;
      case 'retry-ai': scheduleAiTailor(0); return;
      case 'use-title': useTitle(detail.title); return;
      case 'add-keyword': addKeywordToSkills(detail.kw); return;
      case 'edit-details': setMode('edit'); window.Editor.go('personal'); return;
      case 'back-simple': setMode('simple'); return;
      case 'submit': onSubmit(); return;
      case 'jd-done': autoRunIfReady(); return;
      case 'try-another': tryAnother(); return;
      case 'dl-pdf': pdfFlow(); return;
      case 'dl-docx': downloadDocx(); return;
      case 'dl-txt': downloadTxt(); return;
    }
    recordChange(kind);
    scheduleSave();
    if (kind === 'structural') renderPreview(); else schedulePreview();
    scheduleChip();
    if (drawerOpen()) scheduleAts();
    if (detail && detail.removed) toast('Removed. Press Ctrl+Z to undo.');
  }

  /* ---------------- modals & toasts ---------------- */
  function modal({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false, onConfirm, extraHtml = '', hideCancel = false }) {
    els.modalRoot.innerHTML = `<div class="modal-back" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal"><h3 id="modalTitle">${esc(title)}</h3><div>${body}</div>
      <div class="actions">${extraHtml}${hideCancel ? '' : `<button class="btn" data-m="cancel">${esc(cancelText)}</button>`}<button class="btn btn-primary" data-m="ok"${danger ? ' style="background:var(--danger);border-color:var(--danger);box-shadow:none"' : ''}>${esc(confirmText)}</button></div></div></div>`;
    const back = els.modalRoot.firstElementChild;
    const close = () => { els.modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', e => {
      if (e.target === back || e.target.dataset.m === 'cancel') { close(); return; }
      if (e.target.dataset.m === 'ok') { const root = back; close(); onConfirm && onConfirm(root); }
    });
    const ok = back.querySelector('[data-m="ok"]'); if (ok) ok.focus();
  }
  function toast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    els.toastRoot.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, isError ? 5000 : 3000);
  }

  function replaceState(next, msg) {
    history.push(JSON.stringify(state)); future.length = 0;
    state = next; committed = JSON.stringify(state);
    window.Editor.setState(state);
    window.Flow.refreshAll();
    renderPreview(); scheduleSave(); updateUndoButtons(); scheduleChip();
    if (drawerOpen()) scheduleAts();
    if (msg) toast(msg);
  }

  /* ---------------- menus ---------------- */
  function openMenu(id) {
    closeMenus();
    const m = $(id); m.hidden = false;
    const btn = m.parentElement.querySelector('button'); btn.setAttribute('aria-expanded', 'true');
  }
  function closeMenus() {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true; const b = m.parentElement.querySelector('button'); if (b) b.setAttribute('aria-expanded', 'false'); });
  }
  function toggleMenu(id) { const m = $(id); if (m.hidden) openMenu(id); else closeMenus(); }

  /* ---------------- ATS drawer ---------------- */
  let atsTimer = null;
  function drawerOpen() { return els.drawer.classList.contains('open'); }
  function openDrawer() { closeMenus(); els.drawer.classList.add('open'); els.drawer.setAttribute('aria-hidden', 'false'); els.backdrop.hidden = false; runAts(); }
  function closeDrawer() { els.drawer.classList.remove('open'); els.drawer.setAttribute('aria-hidden', 'true'); els.backdrop.hidden = true; }
  function scheduleAts() { clearTimeout(atsTimer); atsTimer = setTimeout(runAts, 400); }
  function runAts() {
    const res = window.ATS.analyze(state, prefs.jd || '', { pages: pageCount() });
    const color = res.score >= 85 ? 'var(--ok)' : res.score >= 70 ? '#5aa8f0' : res.score >= 50 ? 'var(--warn)' : 'var(--danger)';
    els.scoreRing.style.setProperty('--pct', res.score);
    els.scoreRing.style.setProperty('--c', color);
    els.scoreValue.textContent = res.score;
    els.scoreGrade.textContent = res.grade;
    const fails = res.checks.filter(c => c.status === 'fail').length, warns = res.checks.filter(c => c.status === 'warn').length;
    els.scoreHint.textContent = RB.isEmpty(state) ? 'Upload or fill in a resume to get a meaningful score.' :
      `${fails} issue${fails === 1 ? '' : 's'} to fix, ${warns} suggestion${warns === 1 ? '' : 's'}. ${res.keywords ? `Keyword match: ${res.keywords.pct}% (aim for 75–80%).` : 'Add a job description to include keyword matching.'}`;
    updateChip();

    let html = '';

    // ---- Keyword match, hard and soft, with counts (Jobscan-style) ----
    const k = res.keywords;
    if (k && k.all.length) {
      const table = (rows, title) => rows.length ? `<div class="kw-table-wrap"><div class="kw-table-title">${esc(title)} <span>${rows.filter(r => r.matched).length}/${rows.length}</span></div>
        <table class="kw-table"><thead><tr><th>Keyword</th><th>Resume</th><th>Posting</th></tr></thead><tbody>${rows.map(r =>
          `<tr class="${r.matched ? 'hit' : 'miss'}"><td>${esc(r.term)}${r.synonyms.length ? `<small> = ${esc(r.synonyms.slice(0, 2).join(', '))}</small>` : ''}</td><td>${r.inResume || '<button type="button" class="chip missing" data-kw="' + esc(r.term) + '" title="Add to Skills (only if it is true for you)">+ add</button>'}</td><td>${r.inJd}</td></tr>`).join('')}</tbody></table></div>` : '';
      html += `<div class="report-card">
        <h3>Keyword match · ${k.pct}%</h3>
        <div class="kw-stat">Counts show how often each term appears. Recruiters search literally, so use the posting's exact words; an acronym and its expansion both count. Aim for 75–80% overall, not 100%.</div>
        ${table(k.hard, 'Hard skills & tools')}
        ${table(k.soft, 'Soft skills')}
      </div>`;
    }

    // ---- Metric coaching from the last AI rewrite ----
    if (lastTailor && lastTailor.coaching && lastTailor.coaching.length) {
      html += `<div class="report-card">
        <h3>Add real numbers to these bullets</h3>
        <div class="kw-stat">These lines have no measurable result. Nothing was invented; answer the question and add the figure yourself in "Edit details by hand".</div>
        ${lastTailor.coaching.map(c => `<div class="coach"><div class="coach-where">${esc(c.where)}</div><div class="coach-bullet">${esc(c.bullet)}</div><div class="coach-q">${esc(c.question)}</div></div>`).join('')}
      </div>`;
    }

    // ---- Line-by-line bullet critique ----
    if (res.lines && res.lines.length) {
      const shown = res.lines.slice(0, 12);
      html += `<div class="report-card">
        <h3>Bullets to strengthen · ${res.lines.length}</h3>
        <div class="kw-stat">Checked the way Resume Worded and Rezi do: opener, result, voice, length.</div>
        ${shown.map(l => `<div class="lint"><div class="lint-where">${esc(l.where)}</div><div class="lint-text">${esc(l.text)}</div><div class="lint-flags">${l.flags.map(f => `<span class="flag" title="${esc(f.tip)}">${esc(f.label)}</span>`).join('')}</div><div class="lint-tip">${esc(l.flags[0].tip)}</div></div>`).join('')}
        ${res.lines.length > shown.length ? `<div class="kw-stat">…and ${res.lines.length - shown.length} more. Fix the top ones first.</div>` : ''}
      </div>`;
    }

    // ---- Standard checks ----
    const order = { fail: 0, warn: 1, pass: 2 };
    const groups = [];
    res.checks.forEach(c => { let g = groups.find(x => x.name === c.group); if (!g) { g = { name: c.group, items: [] }; groups.push(g); } g.items.push(c); });
    html += groups.map(g => `<div class="check-group-title">${esc(g.name)}</div>` +
      g.items.sort((a, b) => order[a.status] - order[b.status]).map(c => `<div class="check-row ${c.status}"><span class="st">${c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}</span><div><div class="lbl">${esc(c.label)}</div><div class="det">${esc(c.detail)}</div></div></div>`).join('')
    ).join('');
    els.checkResults.innerHTML = html;
  }

  /* ---------------- downloads ---------------- */
  function doPrint() { window.Exporter.print(state); }
  function downloadTxt() {
    closeMenus();
    if (RB.isEmpty(state)) return toast('Add a resume first.', true);
    window.Exporter.downloadTxt(state);
  }
  async function downloadDocx() {
    closeMenus();
    if (RB.isEmpty(state)) return toast('Add a resume first.', true);
    const b = $('btnDocx'); if (b) b.disabled = true;
    try { await window.Exporter.downloadDocx(state); toast('Word document downloaded'); }
    catch (e) { console.error(e); toast(e.message || 'Word export failed', true); }
    finally { if (b) b.disabled = false; }
  }
  function pdfFlow() {
    closeMenus();
    if (RB.isEmpty(state)) { toast('Add some content first.', true); return; }
    if (prefs.hidePdfTips) { doPrint(); return; }
    modal({
      title: 'Download as PDF',
      body: `<p>The print dialog will open. It produces a real text-based PDF, which is exactly what applicant tracking systems need.</p>
        <ol>
          <li>Set <b>Destination</b> to <b>Save as PDF</b>.</li>
          <li>Keep <b>Margins</b> on <b>Default</b> (the resume includes its own).</li>
          <li>Turn <b>Headers and footers</b> off; keep <b>Background graphics</b> on.</li>
          <li>Paper size should be <b>${state.settings.paper === 'a4' ? 'A4' : 'Letter'}</b>.</li>
        </ol>`,
      confirmText: 'Open print dialog',
      extraHtml: '<label class="check"><input type="checkbox" id="hideTips"> Don\'t show again</label>',
      onConfirm: root => { const cb = root.querySelector('#hideTips'); if (cb && cb.checked) { prefs.hidePdfTips = true; savePrefs(); } doPrint(); }
    });
  }

  /* ---------------- toolbar ---------------- */
  function loadSample() {
    const go = () => {
      cancelAiRun();
      resetTailorBase();
      prefs.submitted = false; prefs.upload = { name: 'Sample resume', note: '' };
      lastRunJd = ''; prefs.lastRunJd = ''; savePrefs();
      replaceState(RB.sampleState(), 'Sample resume loaded');
      if (!isSimple()) { window.Editor.go('personal'); if (hasJd()) { if (window.AI.isConfigured()) scheduleAiTailor(300); else setTimeout(applyTailoring, 300); } }
      else { window.Flow.setUpload({ name: 'Sample resume', found: describeState(state), note: '' }); if (hasJd()) scheduleAutoRun(600); }
    };
    if (RB.isEmpty(state)) { dismissWelcome(); go(); return; }
    modal({ title: 'Load the sample resume?', body: '<p>This replaces everything you have entered. You can undo with Ctrl+Z.</p>', confirmText: 'Replace', onConfirm: go });
  }
  function dismissWelcome() { prefs.welcomeDismissed = true; savePrefs(); els.welcome.hidden = true; }

  function bindToolbar() {
    // The logo at top-left toggles the full section-by-section editor.
    $('brandBtn').addEventListener('click', () => {
      closeMenus();
      if (isSimple()) { setMode('edit'); window.Editor.go('personal'); }
      else setMode('simple');
    });
    $('btnDownload').addEventListener('click', () => toggleMenu('downloadMenu'));
    $('btnMore').addEventListener('click', () => toggleMenu('moreMenu'));
    document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });

    $('btnSample').addEventListener('click', () => { closeMenus(); loadSample(); });
    $('btnImport').addEventListener('click', () => { closeMenus(); if (!isSimple()) window.Editor.go('upload'); els.importFile.click(); });
    els.importFile.addEventListener('change', () => {
      const f = els.importFile.files[0]; els.importFile.value = '';
      if (!f) return;
      if (!isSimple()) window.Editor.go('upload');
      handleUpload(f);
    });
    $('btnExportJson').addEventListener('click', () => { closeMenus(); window.Exporter.downloadJSON(state); toast('Backup saved. Import it later to continue.'); });
    els.atsChip.addEventListener('click', openDrawer);
    $('atsClose').addEventListener('click', closeDrawer);
    els.checkResults.addEventListener('click', e => { const c = e.target.closest('[data-kw]'); if (c) addKeywordToSkills(c.dataset.kw); });
    $('atsGoJd').addEventListener('click', () => { closeDrawer(); window.Editor.go('jd'); });
    els.backdrop.addEventListener('click', closeDrawer);
    $('btnTxt').addEventListener('click', downloadTxt);
    $('btnDocx').addEventListener('click', downloadDocx);
    $('btnPdf').addEventListener('click', pdfFlow);
    $('previewPdf').addEventListener('click', pdfFlow);
    $('previewDocx').addEventListener('click', downloadDocx);
    $('previewTxt').addEventListener('click', downloadTxt);
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnAi').addEventListener('click', openAiSettings);
    $('btnTheme').addEventListener('click', () => { closeMenus(); setTheme(prefs.theme === 'dark' ? 'light' : 'dark'); });
    $('btnShortcuts').addEventListener('click', () => {
      closeMenus();
      modal({
        title: 'Keyboard shortcuts', hideCancel: true, confirmText: 'Close',
        body: `<div class="shortcut-list">
          <span><kbd>Ctrl</kbd> + <kbd>P</kbd></span><span>Download PDF (print dialog)</span>
          <span><kbd>Ctrl</kbd> + <kbd>S</kbd></span><span>Save a JSON backup</span>
          <span><kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></span><span>Undo / redo (outside a text field)</span>
          <span><kbd>Enter</kbd></span><span>In a bullet: start the next bullet</span>
          <span><kbd>Backspace</kbd></span><span>In an empty bullet: remove it</span>
          <span><kbd>Esc</kbd></span><span>Close panels and menus</span>
        </div>`
      });
    });
    $('btnClear').addEventListener('click', () => {
      closeMenus();
      if (RB.isEmpty(state)) return;
      modal({ title: 'Clear the whole resume?', body: '<p>All sections will be emptied. Design settings are kept. You can undo with Ctrl+Z.</p>', confirmText: 'Clear everything', danger: true, onConfirm: () => {
        const next = RB.defaultState(); next.settings = Object.assign({}, state.settings);
        prefs.welcomeDismissed = false; prefs.upload = null; prefs.submitted = false; prefs.lastRunJd = ''; savePrefs();
        lastRunJd = '';
        cancelAiRun();
        resetTailorBase();
        window.Editor.setUploadStatus('');
        window.Flow.setUpload(null);
        replaceState(next, 'Cleared'); window.Editor.go('upload'); renderJdResults();
      } });
    });

    $('zoomIn').addEventListener('click', () => setZoom(Math.min(2, Math.round((currentScale() + 0.1) * 10) / 10)));
    $('zoomOut').addEventListener('click', () => setZoom(Math.max(0.3, Math.round((currentScale() - 0.1) * 10) / 10)));
    $('zoomFit').addEventListener('click', () => setZoom('fit'));

    // Mobile tabs
    document.querySelectorAll('.mtab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.mtab').forEach(x => x.classList.toggle('active', x === b));
      els.workspace.dataset.view = b.dataset.view;
      if (b.dataset.view === 'preview') layoutPage();
    }));

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) { if (e.key === 'Escape') { closeMenus(); if (drawerOpen()) closeDrawer(); } return; }
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); if (!RB.isEmpty(state)) doPrint(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); window.Exporter.downloadJSON(state); toast('Backup saved'); }
      else if (!inField && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (!inField && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    });

    window.addEventListener('resize', () => { if (prefs.zoom === 'fit') layoutPage(); });
    window.addEventListener('beforeprint', () => window.Exporter.ensurePrintStyle(state));
    window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); RB.save(state); });
  }

  function setTheme(t) {
    prefs.theme = t; savePrefs();
    document.documentElement.dataset.theme = t;
    $('themeLabel').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
    const use = $('btnTheme').querySelector('use'); if (use) use.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  }

  /* ---------------- desktop / PWA ---------------- */
  function platformHooks() {
    if (IS_DESKTOP) {
      document.documentElement.classList.add('desktop');
      const beat = () => fetch('/__alive', { cache: 'no-store' }).catch(() => {});
      beat(); setInterval(beat, 4000);
      document.addEventListener('visibilitychange', beat);
      window.addEventListener('focus', beat);
      return;
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    setTheme(prefs.theme === 'dark' ? 'dark' : 'light');
    window.Editor.init(els.editor, els.rail, state, onEditorChange, { getJd: () => prefs.jd || '', aiCardHtml });
    window.Flow.init(els.flow, onEditorChange, {
      getJd: () => prefs.jd || '',
      hasResume: () => !RB.isEmpty(state),
      getResult: flowResult,
      describe: () => describeState(state),
      showAiSettings: () => !window.AI.isBuiltIn(),
      isSubmitted: () => !!prefs.submitted,
      getUpload: () => (prefs.upload && !RB.isEmpty(state)) ? { name: prefs.upload.name, found: describeState(state), note: prefs.upload.note || '' } : null,
      getAi: () => { const a = window.AI.active(); return { on: !!a.key, name: a.key ? a.spec.name : '' }; }
    });
    els.workspace.dataset.mode = prefs.mode === 'edit' ? 'edit' : 'simple';
    bindToolbar();
    refreshAiUi();
    renderPreview();
    updateUndoButtons();
    updateChip();
    platformHooks();
    renderJdResults();
    if (!isSimple() && !RB.isEmpty(state)) window.Editor.go(hasJd() ? 'jd' : 'upload');
    els.saveStatus.textContent = RB.isEmpty(state) ? 'Nothing leaves this device' : 'Restored your last session';
  }
  boot();
})();
