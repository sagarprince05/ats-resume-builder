# Hosting the ATS Resume Builder for free

The app is a static website plus one tiny "relay" function that adds your
Groq and/or Gemini keys on the server. Visitors open a link, upload a CV, paste a posting
and download the PDF. They never see or need an API key. Both platforms
below are free with no card, and Groq itself is free, so the running cost
is zero.

| | Cloudflare Pages (recommended) | Netlify |
|---|---|---|
| Free allowance | Unlimited page views, 100,000 relay calls a day | 100 GB a month, 125,000 relay calls a month |
| Upload method | Connect a GitHub repo (or the Wrangler CLI) | Drag and drop a folder in the browser |
| Address you get | `your-name.pages.dev` | `your-name.netlify.app` |
| Custom domain | Free | Free |

Groq's free key allows roughly 1,000 rewrites a day, which is the real
ceiling; a Gemini key next to it takes over whenever Groq is busy. Both
hosts sit far above those numbers.

## Which route hides the key?

| Route | Key visible to visitors? | Who pays quota |
|---|---|---|
| Cloudflare Pages or Netlify (relay) | No. The key stays in the host's secret store; the app shows no key settings at all. | You (shared free quota) |
| GitHub Pages | The app asks each visitor for their own free key. | Each visitor |
| Desktop exe built with "Build with my key.bat" | No. The key is inside the exe; no settings shown. | You |

## 1. Build the site folder

From the project folder:

```bash
powershell -ExecutionPolicy Bypass -File hosting\build-site.ps1 -Target netlify
```

or `-Target cloudflare`. This creates `build\site-netlify` (or
`build\site-cloudflare`) and a `.zip` of it. The folder contains no key.

## 2a. Netlify (fastest, no git needed)

1. Sign up at netlify.com (free).
2. Open **app.netlify.com/drop** and drag the `build\site-netlify` folder onto the page.
   The site is live in about a minute at a random `*.netlify.app` address.
3. In the site: **Site configuration → Environment variables → Add a variable**.
   Key `GROQ_API_KEY`, value = your Groq key (from console.groq.com → API Keys). Save.
   Optionally add `GEMINI_API_KEY` too (from aistudio.google.com → Get API key) as the backup.
4. **Deploys → Trigger deploy → Deploy site**, so the function picks up the key.
5. Optional: **Site configuration → Site details → Change site name** for a nicer address.

Updating later: run the build script again and drag the new folder onto
**Deploys** in the same site.

## 2b. Cloudflare Pages connected to the GitHub repo (recommended: keys hidden, updates automatic)

The project repository already contains everything Cloudflare needs. Once
connected, every push to `main` rebuilds and redeploys the site, and the
keys live only in Cloudflare's secret store.

1. Sign up at cloudflare.com (free, no card).
2. **Workers & Pages → Create → Pages → Connect to Git** → authorize GitHub → pick
   the `ats-resume-builder` repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: `bash hosting/build-site.sh cloudflare`
   - Build output directory: `build/site-cloudflare`
   Click **Save and Deploy**. The first deploy takes about a minute.
4. In the Pages project: **Settings → Variables and Secrets → Add**.
   Type **Secret**, name `GROQ_API_KEY`, value = your Groq key. Save.
   Add a second secret `GEMINI_API_KEY` for the backup provider if you have one.
5. **Deployments → (latest) → Retry deployment**, so the secrets are applied.
6. Open the `*.pages.dev` address. There must be no key card and no AI settings
   entry; `/api/health` must show `"keys":{"groq":true,...}`.

Optional: **Custom domains** lets you attach your own domain for free.

### Netlify connected to the repo

The same works on Netlify: **Add new site → Import an existing project →
GitHub → the repo**. The `netlify.toml` at the repository root already sets
the build command, publish folder and functions folder, so just click
**Deploy**, then add `GROQ_API_KEY` / `GEMINI_API_KEY` under **Site
configuration → Environment variables** and trigger a redeploy.

## 2c. GitHub Pages (automatic, but visitors must use their own key)

GitHub Pages cannot run the relay, so this route asks each visitor for
their own free Groq or Gemini key (the app shows the "Add a free AI key"
card). In exchange it is fully automatic: the workflow in
`.github/workflows/build.yml` builds, tests and publishes on every push.

1. Create a repository on github.com and push this project to its `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push (or re-run the workflow under **Actions**). The site appears at
   `https://<your-username>.github.io/<repo>/` after a minute or two.

The same workflow also keeps the Cloudflare and Netlify folders and the
Windows installer as downloadable artifacts on every run (Actions → the
run → Artifacts).

## 3. Check it

Open the site address. There should be no "Add a Groq API key" card and no
AI settings entry in the menu. Upload a CV, paste a posting: the rewrite
runs through the relay. `https://your-site/api/health` should show
`{"ok":true,"relay":"ai","keys":{"groq":true,"gemini":false}}` (or both
true). If a key shows false, the variable was not saved or the site was not
redeployed after adding it.

## Notes

- **Quota.** Everyone who uses the site shares your Groq and Gemini quotas. The relay
  only accepts calls from the site's own pages, so other websites cannot
  spend it, and it caps request size. If you want a hard daily cap per
  visitor, that can be added with Cloudflare's free rate-limit rules.
- **Without the relay** (for example on GitHub Pages, which cannot run
  functions) the same folder still works: the app notices the relay is
  missing and asks each visitor for their own free key instead.
- **Privacy.** Resumes are processed in the visitor's browser and sent only
  to the AI provider for the rewrite. Nothing is stored on the host.
- **Updates.** The service worker caches the app for offline use; after a
  redeploy, visitors get the new version on their next reload.
