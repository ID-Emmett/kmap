/** T050 真实浏览器探针：记录影像画面、请求、控制台和底图状态。 */
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
const label = process.argv[4] ?? 'smoke';
const url = new URL(process.argv[3] ?? 'http://127.0.0.1:6661/');
url.searchParams.set('basemap', 'satellite');
if (backend === 'webgl2') url.searchParams.set('renderer', 'webgl2');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const result = { backend, url: String(url), requests: [], failures: [], httpErrors: [], console: [], stages: [] };
page.on('request', request => {
  const address = request.url();
  if (/appmaptile|v8Maptile|kye_water|kye_admin|fonts\//.test(address)) result.requests.push(address);
});
page.on('requestfailed', request => result.failures.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() }); });
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') result.console.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', error => result.console.push(`pageerror: ${error.stack ?? error}`));

async function stage(name, view) {
  if (view) await page.evaluate(next => window.__kmapMap3D.setView(next), view);
  await page.waitForFunction(() => {
    const raster = window.__kmapMap3D?.getDiagnostics().raster;
    return raster && raster.ready > 0 && raster.patches > 0 && raster.uncovered === 0;
  }, undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);
  const diagnostics = await page.evaluate(() => window.__kmapMap3D.getDiagnostics());
  const image = join(output, `T050-${backend}-${label === 'smoke' ? name : `${label}-${name}`}.png`);
  await page.screenshot({ path: image });
  result.stages.push({ name, image, diagnostics, requestCount: result.requests.length });
}

try {
  await page.goto(String(url), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await stage('z15', { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15.8, pitch: 0, bearing: 0 });
  result.pureSatelliteRequests = result.requests.length;
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ vectorLines: true }));
  await page.waitForTimeout(3500);
  await stage('z15-lines');
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ vectorLines: false, labels: true }));
  await page.waitForTimeout(3500);
  await stage('z15-labels');
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ vectorLines: false, labels: false }));
  await stage('z0', { center: { lng: 0, lat: 0 }, zoom: 0, pitch: 0, bearing: 0 });
  await stage('z20', { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 20, pitch: 0, bearing: 0 });
} catch (error) {
  result.fatal = String(error.stack ?? error);
} finally {
  writeFileSync(join(output, `T050-${backend}-${label}.json`), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ backend, fatal: result.fatal, stages: result.stages.map(({ name, diagnostics }) => ({ name,
  actualBackend: diagnostics.backend, raster: diagnostics.raster, workers: diagnostics.workers, tiles: diagnostics.tiles,
  render: diagnostics.render })), requests: result.requests.length,
  pureSatelliteRequests: result.pureSatelliteRequests,
  vectorRequestsDuringPure: result.requests.slice(0, result.pureSatelliteRequests).filter(url => !url.includes('appmaptile')).length,
  vectorRequests: result.requests.filter(url => !url.includes('appmaptile')).length,
  failures: result.failures.slice(0, 10), httpErrors: result.httpErrors.slice(0, 10), console: result.console.slice(0, 10) }, null, 2));
if (result.fatal) process.exitCode = 1;
