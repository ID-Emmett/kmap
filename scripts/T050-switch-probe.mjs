/** T050 面板预设与快速开关验收：记录逐帧影像绘制和矢量请求门控。 */
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const result = { backend, stages: [], requests: [], console: [], frames: [] };
page.on('request', request => { if (/appmaptile|v8Maptile|kye_water|kye_admin|fonts\//.test(request.url())) result.requests.push(request.url()); });
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') result.console.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', error => result.console.push(`pageerror: ${error.stack ?? error}`));

async function stage(name, waitMs) {
  await page.waitForTimeout(waitMs);
  const snapshot = await page.evaluate(() => {
    const map = window.__kmapMap3D, d = map.getDiagnostics();
    return { basemap: d.basemap, raster: d.raster, workers: d.workers, sceneTiles: d.sceneTiles,
      tiles: d.tiles && { target: d.tiles.target, targetMissing: d.tiles.targetMissing, buildings: d.tiles.buildings,
        lineInstances: d.tiles.lineInstances, labels: d.labels?.placed }, render: d.render, memory: d.memory };
  });
  const image = join(output, `T050-${backend}-${name}.jpg`);
  await page.screenshot({ path: image, type: 'jpeg', quality: 82 });
  result.stages.push({ name, image, snapshot, requestCount: result.requests.length });
}

try {
  await page.goto(`http://127.0.0.1:6661/?basemap=satellite${backend === 'webgl2' ? '&renderer=webgl2' : ''}`,
    { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.waitForFunction(() => {
    const r = window.__kmapMap3D.getDiagnostics().raster;
    return r.ready > 0 && r.uncovered === 0;
  }, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const map = window.__kmapMap3D;
    window.__t050Frames = [];
    window.__t050Stop = map.observeFrames(() => {
      const f = map.getFrameState();
      window.__t050Frames.push({ ms: f.ms, cpuMs: f.cpuMs, zoom: f.view.zoom, basemap: map.getBasemap(),
        rasterDraws: map.raster.draws.size, uncovered: map.raster.cover.uncovered, vectorEngine: Boolean(map.engine) });
    });
  });
  await stage('pure-before-switch', 300);
  result.controls = await page.evaluate(() => [...document.querySelectorAll('button')].map(button => ({
    text: button.textContent?.trim(), aria: button.getAttribute('aria-label'), title: button.title })).filter(button =>
    /卫星|矢量|底图|Inspector|参数/.test(`${button.text} ${button.aria} ${button.title}`)).slice(0, 30));
  result.visibleButtons = await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0)
    .map(button => ({ text: button.textContent?.trim().slice(0, 40), aria: button.getAttribute('aria-label'), title: button.title,
      className: button.className, html: button.outerHTML.slice(0, 240) })).slice(0, 30));
  result.vectorAncestor = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '一键矢量');
    const parents = []; let parent = button;
    for (let i = 0; i < 6 && parent; i++, parent = parent.parentElement) parents.push({ tag: parent.tagName,
      className: parent.className, display: getComputedStyle(parent).display, rect: parent.getBoundingClientRect().toJSON() });
    return parents;
  });
  await page.locator('.profiler-toggle').click();
  await page.locator('button[title="Parameters"]').click();
  const visibleText = async (text) => {
    for (const item of await page.getByText(text, { exact: true }).all()) if (await item.isVisible()) return item;
    throw new Error(`可见控件不存在：${text}`);
  };
  if (!(await page.getByText('一键矢量', { exact: true }).isVisible())) await (await visibleText('底图')).click();
  await (await visibleText('一键矢量')).click();
  await stage('vector-preset', 3500);
  await (await visibleText('一键卫星')).click();
  result.purePresetStart = result.requests.length;
  await stage('satellite-preset', 1200);
  result.purePresetEnd = result.requests.length;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(i => window.__kmapMap3D.setBasemap({ vectorLines: i % 2 === 0, labels: i % 3 === 0 }), i);
    await page.waitForTimeout(25);
    await page.evaluate(() => window.__kmapMap3D.setBasemap({ vectorLines: false, labels: false }));
    await page.waitForTimeout(25);
  }
  result.pureFinalStart = result.requests.length;
  await stage('pure-after-rapid-switch', 1000);
  result.pureFinalEnd = result.requests.length;
  result.frames = await page.evaluate(() => { window.__t050Stop(); return window.__t050Frames; });
} catch (error) {
  result.fatal = String(error.stack ?? error);
} finally {
  writeFileSync(join(output, `T050-${backend}-switch.json`), JSON.stringify(result, null, 2));
  await browser.close();
}
const pureFrames = result.frames.filter(frame => frame.basemap.satellite && !frame.basemap.vectorLines && !frame.basemap.labels);
const vectorAfterPreset = result.requests.slice(result.purePresetStart, result.purePresetEnd).filter(url => !url.includes('appmaptile'));
const vectorAfterRapid = result.requests.slice(result.pureFinalStart, result.pureFinalEnd).filter(url => !url.includes('appmaptile'));
console.log(JSON.stringify({ backend, fatal: result.fatal, controls: result.controls, visibleButtons: result.fatal && result.visibleButtons,
  vectorAncestor: result.fatal && result.vectorAncestor, stages: result.stages.map(stage => ({ name: stage.name,
  basemap: stage.snapshot.basemap, rasterDraws: stage.snapshot.raster.drawCalls,
  vectorTiles: stage.snapshot.sceneTiles, buildings: stage.snapshot.tiles?.buildings, labels: stage.snapshot.tiles?.labels })),
  pureFrames: pureFrames.length, pureZeroDrawFrames: pureFrames.filter(frame => frame.rasterDraws === 0).length,
  uncoveredFrames: result.frames.filter(frame => frame.uncovered > 0).length,
  vectorRequestsAfterPreset: vectorAfterPreset.length, vectorRequestsAfterRapid: vectorAfterRapid.length,
  console: result.console.slice(0, 5) }, null, 2));
if (result.fatal || pureFrames.some(frame => frame.rasterDraws === 0 || frame.uncovered > 0) || vectorAfterPreset.length || vectorAfterRapid.length) process.exitCode = 1;
