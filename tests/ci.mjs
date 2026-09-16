/* Headless test runner for CI and local use.
     cd tests && npm ci && npx playwright install --with-deps chromium
     node ci.mjs                                  (tests the source tree)
     node ci.mjs /build/site-github/index.html    (tests a built site folder)
   Serves the repository root on a local port, opens tests/e2e.html in
   headless Chromium, waits for the suite to finish and exits non-zero on
   any failure. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sites = process.argv.slice(2).length ? process.argv.slice(2) : ['/index.html'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch();
let failures = 0;
try {
  for (const site of sites) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('  [page error]', e.message));
    const url = `http://127.0.0.1:${port}/tests/e2e.html?site=${encodeURIComponent(site)}`;
    console.log(`\n== ${site}`);
    await page.goto(url);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
    const results = await page.evaluate(() => window.__results);
    for (const r of results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n        ' + r.error.split('\n').slice(0, 3).join('\n        ')}`);
      if (!r.ok) failures++;
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
