/** T050 慢网和一次性失败探针：验证已就绪祖先的连续覆盖与自动重试。 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'evidence', 'satellite-basemap');
mkdirSync(output, { recursive: true });
const candidates = [process.env.PLAYWRIGHT_CORE_PATH, join(root, 'node_modules', 'playwright-core')].filter(Boolean);
const npx = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
if (existsSync(npx)) for (const entry of readdirSync(npx)) candidates.push(join(npx, entry, 'node_modules', 'playwright-core'));
const packageRoot = candidates.find(candidate => existsSync(join(candidate, 'index.mjs')));
if (!packageRoot) throw new Error('playwright-core 未找到');
const { chromium } = await import(pathToFileURL(join(packageRoot, 'index.mjs')).href);
const backend = process.argv[2] ?? 'webgpu';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const result = { backend, stages: [], requests: [], console: [], injectedFailures: [], retries: [], frames: [] };
const attempts = new Map();
page.on('request', request => { if (/appmaptile|v8Maptile|kye_water|kye_admin|fonts\//.test(request.url())) result.requests.push(request.url()); });
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') result.console.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', error => result.console.push(`pageerror: ${error.stack ?? error}`));

async function stage(name, waitMs) {
  await page.waitForTimeout(waitMs);
  const snapshot = await page.evaluate(() => {
    const map = window.__kmapMap3D;
    const diagnostics = map.getDiagnostics();
    return { view: diagnostics.view, raster: diagnostics.raster, workers: diagnostics.workers,
      cover: map.raster.cover, memory: diagnostics.memory, frame: diagnostics.frame };
  });
  const image = join(output, `T050-${backend}-${name}.jpg`);
  await page.screenshot({ path: image, type: 'jpeg', quality: 80 });
  result.stages.push({ name, image, snapshot, requests: result.requests.length });
}

try {
  await page.goto(`http://127.0.0.1:6661/?basemap=satellite${backend === 'webgl2' ? '&renderer=webgl2' : ''}`,
    { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.evaluate(() => window.__kmapMap3D.setView({ center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 0, pitch: 0, bearing: 0 }));
  await page.waitForFunction(() => {
    const r = window.__kmapMap3D?.getDiagnostics().raster;
    return r && r.ready >= 4 && r.uncovered === 0;
  }, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const map = window.__kmapMap3D;
    window.__t050Frames = [];
    window.__t050Stop = map.observeFrames(() => {
      const f = map.getFrameState();
      window.__t050Frames.push({ zoom: f.view.zoom, pitch: f.view.pitch, ms: f.ms, uncovered: map.raster.cover.uncovered,
        draws: map.raster.draws.size });
    });
  });
  await page.route(/appmaptile/, async route => {
    const url = new URL(route.request().url());
    const z = Number(url.searchParams.get('z'));
    const key = `${z}/${url.searchParams.get('x')}/${url.searchParams.get('y')}`;
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    if (z > 1 && (Number(url.searchParams.get('x')) + Number(url.searchParams.get('y'))) % 7 === 0 && count === 1) {
      result.injectedFailures.push(key);
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary failure' });
      return;
    }
    if (count > 1) result.retries.push(key);
    if (z > 1) await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.evaluate(() => window.__kmapMap3D.setView({ zoom: 12, pitch: 0, bearing: 0 }));
  await stage('fallback-early', 100);
  await stage('fallback-recovered', 5000);
  await page.evaluate(() => window.__kmapMap3D.setView({ center: { lng: 116.42, lat: 39.9 }, zoom: 15, pitch: 60, bearing: 25 }));
  await stage('fallback-pitch', 2000);
  for (let i = 0; i < 16; i++) {
    await page.evaluate(i => window.__kmapMap3D.setView({ center: { lng: 116.38 + (i % 4) * .025,
      lat: 39.89 + (i % 3) * .015 }, zoom: 14.5 + (i % 3) * .5, pitch: i % 2 ? 75 : 45,
      bearing: i * 22.5 }), i);
    await page.waitForTimeout(60);
  }
  await stage('rapid-pan-pitch', 1600);
  result.frames = await page.evaluate(() => { window.__t050Stop(); return window.__t050Frames; });
} catch (error) {
  result.fatal = String(error.stack ?? error);
} finally {
  writeFileSync(join(output, `T050-${backend}-fallback.json`), JSON.stringify(result, null, 2));
  await browser.close();
}
const uncovered = result.frames.filter(frame => frame.uncovered > 0);
const vectorRequests = result.requests.filter(url => !url.includes('appmaptile'));
console.log(JSON.stringify({ backend, fatal: result.fatal, stages: result.stages.map(stage => ({ name: stage.name,
  raster: stage.snapshot.raster, maxGap: stage.snapshot.cover.maxGap })), frames: result.frames.length,
  uncoveredFrames: uncovered.length, zeroDrawFrames: result.frames.filter(frame => frame.draws === 0).length,
  injectedFailures: result.injectedFailures.length, retries: result.retries.length, vectorRequests: vectorRequests.length,
  console: result.console.slice(0, 5) }, null, 2));
if (result.fatal || uncovered.length || vectorRequests.length || result.injectedFailures.length === 0 || result.retries.length === 0) process.exitCode = 1;
