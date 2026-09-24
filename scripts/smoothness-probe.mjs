/**
 * 真实输入流畅度探针：用 CDP 真实指针/滚轮事件驱动 Kmap Playground，
 * 逐帧采集帧间隔、主线程分阶段耗时与浏览器长任务，输出可比较的 JSON 报告。
 *
 * 用法：
 *   node scripts/smoothness-probe.mjs --url http://127.0.0.1:6661/ --label baseline
 *   node scripts/smoothness-probe.mjs --url http://127.0.0.1:6661/ --label after --unthrottled
 *
 * playwright-core 不在项目依赖内，按以下顺序解析：PLAYWRIGHT_CORE_PATH 环境变量、
 * 工作区 node_modules、npx 缓存目录。缺失时脚本给出显式错误而不静默降级。
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) { args.set(key, 'true'); } else { args.set(key, next); i++; }
}
const url = args.get('url') ?? 'http://127.0.0.1:6661/';
const label = args.get('label') ?? 'probe';
const unthrottled = args.has('unthrottled');
const output = args.get('out') ?? join(root, 'docs', 'evidence', 'streaming-rebuild', `smoothness-${label}.json`);

const playwright = await loadPlaywright();
const launchArgs = ['--disable-blink-features=AutomationControlled'];
if (unthrottled) launchArgs.push('--disable-frame-rate-limit', '--disable-gpu-vsync');

const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true, args: launchArgs });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
page.on('pageerror', error => consoleErrors.push(`pageerror:${String(error).slice(0, 300)}`));
await page.addInitScript(traceScript);

const report = { at: new Date().toISOString(), label, url, unthrottled, backend: 'unknown', viewport: null, stages: {}, longTasks: [], consoleErrors: [], failures: [] };

try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  report.backend = await page.evaluate(() => window.__kmapMap3D.getBackend());
  report.viewport = await page.evaluate(() => window.__kmapMap3D.getDiagnostics().viewport);
  await settle(page);
  await page.evaluate(() => window.startTrace());

  // 真实拖拽平移：每次 move 内部插值 12 步，指针事件密度高于刷新率。
  const center = { x: 800, y: 450 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let i = 0; i < 45; i++) {
    const t = i / 45; const x = center.x + Math.sin(t * Math.PI * 2) * 260; const y = center.y + Math.cos(t * Math.PI * 1.5) * 120;
    await page.mouse.move(x, y, { steps: 12 });
    await delay(10);
  }
  await page.mouse.up();
  await delay(1800);
  report.stages['real-drag-inertia'] = await page.evaluate(() => window.sliceTrace('real-drag-inertia'));

  // 真实滚轮缩放：连续滚轮事件驱动惯性缩放通道。
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -110); await delay(16); }
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, 130); await delay(16); }
  await delay(1200);
  report.stages['real-wheel-zoom'] = await page.evaluate(() => window.sliceTrace('real-wheel-zoom'));

  // 真实旋转与倾斜：Shift+拖拽进入 rotate 通道。
  await page.keyboard.down('Shift');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) { await page.mouse.move(center.x + i * 9, center.y - i * 4, { steps: 6 }); await delay(10); }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await delay(1200);
  report.stages['real-rotate'] = await page.evaluate(() => window.sliceTrace('real-rotate'));

    // 视觉抽样：确认池化几何没有残留上一位瓦片的数据。
  if (args.has('shot')) {
    const shotDir = join(root, 'docs', 'evidence', 'streaming-rebuild');
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, `smoothness-${label}-rotate.png`) });
    await page.evaluate(() => { const map = window.__kmapMap3D; map.setView({ center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15.8, bearing: 0, pitch: 55 }); });
    await delay(3000);
    await page.screenshot({ path: join(shotDir, `smoothness-${label}-fixture.png`) });
  }
  report.longTasks = await page.evaluate(() => window.stopTrace());
  const diagnostics = await page.evaluate(() => {
    const d = window.__kmapMap3D.getDiagnostics();
    return { frame: d.frame, workers: d.workers, render: d.render, labels: d.labels, tiles: d.tiles };
  });
  report.diagnostics = { frame: diagnostics.frame, workers: diagnostics.workers, render: diagnostics.render, labels: diagnostics.labels,
    scheduler: diagnostics.tiles?.scheduler, network: diagnostics.tiles?.network, cache: diagnostics.tiles?.cache, resources: diagnostics.tiles?.resources,
    coverage: { uncovered: diagnostics.tiles?.uncoveredCells, missing: diagnostics.tiles?.targetMissing } };
  for (const [stage, stats] of Object.entries(report.stages)) {
    if (!stats || !stats.count) { report.failures.push(`${stage}: 无帧样本`); continue; }
    if (stats.over167 > 0) report.failures.push(`${stage}: ${stats.over167} 帧超过 16.7ms`);
    if (stats.over33 > 0) report.failures.push(`${stage}: ${stats.over33} 帧超过 33.4ms`);
  }
  if (report.longTasks.length) report.failures.push(`long tasks: ${report.longTasks.length}`);
  if (report.backend !== 'webgpu') report.failures.push(`后端为 ${report.backend}`);
  if (diagnostics.tiles?.network.errors) report.failures.push(`网络错误 ${diagnostics.tiles.network.errors}`);
  if (diagnostics.tiles?.uncoveredCells) report.failures.push(`覆盖缺口 ${diagnostics.tiles.uncoveredCells}`);
} catch (error) {
  report.failures.push(`probe-error: ${String(error).slice(0, 400)}`);
} finally {
  report.consoleErrors = consoleErrors.slice(0, 20);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ output, label, backend: report.backend, unthrottled, stages: report.stages, longTasks: report.longTasks.length, consoleErrors: report.consoleErrors.length, failures: report.failures }, null, 2));
  await browser.close();
}

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE_PATH) candidates.push(process.env.PLAYWRIGHT_CORE_PATH);
  candidates.push(join(root, 'node_modules', 'playwright-core'));
  const npx = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  if (existsSync(npx)) for (const entry of readdirSync(npx)) candidates.push(join(npx, entry, 'node_modules', 'playwright-core'));
  for (const candidate of candidates) {
    const file = join(candidate, 'index.mjs');
    if (existsSync(file)) return import(new URL(`file://${file.replace(/\\/g, '/')}`).href);
  }
  throw new Error('未找到 playwright-core；请设置 PLAYWRIGHT_CORE_PATH 或安装 @playwright/cli。');
}

/** 等待瓦片队列收敛，避免把冷加载并入交互测量。 */
async function settle(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__kmapMap3D.getDiagnostics().tiles?.idle === true)) return;
    await delay(200);
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** 注入逐帧探针；阶段切片共享同一测量口径。 */
function traceScript() {
  // 记录 WebGPU 设备侧对象创建次数与耗时：管线创建是排查交互期掉帧的关键证据。
  const counters = window.__kmapGpu = { shaderModules: 0, shaderMs: 0, shaderMaxMs: 0, pipelines: 0, pipelineMs: 0, pipelineMaxMs: 0,
    buffers: 0, bufferMs: 0, textures: 0, textureMs: 0, slowOps: [] };
  if (typeof GPUDevice !== 'undefined') {
    const patch = (name, key, msKey, maxKey) => {
      const original = GPUDevice.prototype[name]; if (typeof original !== 'function') return;
      GPUDevice.prototype[name] = function (...parameters) {
        const start = performance.now(); const result = original.apply(this, parameters); const cost = performance.now() - start;
        counters[key]++; counters[msKey] += cost; if (maxKey) counters[maxKey] = Math.max(counters[maxKey] ?? 0, cost);
        if (cost >= 2) counters.slowOps.push({ op: name, ms: cost, atMs: performance.now() });
        return result;
      };
    };
    patch('createShaderModule', 'shaderModules', 'shaderMs', 'shaderMaxMs');
    patch('createRenderPipeline', 'pipelines', 'pipelineMs', 'pipelineMaxMs');
    patch('createBuffer', 'buffers', 'bufferMs');
    patch('createTexture', 'textures', 'textureMs');
  }
  window.startTrace = () => {
    const map = window.__kmapMap3D;
    const trace = { start: performance.now(), frames: [], sliceAt: 0, longTasks: [] };
    window.__kmapTrace = trace;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) trace.longTasks.push({ atMs: performance.now() - trace.start, duration: entry.duration,
        blockingDuration: entry.blockingDuration, renderStart: entry.renderStart, styleAndLayoutStart: entry.styleAndLayoutStart,
        firstUIEventTimestamp: entry.firstUIEventTimestamp,
        scripts: (entry.scripts ?? []).map(s => ({ name: s.name, duration: s.duration, invoker: s.invoker, sourceURL: s.sourceURL,
          sourceFunctionName: s.sourceFunctionName, pauseDuration: s.pauseDuration, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })).slice(0, 12) });
    });
    observer.observe({ type: 'long-animation-frame', buffered: false });
    window.__kmapTraceObserver = observer;
    const renderer = map.getRenderer(); let lastBuffers = window.__kmapGpu?.buffers ?? 0; let lastTextures = window.__kmapGpu?.textures ?? 0;
    window.__kmapTraceStop = map.observeFrames(() => {
      const f = map.getFrameState();
      // 每帧同时记录 GPU 对象增量与绘制调用，用于把长帧归因到分配或绘制负载。
      const gpu = window.__kmapGpu ?? { buffers: 0, textures: 0 };
      const bufferDelta = gpu.buffers - lastBuffers, textureDelta = gpu.textures - lastTextures; lastBuffers = gpu.buffers; lastTextures = gpu.textures;
      trace.frames.push({ atMs: f.at - trace.start, ms: f.ms, cpu: f.cpuMs, engine: f.engineMs, label: f.labelMs, render: f.renderMs,
        plan: f.phases.plan, demand: f.phases.demand, commit: f.phases.commit, surfaces: f.phases.surfaces, upload: f.phases.upload, pump: f.phases.pump,
        create: f.uploadPhases.create, compile: f.uploadPhases.compile, uncovered: f.uncovered, missing: f.missing, fetching: f.fetching, entries: f.entries,
        sources: f.sources, bufferDelta, textureDelta, draws: renderer.info?.render?.drawCalls ?? 0, triangles: renderer.info?.render?.triangles ?? 0 });
    });
  };
  window.sliceTrace = (stage) => {
    const trace = window.__kmapTrace; const from = trace.sliceAt; trace.sliceAt = trace.frames.length;
    const gpu = window.__kmapGpu; const gpuSlice = { shaderModules: gpu.shaderModules - (trace.gpuAt?.shaderModules ?? 0), shaderMs: gpu.shaderMs - (trace.gpuAt?.shaderMs ?? 0),
      pipelines: gpu.pipelines - (trace.gpuAt?.pipelines ?? 0), pipelineMs: gpu.pipelineMs - (trace.gpuAt?.pipelineMs ?? 0),
      buffers: gpu.buffers - (trace.gpuAt?.buffers ?? 0), textures: gpu.textures - (trace.gpuAt?.textures ?? 0),
      shaderMaxMs: gpu.shaderMaxMs, pipelineMaxMs: gpu.pipelineMaxMs, slowOps: gpu.slowOps.slice(-12) };
    trace.gpuAt = { shaderModules: gpu.shaderModules, shaderMs: gpu.shaderMs, pipelines: gpu.pipelines, pipelineMs: gpu.pipelineMs, buffers: gpu.buffers, textures: gpu.textures };
    const frames = trace.frames.slice(from).filter(frame => frame.ms > 0);
    const values = frames.map(frame => frame.ms).sort((a, b) => a - b);
    const percentile = (list, p) => { const sorted = list.slice().sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] : 0; };
    const max = key => frames.reduce((best, frame) => Math.max(best, frame[key]), 0);
    return { stage, gpu: gpuSlice, count: frames.length, fps: 1000 / Math.max(1e-6, values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
      p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: values.at(-1) ?? 0,
      over100: values.filter(v => v > 10).length, over167: values.filter(v => v > 16.7).length, over33: values.filter(v => v > 33.4).length,
      cpuP95: percentile(frames.map(f => f.cpu), .95), cpuMax: max('cpu'), engineP95: percentile(frames.map(f => f.engine), .95), engineMax: max('engine'),
      labelP95: percentile(frames.map(f => f.label), .95), labelMax: max('label'), renderP95: percentile(frames.map(f => f.render), .95),
      draws: { p50: percentile(frames.map(f => f.draws), .5), max: max('draws'), maxSources: max('sources') },
      bufferDelta: { total: frames.reduce((sum, frame) => sum + frame.bufferDelta, 0), max: max('bufferDelta') },
      spill: frames.filter(frame => frame.ms > 16.7).map(frame => ({ atMs: Math.round(frame.atMs), ms: +frame.ms.toFixed(1), cpu: +frame.cpu.toFixed(1), engine: +frame.engine.toFixed(1), label: +frame.label.toFixed(1), render: +frame.render.toFixed(1), draws: frame.draws, sources: frame.sources, bufferDelta: frame.bufferDelta, textureDelta: frame.textureDelta, compile: +frame.compile.toFixed(1), upload: +frame.upload.toFixed(1), commit: +frame.commit.toFixed(1) })),
      phaseMax: { plan: max('plan'), demand: max('demand'), commit: max('commit'), surfaces: max('surfaces'), upload: max('upload'), pump: max('pump'), create: max('create'), compile: max('compile') },
      phaseP95: { plan: percentile(frames.map(f => f.plan), .95), commit: percentile(frames.map(f => f.commit), .95), upload: percentile(frames.map(f => f.upload), .95), label: percentile(frames.map(f => f.label), .95) },
      uncovered: frames.reduce((best, frame) => Math.max(best, frame.uncovered), 0) };
  };
  window.stopTrace = () => { window.__kmapTraceStop?.(); window.__kmapTraceObserver?.disconnect(); return window.__kmapTrace.longTasks; };
}
