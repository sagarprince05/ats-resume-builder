# ATS Resume Builder

A resume maker that runs entirely in the browser. Enter your details, pick a template, check the result against a job description, and download a text-based PDF that applicant tracking systems (ATS) can parse.

No build step, no server, no account. Nothing you type leaves your computer.

## Run it

**Windows app**: download or build `dist\ATS Resume Builder.exe` and double-click it. It opens in its own window and needs no installation. To get Start Menu and Desktop shortcuts, unzip `dist\ATS-Resume-Builder-Windows.zip` and run `Install.bat` (no admin rights needed; `Uninstall.bat` removes it). See `desktop\INSTALL.txt`.

**Browser**: open `index.html` in Chrome, Edge, Firefox or Safari, or serve the folder:

```bash
python -m http.server 8765
```

and visit http://localhost:8765. From a served copy you can also use the browser's "Install app" option to add it like a desktop app (it works offline afterwards).

There are no build steps and no external dependencies at runtime; the Word export library is bundled in `vendor/`.

## Continuous integration

`.github/workflows/build.yml` runs on every push and pull request:

1. builds the three website folders (GitHub Pages, Cloudflare Pages, Netlify);
2. runs the browser test suite in headless Chromium against the source tree and the built sites (`tests/`): upload → posting → automatic rewrite, replace CV, download menu, relay mode, model fallbacks, error handling, and the relay functions themselves;
3. builds the Windows app and installer with PyInstaller and smoke tests the exe (it must serve the app on its fixed port with no key baked in);
4. keeps the site zips and the installer as artifacts, and publishes the GitHub Pages folder from `main` once Pages is set to "GitHub Actions".

Run the same tests locally (Node 18+):

```bash
cd tests && npm ci && npx playwright install chromium && node ci.mjs /index.html
```

Or open `tests/e2e.html?site=/index.html` from any static server to watch them in a normal browser.

## Host it online for free

The same app runs as a website, so anyone can use it from a link on their own device. `hosting\build-site.ps1` assembles an upload-ready folder with a tiny relay function that keeps your Groq and Gemini keys on the server; visitors never see or need a key. Cloudflare Pages and Netlify both host it for free. Step-by-step instructions are in [hosting/HOSTING.md](hosting/HOSTING.md).

## Build the Windows app yourself

Requires Python 3 (PyInstaller is installed automatically):

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

This produces `dist\ATS Resume Builder Setup.exe` (a one-file installer to send to others) and `dist\ATS Resume Builder.exe` (portable). To bake your API keys into the build so the finished app never shows any key settings, double-click `Build with my key.bat` on the Desktop (it asks for a Groq key and a Gemini key; either one is enough) or run:

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -GroqKey "gsk_..." -GeminiKey "AQ...."
```

Anyone holding the exe can extract a baked-in key, so only bake keys you are willing to revoke. The exe starts a tiny local server and opens the app in Microsoft Edge or Chrome in app mode, so printing to PDF and downloads use the normal browser dialogs. The exe is not code-signed, so SmartScreen may ask for confirmation on first run.

## How it works

Three steps on one screen:

1. **Upload your CV** — drop a PDF, Word (.docx) or text file onto the page, or click to browse.
2. **Paste the job description.**
3. **Download** as PDF, Word or plain text.

The rewrite runs automatically as soon as both are filled in, and again whenever the job description changes. What changed is listed under step 3, and "Undo all" restores your original.

Everything else — editing sections by hand, templates, fonts, section order, the ATS score breakdown — sits behind **Edit details by hand** at the bottom, and **Simple view** brings you back.

**AI layer (optional, recommended).** Open the ⋯ menu → AI settings and paste your own API key. Two free providers are supported:

| Provider | Key from | Free allowance |
|---|---|---|
| Groq (used first) | console.groq.com → API Keys | About 1,000 requests a day, no card. GPT-OSS 120B, Llama 3.3 70B. Very fast. |
| Google Gemini (backup) | aistudio.google.com → Get API key | Lower daily limits, no card. Gemini Flash. |

Either key alone works. With both, the selected provider is used first and the other takes over automatically whenever it is busy on every model, so a rewrite almost never fails outright. The model dropdown is filled from your own account as soon as a key is present, so it can never offer a model you cannot use; if a saved model has since been retired the app switches to the best available one and says so. With a key set:
- uploaded resumes are read by the model and mapped into the fields far more accurately than pattern matching;
- every job-description change triggers a real rewrite: the summary is rewritten to mirror the posting, bullets are rephrased with the posting's terminology and strong verbs, skills are reordered and phrased the way the posting phrases them, and the headline is adjusted when it honestly fits.

Guardrails are built into the prompt and enforced with a strict output schema: no new employers, titles, dates, degrees, certifications, tools or numbers can be introduced, positions cannot be added, merged or reordered, and every change is listed. The rewrite always starts from the pre-optimisation version of your resume, so switching postings never compounds edits; loading or uploading a different resume resets that baseline. Keys are stored only on your device and sent only to the provider they belong to. If a call fails (bad key, rate limit, safety block, truncated reply) the tool says why, offers Retry, and falls back to the built-in rule-based reordering so your resume is never left damaged. Without a key it uses that rule-based reordering only.

If the chosen model is busy or rate-limited, the app retries briefly and then moves down the provider's list (Groq: GPT-OSS 120B → Llama 3.3 70B → GPT-OSS 20B → Llama 3.1 8B; Gemini: 3.8 Flash → 3.7 Flash → 3.5 Flash Lite → …). If every model of that provider is busy and the other provider has a key, the request goes there. Each switch is noted in the change list.

Groq is called through its OpenAI-compatible chat endpoint with a strict JSON schema, falling back to plain JSON mode for models that do not support schemas. Gemini is called through `generateContent` with a response schema.

A sample resume to try the upload with is in `samples/`.

## Features

**Editing**
- Sections for personal details, summary, work experience, education, skills (grouped), projects, certifications, awards, languages, and unlimited custom sections (volunteering, publications, and so on).
- Rename any section heading. Hide sections you do not need. Drag to reorder sections.
- Move, duplicate, collapse, and delete entries. One bullet per line for achievements.
- Action verb picker inserts strong verbs at the cursor.
- Inline hints on every section with resume-writing best practice.
- Undo/redo (Ctrl+Z / Ctrl+Y), autosave to the browser, dark mode for the editor.

**Design**
- Five templates: Classic, Modern, Minimal, Compact, Executive. All single-column, real text, standard headings.
- ATS-safe font list, font size, line height, margins, section spacing, accent colour, US Letter or A4.
- Live preview with zoom and page-break guides, plus a page count warning.

**ATS check**
- A score out of 100 built from 20+ checks: contact details, summary length, action verbs, quantified results, pronouns, clichés, skills count, dates, length, standard headings, font safety, unusual characters.
- Paste a job description to extract its keywords and see which ones are missing. One click adds a missing keyword to your skills.

**Auto-tailoring to a job description**
- Turn on "Auto-tailor my resume to this posting" in the ATS check panel, or click "Tailor now".
- Reorders the skills inside each group, and the groups themselves, so matches to the posting come first.
- Reorders the bullet points under each role and project so the most relevant achievement leads.
- Moves the most relevant project to the top.
- Adds skills the posting asks for that you already mention in your summary, roles, projects, or certifications to the Skills section.
- Detects the posting's job title and offers it as your headline (or sets it if you had none).
- Never invents experience. Every change is listed, Ctrl+Z undoes step by step, and "Revert tailoring" restores the pre-tailoring version.

**Export**
- PDF via the browser print dialog (text-based, selectable, ATS-readable).
- Word (.docx) with matching layout.
- Plain text (.txt) for pasting into online application forms.
- JSON backup that you can re-import later or on another device.

## Files

```
index.html        page shell
css/app.css       editor UI styles
css/resume.css    resume document + template styles (what gets printed)
js/data.js        data model, defaults, sample data, storage
js/editor.js      left-hand form
js/preview.js     resume HTML rendering + plain-text structure
js/ats.js         scoring and keyword extraction
js/export.js      JSON / TXT / DOCX / print
js/app.js         wiring, undo, drawer, modals
```

## Tips for the best ATS results

- Use the same words the posting uses. "Project Management" and "PM" are not the same to a parser.
- Keep to one page for under seven years of experience, two pages otherwise.
- Save the PDF with the print dialog's "Save as PDF" option, not a screenshot or image-based converter.
- Fill in every date. Parsers build a timeline from them.
