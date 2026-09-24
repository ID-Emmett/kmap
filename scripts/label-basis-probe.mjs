/**
 * 文字渲染基准探针：pan 跨越浮动原点边界期间逐帧采样文字批次基准诊断。
 *
 * `mismatch` 为已提交顶点基准与渲染基准之差，大于 0 表示基准被提前切换，
 * 仍在显示的上批文字会整体错位同等距离（整批文字跳动）；`error` 为渲染补偿偏差。
 * 两个值在任意帧都必须为 0。
 *
 * 用法：node scripts/label-basis-probe.mjs [url] [label]
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const label = process.argv[3] ?? 'basis';
let pw;
for (const candidate of [process.env.PLAYWRIGHT_CORE_PATH, join(root, 'node_modules', 'playwright-core')].filter(Boolean).concat(
  existsSync(join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx'))
    ? readdirSync(join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')).map(entry => join(process.env.LOCALAPPDATA, 'npm-cache', '_npx', entry, 'node_modules', 'playwright-core')) : [])) {
  const file = join(candidate, 'index.mjs');
  if (existsSync(file)) { pw = await import(new URL(`file://${file.replace(/\\/g, '/')}`).href); break; }
}
if (!pw) throw new Error('playwright-core 未找到');
const browser = await pw.chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)); });
const out = { url, frames: 0, maxError: 0, maxMismatch: 0, violations: [], placed: 0, quads: 0, errors };
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.evaluate(() => {
    const map = window.__kmapMap3D;
    window.__basisProbe = { frames: 0, maxError: 0, maxMismatch: 0, violations: [] };
    window.__stopBasisProbe = map.observeFrames(() => {
      const probe = window.__basisProbe, basis = map.getDiagnostics().labels?.basis;
      if (!basis) return;
      probe.frames++;
      if (basis.error > probe.maxError) probe.maxError = basis.error;
      if (basis.mismatch > probe.maxMismatch) probe.maxMismatch = basis.mismatch;
      // 1 米以上即为基准不一致：文字会整体偏移同等距离。
      if (basis.mismatch > 1 && probe.violations.length < 20) probe.violations.push({ at: Math.round(performance.now()), mismatch: Math.round(basis.mismatch) });
    });
  });
  await page.waitForFunction(() => window.__kmapMap3D.getDiagnostics().tiles?.idle === true, undefined, { timeout: 60000 });
  // 真实拖拽：zoom 15 下每瓦片 256 像素，单程约 3 个瓦片边界，覆盖多次浮动原点切换。
  const center = { x: 800, y: 450 };
  for (const direction of [1, -1]) {
    const from = { x: center.x + (direction > 0 ? 0 : 800), y: center.y + (direction > 0 ? 0 : 240) };
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(from.x + direction * i * 20, from.y + direction * i * 6, { steps: 4 });
    await page.mouse.up(); await delay(1200);
  }
  const probe = await page.evaluate(() => {
    window.__stopBasisProbe();
    const diagnostics = window.__kmapMap3D.getDiagnostics();
    return { ...window.__basisProbe, placed: diagnostics.labels?.placed ?? 0, quads: diagnostics.labels?.quads ?? 0 };
  });
  Object.assign(out, probe);
} catch (error) { out.errors.push(`probe-error: ${String(error).slice(0, 300)}`); }
await browser.close();
mkdirSync(join(root, 'docs', 'evidence', 'streaming-rebuild'), { recursive: true });
const file = join(root, 'docs', 'evidence', 'streaming-rebuild', `label-basis-${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ file, maxError: out.maxError, maxMismatch: out.maxMismatch, frames: out.frames, violations: out.violations.length, placed: out.placed, quads: out.quads, errors: out.errors.slice(0, 3) }, null, 2));
