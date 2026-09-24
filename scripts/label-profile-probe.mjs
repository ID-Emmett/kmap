/**
 * 文字成本剖析探针：真实交互期间按阶段统计文字系统每帧耗时构成（投影 / 放置 / 图集刷新 / 整帧标签时间）。
 * 用于判断优化应针对哪一段，而不是凭猜测拆分。
 *
 * 用法：node scripts/label-profile-probe.mjs [url] [label]
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const label = process.argv[3] ?? 'labels';
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
const delay = ms => new Promise(r => setTimeout(r, ms));
const out = { url, stages: {}, errors: [] };
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.evaluate(() => {
    const map = window.__kmapMap3D;
    window.__labelProfile = { frames: [], last: null };
    window.__stopLabelProfile = map.observeFrames(() => {
      const diagnostics = map.getDiagnostics(), frame = map.getFrameState(), labels = diagnostics.labels;
      if (!labels) return;
      const profile = window.__labelProfile, previous = profile.last;
      const delta = previous ? { project: labels.projectMs - previous.projectMs, place: labels.placeMs - previous.placeMs,
        atlas: labels.atlasMs - previous.atlasMs, layouts: labels.layouts - previous.layouts } : { project: 0, place: 0, atlas: 0, layouts: 0 };
      profile.last = { projectMs: labels.projectMs, placeMs: labels.placeMs, atlasMs: labels.atlasMs, layouts: labels.layouts };
      profile.frames.push({ at: Math.round(performance.now()), labelMs: frame.labelMs, ms: frame.ms, cpuMs: frame.cpuMs,
        ...delta, candidates: labels.candidates, placed: labels.placed, quads: labels.quads, draws: diagnostics.render.drawCalls });
    });
  });
  await page.waitForFunction(() => window.__kmapMap3D.getDiagnostics().tiles?.idle === true, undefined, { timeout: 60000 });
  const center = { x: 800, y: 450 };
  const mark = name => page.evaluate(name => { window.__labelProfile.marks = window.__labelProfile.marks ?? {}; window.__labelProfile.marks[name] = window.__labelProfile.frames.length; }, name).then(() => name);

  // 静止基线：确认每帧固定开销。
  await delay(1500); await mark('idle');
  // 真实拖拽平移：标签持续重布局。
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(center.x + i * 18, center.y + i * 5, { steps: 4 });
  await page.mouse.up(); await delay(1200); await mark('drag');
  // 真实滚轮缩放：层级变化触发完整布局。
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -110); await delay(16); }
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 130); await delay(16); }
  await delay(1200); await mark('zoom');
  await delay(1500); await mark('settle');

  out.stages = await page.evaluate(() => {
    const profile = window.__labelProfile, marks = profile.marks ?? { idle: 0 };
    const slice = (from, to) => profile.frames.slice(marks[from] ?? 0, to === undefined ? profile.frames.length : marks[to]);
    const stats = values => { const sorted = values.slice().sort((a, b) => a - b); const quantile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
      return { n: sorted.length, p50: +quantile(.5).toFixed(3), p95: +quantile(.95).toFixed(3), max: +(sorted.at(-1) ?? 0).toFixed(3), mean: +(sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)).toFixed(3) }; };
    const order = ['idle', 'drag', 'zoom', 'settle'];
    const result = {};
    for (let i = 0; i < order.length; i++) {
      const frames = slice(order[i], order[i + 1]);
      if (!frames.length) { result[order[i]] = { frames: 0 }; continue; }
      result[order[i]] = { frames: frames.length,
        labelMs: stats(frames.map(f => f.labelMs)), project: stats(frames.map(f => f.project)), place: stats(frames.map(f => f.place)),
        atlas: stats(frames.map(f => f.atlas)),
        layoutFrames: frames.filter(f => f.layouts > 0).length, projectFrames: frames.filter(f => f.project > 0).length,
        placeFrames: frames.filter(f => f.place > 0).length, candidatesMean: Math.round(frames.reduce((a, f) => a + f.candidates, 0) / frames.length),
        quadsMean: Math.round(frames.reduce((a, f) => a + f.quads, 0) / frames.length), msP95: stats(frames.map(f => f.ms)) };
    }
    return result;
  });
} catch (error) { out.errors.push(`probe-error: ${String(error).slice(0, 300)}`); }
await browser.close();
mkdirSync(join(root, 'docs', 'evidence', 'streaming-rebuild'), { recursive: true });
const file = join(root, 'docs', 'evidence', 'streaming-rebuild', `label-profile-${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ file, ...out }, null, 2));
