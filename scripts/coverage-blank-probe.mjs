/**
 * 覆盖空窗探针：层级替换与首次加载期间逐帧采样覆盖状态与画面内容占比。
 *
 * `ink` 为画布深色像素占比（内容代理指标），`ink = 0` 即整屏空白；
 * `uncovered` 为没有可用来源的目标数，`levels` 为实际参与绘制的来源层级。
 * mode: set（瞬跳到目标层级）| wheel（逐级滚轮）| fast（不等加载完成直接缩放，复现首次加载空窗）
 *
 * 用法：node scripts/coverage-blank-probe.mjs [url] [label] [from] [to] [mode]
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const label = process.argv[3] ?? 'zoom';
const fromZoom = Number(process.argv[4] ?? 6);
const toZoom = Number(process.argv[5] ?? 7.6);
const mode = process.argv[6] ?? 'set';
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
const out = { url, fromZoom, toZoom, mode, frames: [], errors: [] };
// 视点可按位置复现：默认北京，第 7/8 个参数可指定经度/纬度。
const center = { lng: Number(process.argv[7] ?? 116.3946533203125), lat: Number(process.argv[8] ?? 39.90552253972854) };
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.evaluate(({ center, fromZoom }) => window.__kmapMap3D.setView({ center, zoom: fromZoom, bearing: 0, pitch: 0 }), { center, fromZoom });
  if (mode === 'fast') await delay(250);
  else {
    await delay(600);
    await page.waitForFunction(() => { const t = window.__kmapMap3D.getDiagnostics().tiles; return !!t && t.idle && t.targetMissing === 0; }, undefined, { timeout: 90000 }).catch(() => {});
  }
  await page.evaluate(() => {
    const map = window.__kmapMap3D;
    // 视觉代理：抽样画布上深色像素（线路等内容）占比；内容缺失时该比例骤降。
    const canvas = document.querySelector('#map-canvas');
    const probeCanvas = new OffscreenCanvas(64, 36), context = probeCanvas.getContext('2d', { willReadFrequently: true });
    window.__zoomProbe = { frames: [] };
    window.__stopZoomProbe = map.observeFrames(() => {
      const diagnostics = map.getDiagnostics(), tiles = diagnostics.tiles, frame = map.getFrameState();
      if (!tiles) return;
      context.drawImage(canvas, 0, 0, 64, 36);
      const pixels = context.getImageData(0, 0, 64, 36).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) if (.299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2] < 200) dark++;
      // 4×4 分区内容占比：局部瓦片内容消失会在单个分区里骤降，全屏平均会掩盖它。
      const cells = [];
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
        let cellDark = 0;
        for (let y = gy * 9; y < gy * 9 + 9; y++) for (let x = gx * 16; x < gx * 16 + 16; x++) {
          const i = (y * 64 + x) * 4;
          if (.299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2] < 200) cellDark++;
        }
        cells.push(+(cellDark / 144).toFixed(3));
      }
      const minCell = Math.min(...cells);
      const levels = Object.entries(tiles.drawnLevels ?? {}).map(([z, n]) => `${z}:${n}`).join(',');
      const engine = map.engine;
      const overview = engine ? engine.overview.map(a => `${a.z}/${a.x}/${a.y}`).join(' ') : '';
      // 孤儿实例：仍在场景中渲染、但其瓦片条目已被淘汰（几何已归还复用池）。
      let orphan = 0, lines = 0, lineOrphan = 0, missingLines = 0, zeroSegments = 0, hiddenLines = 0, stencilMismatch = 0, uninitLines = 0;
      const lineSamples = [];
      if (engine) {
        for (const instance of engine.surfaces.instances.values()) {
          const key = `${instance.address.z}/${instance.address.x}/${instance.address.y}`;
          const entry = engine.entries.get(key);
          const gone = !entry || !entry.surface;
          if (gone) orphan++;
          if (instance.lines) {
            lines++; if (gone) lineOrphan++;
            // 线段数据为空表示该瓦片没有可画的道路内容（数据侧问题而非渲染丢弃）。
            if (!instance.lines.data?.segments?.length) { zeroSegments++; if (lineSamples.length < 8) lineSamples.push(`${key}:empty`); }
            // 线在渲染上完全不存在时，必然是下列状态之一：被模板裁掉、网格隐藏或槽位未初始化。
            if (instance.lines.mesh.visible === false) { hiddenLines++; if (lineSamples.length < 8) lineSamples.push(`${key}:hidden`); }
            if (instance.mesh.material.stencilRef !== instance.lines.mesh.material.stencilRef) {
              stencilMismatch++; if (lineSamples.length < 8) lineSamples.push(`${key}:ref${instance.mesh.material.stencilRef}!=${instance.lines.mesh.material.stencilRef}`);
            }
            const viewZoom = instance.lines.viewZoom?.value;
            if (typeof viewZoom === 'number' && viewZoom < 0) { uninitLines++; if (lineSamples.length < 8) lineSamples.push(`${key}:uninit`); }
          } else {
            missingLines++;
            if (lineSamples.length < 8) lineSamples.push(`${key}:none`);
          }
        }
      }
      // 逐格诊断：每个绘制格子的来源层级，以及该来源是否带线段数据。
      // 来源无线段数据即"渲染上完全不存在线路"，且能定位到具体来源瓦片。
      const noLineCells = [];
      for (const patch of engine?.patches ?? []) {
        const surface = engine.entries.get(patch.key)?.surface;
        const segments = surface?.lines?.data?.segments?.length ?? 0;
        if (segments === 0) noLineCells.push(`${patch.cell.z}/${patch.cell.x}/${patch.cell.y}<-${patch.source.z}/${patch.source.x}/${patch.source.y}${surface ? '' : ':nosurface'}`);
      }
      // 回退瓦片线段携带的层级范围组合：低层级数据里的道路是 transportation(maxZoom:7)。
      // 修复前按图层自身范围写入，渲染期用相机目标层级判定即被剔除；修复后写宽松值不再剔除。
      const styleRanges = new Set(); let scannedSegments = 0;
      for (const instance of engine?.surfaces.instances.values() ?? []) {
        const styles = instance.lines?.data?.styles; if (!styles) continue;
        for (let i = 2; i + 1 < styles.length && scannedSegments < 4000; i += 4, ++scannedSegments) styleRanges.add(`${styles[i]},${styles[i + 1]}`);
      }
      const lineStyle = [...styleRanges].slice(0, 8);
      window.__zoomProbe.frames.push({ at: Math.round(performance.now()), zoom: +frame.view.zoom.toFixed(3), levels, orphan, lines, lineOrphan, lineStyle,
        noLineCells, noLineCount: noLineCells.length,
        missingLines, zeroSegments, lineSamples, hiddenLines, stencilMismatch, uninitLines,
        overview, demand: tiles.demand, active: tiles.scheduler?.active, queued: tiles.scheduler?.queued,
        ink: +(dark / 2304).toFixed(4), cells, minCell, patches: tiles.patches, committed: tiles.committed,
        uncovered: tiles.uncoveredCells, missing: tiles.targetMissing,
        gap: tiles.displayZoomGap, detailGap: tiles.pendingDetailGap, entries: tiles.cache.entries, evict: tiles.cache.evictions,
        gpuMB: +(tiles.resources.gpuBytes / 1048576).toFixed(1), idle: tiles.idle });
    });
  });
  await delay(400);
  if (mode === 'roam') {
    // 多城市往返漫游：施加真实的缓存压力，复现"父层级被淘汰后回退链断裂"。
    const stops = [
      { center: { lng: 114.5, lat: 30.5 }, zoom: 8, bearing: 0, pitch: 0 },
      { center: { lng: 116.4, lat: 39.9 }, zoom: 6, bearing: 0, pitch: 0 },
      { center: { lng: 116.4, lat: 39.9 }, zoom: 8, bearing: 0, pitch: 0 },
      { center: { lng: 121.5, lat: 31.2 }, zoom: 6, bearing: 0, pitch: 0 },
      { center: { lng: 121.5, lat: 31.2 }, zoom: 8, bearing: 0, pitch: 0 },
      { center: { lng: 113.3, lat: 23.1 }, zoom: 8, bearing: 0, pitch: 0 },
      { center: { lng: 114.5, lat: 30.5 }, zoom: 6, bearing: 0, pitch: 0 },
      { center: { lng: 114.5, lat: 30.5 }, zoom: 8, bearing: 0, pitch: 0 },
    ];
    for (const stop of stops) { await page.evaluate(view => window.__kmapMap3D.setView(view), stop); await delay(1600); }
  } else if (mode === 'wheel' || mode === 'fast' || mode === 'roundtrip') {
    await page.mouse.move(800, 450);
    const fast = mode !== 'wheel';
    const steps = Math.round(Math.abs(toZoom - fromZoom) / (fast ? 0.2 : 0.25));
    const zoomIn = async () => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -110); await delay(fast ? 16 : 70); } };
    const zoomOut = async () => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 110); await delay(fast ? 16 : 70); } };
    await zoomIn();
    // 往返缩放：反复进出同一层级会施加缓存压力，用于观察旧层级是否被淘汰。
    if (mode === 'roundtrip') { await delay(1500); await zoomOut(); await delay(1500); await zoomIn(); }
  } else if (mode === 'offline') {
    // 断网后放大：新层级无法加载，屏幕必须继续由已就绪的祖先层级支撑。
    // 若此时线路整体消失而面要素仍在，说明线路的绘制链路被错误关闭。
    // 先在线放大并等待目标层级部分就绪，再断网：复现"看到内容后网络中断"。
    // 这样目标层级会挤掉祖先层级的显示用途，祖先随即失去需求被回收；
    // 断网后剩余目标永远就绪不了，回退只能逐级向上，细密要素随之消失。
    // 断网后再放大（人工复现顺序：先在低层级等加载完成，再断网下钻）：
    // 目标层级完全无法加载，屏幕全部由已就绪的祖先层级支撑。
    // 此时回退来源层级低于相机目标层级，图层可见性必须按来源层级求值，
    // 否则低层级独有的图层（如 transportation）会被目标层级剔除，而高层级独有的图层（road）又没有数据。
    await page.route('**/*', route => route.abort());
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), toZoom);
    await delay(9000);
    await page.unroute('**/*');
    await delay(1500);
  } else if (mode === 'slow') {
    // 限速复现"网络差时空白很久"：观察旧层级消失与新层级出现之间的空窗。
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 120 * 1024, uploadThroughput: 120 * 1024 });
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), toZoom);
    await delay(12000);
  } else if (mode === 'twice') {
    // 首次与再次缩放对照：同一视点先完整加载一次，再看重复缩放是否仍出现空窗。
    const mark = async stage => { await page.evaluate(name => {
      window.__zoomProbe.marks = window.__zoomProbe.marks ?? {}; window.__zoomProbe.marks[name] = window.__zoomProbe.frames.length;
    }, stage); };
    const settle = () => page.waitForFunction(() => { const t = window.__kmapMap3D.getDiagnostics().tiles; return !!t && t.idle && t.targetMissing === 0; }, undefined, { timeout: 90000 }).catch(() => {});
    await mark('first-before');
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), toZoom);
    await settle(); await mark('first-after');
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), fromZoom);
    await settle(); await mark('second-before');
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), toZoom);
    await settle(); await mark('second-after');
    await delay(600);
  } else {
    await page.evaluate(zoom => window.__kmapMap3D.setView({ zoom }), toZoom);
  }
  await delay(600);
  await page.waitForFunction(() => { const t = window.__kmapMap3D.getDiagnostics().tiles; return !!t && t.idle && t.targetMissing === 0; }, undefined, { timeout: 90000 }).catch(() => {});
  await delay(800);
  const probe = await page.evaluate(() => { window.__stopZoomProbe(); return { frames: window.__zoomProbe.frames, marks: window.__zoomProbe.marks ?? {} }; });
  out.frames = probe.frames; out.marks = probe.marks;
  out.timeline = await page.evaluate(() => window.__kmapMap3D.getTileTimeline());
  // 截图：回退场景下道路是否真正出现在画面上，比像素统计更直接。
  await page.screenshot({ path: join(root, 'docs', 'evidence', 'streaming-rebuild', `zoom-swap-${label}.png`) });
} catch (error) { out.errors.push(`probe-error: ${String(error).slice(0, 300)}`); }
await browser.close();
mkdirSync(join(root, 'docs', 'evidence', 'streaming-rebuild'), { recursive: true });
const file = join(root, 'docs', 'evidence', 'streaming-rebuild', `zoom-swap-${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
// 控制台打印关键区间：内容占比骤降、覆盖缺失与层级变化点。
const frames = out.frames;
const inks = frames.map(f => f.ink).sort((a, b) => a - b);
const median = inks[Math.floor(inks.length / 2)] ?? 0;
const dips = frames.filter(f => f.ink < median * .5);
const blank = frames.filter(f => f.uncovered > 0 || f.levels === '' || f.patches === 0);
const levelChanges = frames.filter((f, i) => i > 0 && f.levels !== frames[i - 1].levels);
/** 帧间局部骤降：同一分区内容占比在相邻帧的下降幅度，用于捕捉整块瓦片内容被清空。 */
function localDrop(list) {
  let maxDrop = 0, drops = 0, worst;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]?.cells ?? [], cur = list[i]?.cells ?? [];
    for (let c = 0; c < Math.min(prev.length, cur.length); c++) {
      const drop = prev[c] - cur[c];
      if (drop > maxDrop) { maxDrop = +drop.toFixed(3); worst = { at: list[i].at, cell: c, from: prev[c], to: cur[c], levels: list[i].levels, missing: list[i].missing, entries: list[i].entries }; }
      if (drop > .15) drops++;
    }
  }
  return { maxLocalDrop: maxDrop, localDrops: drops, worstDrop: worst };
}
const origin = frames[0]?.at ?? 0;
const timeline = (out.timeline ?? []).slice(0, 36).map(e => `${Math.round(e.at - origin)}:${e.type}:${e.key}`);
console.log(JSON.stringify({ file, frames: frames.length, timeline, inkMedian: median, inkMin: inks[0], inkMax: inks[inks.length - 1],
  dipFrames: dips.length,
  maxOrphan: Math.max(0, ...frames.map(f => f.orphan)), maxLineOrphan: Math.max(0, ...frames.map(f => f.lineOrphan)),
  maxGap: Math.max(0, ...frames.map(f => f.gap)), maxEvict: Math.max(0, ...frames.map(f => f.evict)),
  maxEntries: Math.max(0, ...frames.map(f => f.entries)), gapFrames: frames.filter(f => f.gap > 1).length,
  ...localDrop(frames),
  lineIssue: (() => {
    const hit = frames.filter(f => f.zeroSegments > 0 || f.missingLines > 0);
    const last = frames[frames.length - 1];
    return { frames: hit.length, first: hit[0] ? { at: hit[0].at, zero: hit[0].zeroSegments, missing: hit[0].missingLines, samples: hit[0].lineSamples, levels: hit[0].levels } : null,
      last: { zero: last?.zeroSegments ?? 0, missing: last?.missingLines ?? 0, samples: last?.lineSamples ?? [] } };
  })(),
  dips: dips.slice(0, 8).map(f => ({ at: f.at, zoom: f.zoom, levels: f.levels, orphan: f.orphan, lines: f.lines, lineOrphan: f.lineOrphan,
    active: f.active, queued: f.queued, uncovered: f.uncovered, ink: f.ink, entries: f.entries })),
  dipsLast: dips.slice(-3).map(f => ({ at: f.at, levels: f.levels, overview: f.overview, uncovered: f.uncovered, ink: f.ink })),
  blankFrames: blank.length,
  blank: blank.slice(0, 3).map(f => ({ at: f.at, levels: f.levels, overview: f.overview, uncovered: f.uncovered })),
  levelChangeCount: levelChanges.length, levelChanges: levelChanges.slice(0, 8), errors: out.errors }, null, 2));
