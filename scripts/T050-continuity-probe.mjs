/** T050 连续缩放验收：逐帧覆盖与全部整数层级画面。 */
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
const result = { backend, steps: [], requests: [], failures: [], console: [], frames: [] };
page.on('request', request => { if (/appmaptile|v8Maptile|kye_water|kye_admin|fonts\//.test(request.url())) result.requests.push(request.url()); });
page.on('requestfailed', request => result.failures.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') result.console.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', error => result.console.push(`pageerror: ${error.stack ?? error}`));

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
      const frame = map.getFrameState();
      window.__t050Frames.push({ zoom: frame.view.zoom, ms: frame.ms, cpuMs: frame.cpuMs, renderMs: frame.renderMs,
        uncovered: map.raster.cover.uncovered, ready: [...map.raster.entries.values()].filter(entry => entry.state === 'ready').length,
        draws: map.raster.draws.size });
    });
  });
  const center = { lng: 116.3946533203125, lat: 39.90552253972854 };
  for (const direction of ['up', 'down']) {
    const levels = direction === 'up' ? Array.from({ length: 73 }, (_, i) => i / 4)
      : Array.from({ length: 73 }, (_, i) => 18 - i / 4);
    for (const zoom of levels) {
      await page.evaluate(({ center, zoom }) => window.__kmapMap3D.setView({ center, zoom, pitch: 0, bearing: 0 }), { center, zoom });
      await page.waitForTimeout(120);
      if (!Number.isInteger(zoom)) continue;
      const snapshot = await page.evaluate(() => {
        const d = window.__kmapMap3D.getDiagnostics();
        return { actualBackend: d.backend, basemap: d.basemap, raster: d.raster, workers: d.workers,
          sceneTiles: d.sceneTiles, memory: d.memory, frame: d.frame, render: d.render };
      });
      const image = join(output, `T050-${backend}-${direction}-z${zoom}.jpg`);
      await page.screenshot({ path: image, type: 'jpeg', quality: 78 });
      result.steps.push({ direction, zoom, image, snapshot, requestCount: result.requests.length });
    }
    await page.waitForTimeout(direction === 'up' ? 4000 : 1000);
  }
  result.frames = await page.evaluate(() => { window.__t050Stop(); return window.__t050Frames; });
} catch (error) {
  result.fatal = String(error.stack ?? error);
} finally {
  writeFileSync(join(output, `T050-${backend}-continuity.json`), JSON.stringify(result, null, 2));
  await browser.close();
}
const frameCount = result.frames.length;
const uncovered = result.frames.filter(frame => frame.uncovered > 0);
const vectorRequests = result.requests.filter(url => !url.includes('appmaptile'));
const maxGpu = Math.max(0, ...result.steps.map(step => step.snapshot.memory.total));
const maxEntries = Math.max(0, ...result.steps.map(step => step.snapshot.raster.entries));
console.log(JSON.stringify({ backend, fatal: result.fatal, steps: result.steps.length, frameCount, uncoveredFrames: uncovered.length,
  maxUncovered: Math.max(0, ...uncovered.map(frame => frame.uncovered)), vectorRequests: vectorRequests.length,
  rasterRequests: result.requests.length - vectorRequests.length, maxGpu, maxEntries,
  maxCpu: Math.max(0, ...result.steps.map(step => step.snapshot.raster.cpuBytes)),
  failedTiles: Math.max(0, ...result.steps.map(step => step.snapshot.raster.failed)), errors: Math.max(0, ...result.steps.map(step => step.snapshot.raster.errors)),
  failedRequests: result.failures.length, console: result.console.slice(0, 5) }, null, 2));
if (result.fatal || uncovered.length || vectorRequests.length || maxEntries > 192) process.exitCode = 1;
