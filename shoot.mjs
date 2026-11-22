// Screenshot + playtest driver for Sundown District (headless Chromium via playwright-core).
// Serves game/ on a local port, loads each ?shot= scene, waits for window.__shotReady,
// records console errors / page errors / failed requests, and writes JPEG screenshots.
// Usage: node shoot.mjs [shots|test] — "shots" takes the 4 screenshots, "test" plays the game.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'game');
const mode = process.argv[2] || 'shots';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const data = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-length': data.length });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log('serving game/ on', port);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const errors = [];
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  return page;
}

if (mode === 'shots') {
  const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
  for (const s of shots) {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html${s.query}`, { waitUntil: 'load', timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 60000 });
    } catch {
      errors.push('timeout waiting __shotReady for ' + s.name + '; __gameError=' + await page.evaluate(() => window.__gameError));
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(here, 'screenshots', s.name), type: 'jpeg', quality: 82 });
    const sz = statSync(join(here, 'screenshots', s.name)).size;
    console.log(s.name, sz, 'bytes, gameError=', await page.evaluate(() => window.__gameError));
    await page.close();
  }
} else {
  // Playtest: start the story, walk, sprint, enter a car, drive, shoot, check systems.
  const page = await newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=1337`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ err: window.__gameError, counts: window.__sundown.counts, screen: window.__sundown.state.screen }));
  console.log('loaded:', JSON.stringify(before));
  await page.click('#play');
  await page.waitForTimeout(500);
  const p0 = await page.evaluate(() => window.__sundown.player);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__sundown.player);
  console.log('walked from', JSON.stringify(p0), 'to', JSON.stringify(p1), 'moved=', Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1), 'm');
  // Walk to a parked car: teleport the test player beside the sedan at (22,-100)
  // (headless QA shortcut; the F key itself is what is being exercised).
  await page.evaluate(() => {
    const p = window.__sundown.playerObj;
    p.x = 22; p.z = -97; p.mesh.position.set(22, 0, -97);
  });
  await page.waitForTimeout(200);
  const car = await page.evaluate(() => window.__sundown.counts.parked);
  console.log('parked cars:', car);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  console.log('after F near spawn:', JSON.stringify(await page.evaluate(() => window.__sundown.vehicle)));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  console.log('driving:', JSON.stringify(await page.evaluate(() => ({ v: window.__sundown.vehicle, w: window.__sundown.wanted, p: window.__sundown.player }))));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(300);
  // Fire the pistol on foot.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  console.log('after shot:', JSON.stringify(await page.evaluate(() => ({ ammo: window.__sundown.state.ammo, wanted: window.__sundown.wanted }))));
  console.log('mission:', JSON.stringify(await page.evaluate(() => window.__sundown.mission)));
  console.log('counts:', JSON.stringify(await page.evaluate(() => window.__sundown.counts)));
  console.log('gameError:', await page.evaluate(() => window.__gameError));
  await page.screenshot({ path: join(here, 'screenshots', 'test-play.jpg'), type: 'jpeg', quality: 82 });
  await page.close();
}
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
server.close();
if (errors.length) process.exitCode = 1;
