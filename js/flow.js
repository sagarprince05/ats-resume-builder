/* =====================================================================
   The simple three-step flow: upload a CV, paste the job description,
   download the optimised resume. Everything else (section-by-section
   editing, design) lives behind the "Edit details" link.
   Exposes window.Flow
   ===================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"></use></svg>`;

  let root, emit, opts = {};
  let upload = null;        // { name, found, note } once a CV has been read
  let uploadBusy = '';      // status text while reading a file
  let uploadError = '';

  function init(el, cb, options) {
    root = el; emit = cb; opts = options || {};
    upload = opts.getUpload ? opts.getUpload() : null;   // restored from the last session
    render(); bind();
  }

  /* ---------------- state coming from the app ---------------- */
  const jd = () => (opts.getJd ? opts.getJd() : '') || '';
  const hasResume = () => !!(opts.hasResume && opts.hasResume());
  const result = () => (opts.getResult ? opts.getResult() : null) || null;
  const ai = () => (opts.getAi ? opts.getAi() : { on: false, name: '' });

  /* ---------------- rendering ---------------- */
  function render() {
    root.innerHTML = `
      <div class="flow-head">
        <h1>Tailor your resume to a job</h1>
        <p>Upload your CV, paste the posting, download the result. Everything stays on this device.</p>
      </div>
      <ol class="stepper" id="stepper" aria-label="Progress"></ol>
      <div id="step1"></div>
      <div id="step2"></div>
      <div id="stepGo"></div>
      <div id="step3"></div>
      <div class="flow-foot" id="flowFoot"></div>`;
    paintFoot();
    paintStep1(); paintStep2(true); paintGo(); paintStep3(); paintStepper();
  }

  const submitted = () => !!(opts.isSubmitted && opts.isSubmitted());
  const ready = () => hasResume() && jd().trim().length >= 20;

  /* Compact progress strip so the user always knows where they are. */
  function paintStepper() {
    const el = document.getElementById('stepper');
    if (!el) return;
    const r = result();
    const s1 = hasResume() ? 'done' : 'active';
    const s2 = jd().trim().length >= 20 ? 'done' : (hasResume() ? 'active' : '');
    const s3 = submitted() ? ((r && (r.busy || r.error)) ? 'active' : 'done') : (ready() ? 'active' : '');
    const item = (n, label, st) => `<li class="${st}"><span class="dot">${st === 'done' ? icon('check') : n}</span><span class="lbl">${esc(label)}</span></li>`;
    el.innerHTML = item(1, 'Upload CV', s1) + item(2, 'Job posting', s2) + item(3, 'Result', s3);
  }

  /* Footer links. "Edit details" moves into step 3 once a run has finished,
     so it is not shown twice. */
  function paintFoot() {
    const el = document.getElementById('flowFoot');
    if (!el) return;
    const showEdit = !submitted();
    const showAi = opts.showAiSettings && opts.showAiSettings();
    el.innerHTML = (showEdit ? `<button type="button" class="btn btn-ghost btn-sm" data-action="edit-details">${icon('edit')} Edit details by hand</button>` : '') +
      (showAi ? `<button type="button" class="btn btn-ghost btn-sm" data-action="ai-settings">${icon('sparkles')} AI settings</button>` : '');
    el.hidden = !showEdit && !showAi;
  }

  /* The Optimise button between steps 2 and 3. Nothing runs until it is clicked. */
  function paintGo() {
    const el = document.getElementById('stepGo');
    if (!el) return;
    const r = result();
    const busy = !!(r && r.busy);
    let label, hint, disabled;
    if (busy) { label = 'Optimising…'; hint = r.busyText || ''; disabled = true; }
    else if (!ready()) { label = 'Submit'; hint = 'Upload your CV and paste the job description. It optimises automatically once both are in.'; disabled = true; }
    else if (submitted()) { label = 'Submit again'; hint = 'Optimised automatically. Changed something? Submit again to rerun from your original CV.'; disabled = false; }
    else { label = 'Submit'; hint = 'Optimising starts automatically when you finish the job description, or click Submit now.'; disabled = false; }
    el.innerHTML = `<div class="go-row">
        <button type="button" class="btn btn-primary btn-lg go-btn" data-action="submit"${disabled ? ' disabled' : ''}>${busy ? '' : icon('sparkles')} ${esc(label)}</button>
        <div class="hint go-hint">${esc(hint)}</div>
      </div>`;
  }

  function stepShell(n, title, done, body) {
    return `<section class="flow-step${done ? ' done' : ''}">
      <div class="step-head"><span class="step-num">${done ? icon('check') : n}</span><h2>${esc(title)}</h2></div>
      <div class="step-body">${body}</div>
    </section>`;
  }

  /* Step 1 - upload */
  function paintStep1() {
    const el = document.getElementById('step1');
    if (!el) return;
    let body;
    if (uploadBusy) {
      body = `<div class="jd-status working"><span class="pulse"></span><span>${esc(uploadBusy)}</span></div>`;
    } else if (upload || hasResume()) {
      const info = upload || { name: 'Your saved resume', found: (opts.describe ? opts.describe() : {}), note: '' };
      const f = info.found || {};
      const bits = [f.experience ? `${f.experience} position${f.experience === 1 ? '' : 's'}` : '', f.skills ? `${f.skills} skills` : '', f.education ? `${f.education} education` : ''].filter(Boolean).join(' · ');
      body = `<div class="file-chip">
          ${icon('file-text')}
          <div><b>${esc(info.name)}</b><small>${esc(f.name || 'Name not found')}${bits ? ' · ' + esc(bits) : ''}</small></div>
          <button type="button" class="btn btn-sm" data-action="pick-file">Replace</button>
        </div>
        ${info.note ? `<div class="hint" style="margin-top:8px">${esc(info.note)}</div>` : ''}`;
    } else {
      body = `<div class="dropzone" id="dropzone" data-action="pick-file" role="button" tabindex="0" aria-label="Upload your CV">
          <div class="dz-icon">${icon('upload')}</div>
          <b>Drag your CV here</b>
          <span>or <u>browse your files</u></span>
          <div class="dz-formats"><span>PDF</span><span>DOCX</span><span>TXT</span></div>
        </div>
        <div class="or-row" style="margin-top:10px">
          <div class="hint">No CV file?</div>
          <button type="button" class="btn btn-sm" data-action="edit-details">Type it in</button>
          <button type="button" class="btn btn-sm" data-action="load-sample">Try a sample</button>
        </div>`;
    }
    if (uploadError) body += `<div class="jd-status error" style="margin-top:8px"><span class="pulse"></span><span>${esc(uploadError)}</span></div>`;
    el.innerHTML = stepShell(1, 'Upload your CV', (!!upload || hasResume()) && !uploadBusy, body);
  }

  /* Step 2 - job description */
  function paintStep2(force) {
    const el = document.getElementById('step2');
    if (!el) return;
    const a = ai();
    // The text box must never be rebuilt while the user is typing in it,
    // or the cursor is lost on every keystroke. Update only the badge.
    const existing = el.querySelector('#jdInput');
    if (existing && !force) {
      const done = jd().trim().length >= 20;
      const sec = el.querySelector('.flow-step');
      if (sec) {
        sec.classList.toggle('done', done);
        const num = sec.querySelector('.step-num');
        if (num) num.innerHTML = done ? icon('check') : '2';
      }
      return;
    }
    // Forced rebuild: keep the cursor where it was if the user is mid-typing.
    const hadFocus = existing && document.activeElement === existing;
    const caret = hadFocus ? existing.selectionStart : null;
    const body = `<textarea id="jdInput" class="jd-input" rows="7" placeholder="Paste the full job posting here — responsibilities, requirements, preferred skills.">${esc(jd())}</textarea>
      ${a.on
        ? `<div class="hint" style="margin-top:8px">Rewritten automatically by <b>${esc(a.name)}</b>. Every change is listed and nothing is invented.</div>`
        : `<div class="ai-card" style="margin-top:10px"><div class="ai-icon">${icon('sparkles')}</div><div class="ai-text"><b>Add a Groq API key for a real rewrite</b><small>Groq is free: about 1,000 requests a day, no card needed. Without a key the resume is only reordered, not rewritten.</small></div><button type="button" class="btn btn-primary btn-sm" data-action="ai-settings">Set up</button></div>`}`;
    el.innerHTML = stepShell(2, 'Paste the job description', jd().trim().length >= 20, body);
    if (hadFocus) {
      const nb = el.querySelector('#jdInput');
      if (nb) { nb.focus(); try { nb.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
    }
  }

  /* Step 3 - result and download. Only shown once Optimise has been clicked. */
  function paintStep3() {
    const el = document.getElementById('step3');
    if (!el) return;
    if (!submitted()) { el.innerHTML = ''; return; }
    const r = result();
    let body, done = false;
    if (!ready()) {
      body = `<div class="hint">Upload a CV and paste the job description, then click Submit.</div>`;
    } else if (r && r.busy) {
      body = `<div class="progress-box">
          <div class="progress-bar"><i></i></div>
          <div class="progress-msg" id="progressMsg">${esc(r.busyText || 'Optimising…')}</div>
          <div class="hint">Usually 20–60 seconds. Nothing is invented; every change will be listed in the report.</div>
        </div>`;
      startProgressMessages();
    } else if (r && r.error) {
      stopProgressMessages();
      body = `<div class="jd-status error"><span class="pulse"></span><span>${esc(r.error)}</span><button type="button" class="btn btn-sm" data-action="retry-ai">Retry</button></div>
        <div class="next-row" style="margin-top:12px">
          <button type="button" class="btn" data-action="try-another">${icon('upload')} Try another resume</button>
          <button type="button" class="btn" data-action="edit-details">${icon('edit')} Edit details by hand</button>
        </div>`;
    } else {
      // Finished: the resume and its download buttons are on the right.
      // Here, just the two ways forward.
      done = true;
      stopProgressMessages();
      body = `<div class="ready-banner">${icon('check')}<div><b>Your resume is ready</b><small>Download it on the right, or make changes below.</small></div></div>
        <div class="next-row">
          <button type="button" class="btn btn-primary" data-action="try-another">${icon('upload')} Try another resume</button>
          <button type="button" class="btn" data-action="edit-details">${icon('edit')} Edit details by hand</button>
        </div>`;
    }
    el.innerHTML = stepShell(3, done ? 'All done' : 'Your resume', done, body);
  }
  /* Rotating status lines while the rewrite runs. One request does all
     the work, so these describe the stages in order rather than track them. */
  const STAGES = ['Reading the job posting…', 'Matching it against your experience…', 'Rewriting the summary and bullet points…', 'Reordering skills to match the posting…', 'Checking nothing was invented…', 'Almost there…'];
  let progressTimer = null, progressIdx = 0;
  function startProgressMessages() {
    if (progressTimer) return;
    progressIdx = 0;
    progressTimer = setInterval(() => {
      const el = document.getElementById('progressMsg');
      if (!el) { stopProgressMessages(); return; }
      progressIdx = Math.min(progressIdx + 1, STAGES.length - 1);
      el.textContent = STAGES[progressIdx];
    }, 7000);
    const el = document.getElementById('progressMsg'); if (el) el.textContent = STAGES[0];
  }
  function stopProgressMessages() { clearInterval(progressTimer); progressTimer = null; }

  /* ---------------- public updates ---------------- */
  function setUpload(info) { upload = info; uploadBusy = ''; uploadError = ''; paintStep1(); paintGo(); paintStep3(); paintStepper(); }
  function setUploadBusy(text) { uploadBusy = text; uploadError = ''; paintStep1(); paintStepper(); }
  function setUploadError(text) { uploadBusy = ''; uploadError = text; paintStep1(); paintStepper(); }
  function refreshResult() { paintGo(); paintStep3(); paintStep2(); paintFoot(); paintStepper(); }
  function refreshAll() { paintStep1(); paintStep2(true); paintGo(); paintStep3(); paintFoot(); paintStepper(); }
  function focusJd() { const t = document.getElementById('jdInput'); if (t) { t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }

  /* ---------------- events ---------------- */
  function bind() {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'use-title') { emit('use-title', { title: b.dataset.title }); return; }
      emit(a);
    });
    root.addEventListener('input', e => { if (e.target.id === 'jdInput') { emit('jd', { text: e.target.value }); paintGo(); paintStepper(); } });
    // Ctrl+Enter in the posting box submits, for keyboard users.
    root.addEventListener('keydown', e => { if (e.target.id === 'jdInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); emit('submit'); } });
    // Leaving the box counts as "finished": optimise now rather than waiting out the idle timer.
    // Deferred: focusout can fire in the middle of a re-render (the box
    // being replaced), and the handler repaints, which would throw.
    root.addEventListener('focusout', e => { if (e.target.id === 'jdInput') setTimeout(() => emit('jd-done'), 0); });
    root.addEventListener('keydown', e => {
      if (e.target.id === 'dropzone' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); emit('pick-file'); }
    });
    root.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#dropzone'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    root.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#dropzone'); if (d) d.classList.remove('over'); });
    root.addEventListener('drop', e => {
      const d = e.target.closest && e.target.closest('#dropzone');
      if (!d) return;
      e.preventDefault(); d.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) emit('upload', { file: f });
    });
  }

  window.Flow = { init, setUpload, setUploadBusy, setUploadError, refreshResult, refreshAll, focusJd };
})();
