/* =====================================================================
   Exporters: JSON backup/restore, plain text, Word (.docx), and the
   print-to-PDF flow. Exposes window.Exporter
   ===================================================================== */
(function () {
  'use strict';
  const RB = window.RB;
  const clean = s => String(s == null ? '' : s).trim();

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /* "First_Last_Job_Title" — recruiters see the filename in their inbox and
     ATS list, so name plus target role is the recommended convention. */
  function baseName(state) {
    const safe = s => clean(s).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const n = safe(state.personal.fullName);
    const t = safe(state.personal.title).slice(0, 40);
    if (n && t) return `${n}_${t}`;
    return (n || 'Resume') + '_Resume';
  }

  /* ---------- JSON ---------- */
  function downloadJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    download(blob, baseName(state) + '.json');
  }
  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const obj = JSON.parse(String(r.result));
          if (!obj || typeof obj !== 'object' || !('personal' in obj || 'experience' in obj)) throw new Error('not a resume file');
          resolve(RB.normalize(obj));
        } catch (e) { reject(new Error('That file is not a resume export from this tool.')); }
      };
      r.onerror = () => reject(new Error('Could not read the file.'));
      r.readAsText(file);
    });
  }

  /* ---------- Plain text ---------- */
  function downloadTxt(state) {
    const blob = new Blob([window.Preview.toText(state)], { type: 'text/plain;charset=utf-8' });
    download(blob, baseName(state) + '.txt');
  }

  /* ---------- Print / PDF ---------- */
  function ensurePrintStyle(state) {
    let st = document.getElementById('printPageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'printPageStyle'; document.head.appendChild(st); }
    const s = state.settings;
    st.textContent = `@page { size: ${s.paper === 'a4' ? 'A4' : 'letter'} portrait; margin: ${s.margin}in; }`;
  }
  function print(state) {
    ensurePrintStyle(state);
    const prev = document.title;
    document.title = baseName(state);
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 30);
  }

  /* ---------- Word ---------- */
  async function downloadDocx(state) {
    const D = window.docx;
    if (!D) throw new Error('The Word export library has not loaded. Check your internet connection and try again.');
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType, LevelFormat, ExternalHyperlink, Tab } = D;
    const s = state.settings;
    const struct = window.Preview.structure(state);
    const font = s.font;
    const size = Math.round(s.fontSize * 2);      // half-points
    const line = Math.round(s.lineHeight * 240);  // 240 = single spacing
    const marginTw = Math.round(s.margin * 1440);
    const pageW = s.paper === 'a4' ? 11906 : 12240;
    const pageH = s.paper === 'a4' ? 16838 : 15840;
    const usable = pageW - marginTw * 2;
    const accent = (s.template === 'modern' ? s.accent : '#111111').replace('#', '');
    const centered = s.template === 'classic' || s.template === 'executive';
    const gap = s.sectionGap;

    const run = (text, o = {}) => new TextRun(Object.assign({ text, font, size }, o));
    // Right-aligned text after a tab stop (dates, locations).
    const tabbed = (text, o = {}) => Tab
      ? new TextRun(Object.assign({ font, size, children: [new Tab(), text] }, o))
      : run('\t' + text, o);
    const children = [];

    // Header
    children.push(new Paragraph({
      alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 40 },
      children: [run(struct.name || 'Your Name', { bold: true, size: Math.round(size * 2), color: s.template === 'modern' ? accent : '111111', allCaps: s.template === 'executive' })]
    }));
    if (struct.title) children.push(new Paragraph({ alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 40 }, children: [run(struct.title, { size: size + 2 })] }));
    if (struct.contact.length) {
      const parts = [];
      struct.contact.forEach((c, i) => {
        if (i) parts.push(run('  |  ', { color: '777777' }));
        if (/^[^\s@]+@[^\s@]+$/.test(c)) parts.push(new ExternalHyperlink({ link: 'mailto:' + c, children: [run(c)] }));
        else if (/\.[a-z]{2,}(\/|$)/i.test(c) && !/\d{3}[\s.-]?\d{3}/.test(c)) parts.push(new ExternalHyperlink({ link: 'https://' + c, children: [run(c)] }));
        else parts.push(run(c));
      });
      children.push(new Paragraph({
        alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: Math.round(160 * gap) },
        border: s.template === 'modern' || s.template === 'compact' ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 4 } } : undefined,
        children: parts
      }));
    }

    const heading = title => new Paragraph({
      keepNext: true,
      spacing: { before: Math.round(200 * gap), after: 80 },
      alignment: s.template === 'executive' ? AlignmentType.CENTER : AlignmentType.LEFT,
      border: s.template === 'minimal' ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 1 } },
      children: [run(title.toUpperCase(), { bold: true, color: s.template === 'modern' ? accent : '111111', size: size + 1 })]
    });
    const headLine = (primary, date, opts = {}) => new Paragraph({
      keepNext: true,
      spacing: { before: opts.first ? 0 : Math.round(100 * gap), after: 0, line },
      tabStops: [{ type: TabStopType.RIGHT, position: usable }],
      children: [run(primary, { bold: true }), ...(date ? [tabbed(date)] : [])]
    });
    const subLine = (sec, loc) => new Paragraph({
      keepNext: true,
      spacing: { after: 0, line },
      tabStops: [{ type: TabStopType.RIGHT, position: usable }],
      children: [run(sec, { italics: true }), ...(loc ? [tabbed(loc)] : [])]
    });
    const bullet = text => new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: { after: 30, line },
      children: [run(text)]
    });
    const para = (text, o = {}) => new Paragraph({ spacing: { after: 40, line }, alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [run(text, o)] });

    struct.sections.forEach(sec => {
      children.push(heading(sec.title));
      sec.blocks.forEach((b, i) => {
        if (sec.key === 'summary') { children.push(para(b.text, { center: s.template === 'executive' })); return; }
        if (sec.key === 'skills') {
          children.push(new Paragraph({ spacing: { after: 40, line }, children: b.category ? [run(b.category + ': ', { bold: true }), run(b.items)] : [run(b.items)] }));
          return;
        }
        if (sec.key === 'languages') { children.push(para(b.text)); return; }
        if (b.title || b.date) children.push(headLine(b.title || b.sub || '', b.date, { first: i === 0 }));
        if (b.title && (b.sub || b.loc)) children.push(subLine(b.sub || '', b.loc));
        if (b.text) children.push(para(b.text));
        (b.lines || []).forEach(l => children.push(bullet(l)));
      });
    });

    const doc = new Document({
      creator: 'ATS Resume Builder',
      title: baseName(state).replace(/_/g, ' '),
      styles: { default: { document: { run: { font, size } } } },
      numbering: {
        config: [{
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }]
        }]
      },
      sections: [{
        properties: { page: { size: { width: pageW, height: pageH }, margin: { top: marginTw, right: marginTw, bottom: marginTw, left: marginTw } } },
        children
      }]
    });
    const blob = await Packer.toBlob(doc);
    download(blob, baseName(state) + '.docx');
  }

  window.Exporter = { downloadJSON, readJSONFile, downloadTxt, downloadDocx, print, ensurePrintStyle, baseName };
})();
