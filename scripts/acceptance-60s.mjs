/**
 * 点击 Playground【运行 60 秒验收】并回传结果；仅读取，不修改项目文件。
 * 同时采集逐秒诊断采样与瓦片时间线，用于把验收断言（尤其是 cacheRevisitNoFetch）
 * 关联到具体请求的瓦片 key 与创建来源。
 *
 * 用法：
 *   node scripts/acceptance-60s.mjs [url] [--out docs/evidence/streaming-rebuild/acceptance-60s-T047.json]
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < cli.length; i++) {
  if (cli[i].startsWith('--')) { const next = cli[i + 1]; if (next !== undefined && !next.startsWith('--')) { flags.set(cli[i].slice(2), next); i++; } else flags.set(cli[i].slice(2), 'true'); }
  else positional.push(cli[i]);
}
const url = positional[0] ?? 'http://127.0.0.1:6663/';
const outFile = flags.get('out') ?? join('docs', 'evidence', 'streaming-rebuild', 'acceptance-60s.json');
let pw;
for (const c of [process.env.PLAYWRIGHT_CORE_PATH, join(root, 'node_modules', 'playwright-core')].filter(Boolean).concat(
  existsSync(join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx')) ? readdirSync(join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')).map(e => join(process.env.LOCALAPPDATA, 'npm-cache', '_npx', e, 'node_modules', 'playwright-core')) : []))
  { const f = join(c, 'index.mjs'); if (existsSync(f)) { pw = await import(new URL(`file://${f.replace(/\\/g, '/')}`).href); break; } }
if (!pw) throw new Error('playwright-core 未找到');
const browser = await pw.chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const out = { url, clicked: false, backend: null, result: null, panel: null, errors };
try {
  // 逐秒采样：网络请求起数、淘汰、条目状态与时间线长度，用于回访窗口归因。
  await page.addInitScript(() => {
    window.__kmapSamples = []; window.__kmapClickAt = 0;
    setInterval(() => {
      if (!window.__kmapMap3D) return;
      const tiles = window.__kmapMap3D.getDiagnostics().tiles; if (!tiles) return;
      const entries = window.__kmapMap3D.getTileSnapshot().entries;
      window.__kmapSamples.push({ at: Math.round(performance.now()), starts: tiles.network.starts, evictions: tiles.cache.evictions,
        entries: tiles.cache.entries, idle: tiles.idle, targetMissing: tiles.targetMissing,
        states: entries.map(e => e.key + '|' + e.state + '|' + e.reason + '|' + e.priority + '|' + e.visible),
        // 逐秒条目集合用于回访归因：只保留 key 与状态，避免证据文件膨胀。
        compact: entries.map(e => e.key + ':' + e.state) });
    }, 1000);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 120000 });
  out.backend = await page.evaluate(() => window.__kmapMap3D.getBackend());
  out.candidates = await page.evaluate(() => [...document.querySelectorAll('button,[role=button],a,label,input')].map(e => (e.textContent || e.getAttribute('name') || e.id || '').trim().slice(0, 40)).filter(Boolean).slice(0, 40));
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('button,[role=button],a,label,span,div')];
    const hit = all.find(e => /60\s*秒/.test(e.textContent ?? '') && (e.textContent ?? '').length < 40);
    if (!hit) throw new Error('未找到验收按钮');
    window.__kmapClickAt = performance.now();
    (hit.closest('button,[role=button],a') ?? hit).click();
  });
  out.clicked = true;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => ({ data: Object.fromEntries(Object.entries(document.documentElement.dataset).filter(([k]) => /kmap/i.test(k))),
      bench: window.__kmapBenchmark ?? null, status: window.__kmapStatus?.state ?? null }));
    const keys = Object.keys(snap.data);
    out.dataKeys = keys; out.result = snap.data; out.bench = snap.bench;
    const done = /完成|通过|失败|结果|PASS|FAIL|达标|未达标/.test(JSON.stringify(snap.data.kmapBenchmark ?? '')) || (snap.bench && /done|complete|pass|fail/i.test(JSON.stringify(snap.bench).slice(0, 400)));
    if (done) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  out.panel = await page.evaluate(() => { const el = document.querySelector('#benchmark-status') ?? document.querySelector('[id*=benchmark]'); return el ? el.textContent : null; });
  // 回访窗口归因：把 cache-B → cache-A-return 之间发生的 fetch 事件与其窗口前条目状态对齐。
  out.revisit = await page.evaluate(() => {
    const samples = window.__kmapSamples ?? []; const timeline = window.__kmapMap3D.getTileTimeline();
    const raw = document.documentElement.dataset.kmapBenchmark;
    let stages = null; try { stages = JSON.parse(raw.replace(/^"|"$/g, '')).stages; } catch { stages = null; }
    const mark = (name) => stages?.find(s => s.name === name)?.atMs;
    const from = mark('cache-B'), to = mark('cache-A-return');
    const at = e => e.at - window.__kmapClickAt;
    const window_ = from === undefined || to === undefined ? [] : timeline.filter(e => at(e) >= from && at(e) <= to);
    const before = window_ .length ? samples.filter(s => s.at - window.__kmapClickAt <= from).at(-1) : undefined;
    const beforeMap = new Map((before?.states ?? []).map(s => { const [key, state, reason] = s.split('|'); return [key, { state, reason }]; }));
    const fetches = window_.filter(e => e.type === 'fetch').map(e => ({ key: e.key, atMs: Math.round(at(e)), before: beforeMap.get(e.key)?.state ?? 'absent', beforeReason: beforeMap.get(e.key)?.reason ?? null }));
    const ready = window_.filter(e => e.type === 'ready').map(e => e.key);
    const empties = window_.filter(e => e.type === 'empty').map(e => e.key);
    return { from: from === undefined ? null : Math.round(from), to: to === undefined ? null : Math.round(to), fetches, ready, empties,
      startsBefore: before?.starts ?? null, startsAfter: samples.at(-1)?.starts ?? null,
      evictionsBefore: before?.evictions ?? null, evictionsAfter: samples.at(-1)?.evictions ?? null };
  });
  out.samples = await page.evaluate(() => (window.__kmapSamples ?? []).map(s => ({ at: s.at, starts: s.starts, evictions: s.evictions, entries: s.entries, idle: s.idle, targetMissing: s.targetMissing, states: s.states })));
} catch (e) { out.errors.push(`run: ${String(e).slice(0, 300)}`); } finally {
  const target = resolve(root, outFile);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ file: target, clicked: out.clicked, backend: out.backend, errors: out.errors.slice(0, 5), passed: out.result?.kmapBenchmark ? JSON.parse(out.result.kmapBenchmark.replace(/^"|"$/g, ''))?.passed : null,
    revisit: out.revisit ? { from: out.revisit.from, to: out.revisit.to, fetches: out.revisit.fetches, startsBefore: out.revisit.startsBefore, startsAfter: out.revisit.startsAfter, evictionsBefore: out.revisit.evictionsBefore, evictionsAfter: out.revisit.evictionsAfter } : null }, null, 1));
  await browser.close();
}
