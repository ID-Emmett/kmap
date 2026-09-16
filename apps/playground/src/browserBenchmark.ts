import type { Map3D, ViewState } from '@kmap/map3d';
import { CITIES, flyToCity } from './cityFlight.js';
import { captureRenderFrames, summarizeFrames } from './frameAcceptance.js';
import { createMapRecorder } from './recording.js';

/** 验收同时保留 60 FPS 视频、逐帧间隔、10Hz 图像与队列观测。 */
export async function runBrowserBenchmark(map: Map3D, progress: (message: string) => void, cancelled: () => boolean, recordVideo = true) {
  if (map.getBackend() !== 'webgpu') throw new Error('验收要求 WebGPU 后端。');
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const stream = recordVideo ? canvas.captureStream(60) : new MediaStream();
  const recorder = recordVideo ? createMapRecorder(stream) : undefined;
  const chunks: Blob[] = []; if (recorder) recorder.ondataavailable = event => chunks.push(event.data);
  const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
  const wait = async (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { if (cancelled()) throw new Error('验收已取消。'); await nextFrame(); } };
  const settle = async () => {
    // 视图需求在渲染循环中提交，静止判定覆盖一次调度周期及实际绘制。
    await wait(100);
    const end = performance.now() + 15000;
    while ((!map.getDiagnostics().tiles?.idle || map.getDiagnostics().tiles?.targetMissing) && performance.now() < end) await wait(100);
  };
  const start = performance.now();
  const visibility: { atMs: number; state: string }[] = [{ atMs: 0, state: document.visibilityState }];
  const visibilityChanged = () => visibility.push({ atMs: performance.now() - start, state: document.visibilityState });
  document.addEventListener('visibilitychange', visibilityChanged);
  const longFrames: unknown[] = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longFrames.push(entry.toJSON()); });
  observer.observe({ type: 'long-animation-frame', buffered: false });
  const visualFrames: { atMs: number; stage: string; view: ViewState; uncovered: number; missing: number }[] = [];
  const samples: { atMs: number; stage: string; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const intervals: { atMs: number; stage: string; ms: number }[] = [];
  let stage = 'initial'; let lastFrame = 0; let lastCapture = -Infinity; let recording = true; let frameHandle = 0;
  const rendered = captureRenderFrames(map, start, () => stage);
  const pixelAuditEnabled = recordVideo && new URLSearchParams(location.search).has('auditPixels');
  const pixelAudits: unknown[] = []; let lastPixelAudit = 0;
  const stopPixelAudit = map.observeFrames(() => {
    if (!pixelAuditEnabled || map.getView().zoom > 10 || performance.now() - lastPixelAudit < 100) return;
    lastPixelAudit = performance.now(); const defects = map.auditPixels();
    if (defects.length) pixelAudits.push({ atMs: lastPixelAudit - start, view: map.getView(), defects });
  });
  const capture = (now: number) => {
    if (!recording) return;
    if (lastFrame) intervals.push({ atMs: now - start, stage, ms: now - lastFrame }); lastFrame = now;
    if (now - lastCapture >= 100) {
      lastCapture = now; const diagnostics = map.getDiagnostics();
      visualFrames.push({ atMs: now - start, stage, view: map.getView(), uncovered: diagnostics.tiles?.uncoveredCells ?? 0, missing: diagnostics.tiles?.targetMissing ?? 0 });
      samples.push({ atMs: now - start, stage, diagnostics });
    }
    frameHandle = requestAnimationFrame(capture);
  };
  recorder?.start(1000); frameHandle = requestAnimationFrame(capture);
  const stages: { name: string; atMs: number; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const mark = (name: string) => { stage = name; progress(`连续视觉验收：${name}`); stages.push({ name, atMs: performance.now() - start, diagnostics: map.getDiagnostics() }); };
  try {
    map.setView(CITIES.beijing); await settle();
    mark('pan-zoom-rotate');
    const movement = performance.now();
    while (performance.now() - movement < 16000) {
      const t = (performance.now() - movement) / 1000;
      const future = (s: number): ViewState => ({ center: { lng: CITIES.beijing.center.lng + Math.sin(s * .4) * .028, lat: CITIES.beijing.center.lat + Math.sin(s * .25) * .012 }, zoom: 14.5 + Math.sin(s * .5) * 1.1, bearing: s * 12, pitch: 30 + 30 * Math.sin(s * .28) });
      map.setView(future(t)); await nextFrame(); if (cancelled()) throw new Error('验收已取消。');
    }
    mark('pitch-60'); map.setView({ ...CITIES.beijing, pitch: 60 }); await settle(); await wait(1500);
    mark('beijing-to-shanghai'); await flyToCity(map, CITIES.shanghai, 12000, cancelled);
    mark('shanghai-arrival'); await settle(); await wait(1500);
    mark('shanghai-to-beijing'); await flyToCity(map, CITIES.beijing, 12000, cancelled);
    mark('beijing-return'); await settle(); await wait(2500); await settle();
    mark('cache-A');
    map.setView({ center: { lng: CITIES.beijing.center.lng + .025, lat: CITIES.beijing.center.lat } }); await settle();
    mark('cache-B');
    map.setView(CITIES.beijing); await settle();
    mark('cache-A-return');
    for (const pitch of [0, 20, 40, 60]) { mark(`pitch-${pitch}-settled`); map.setView({ pitch }); await settle(); await wait(500); }
    mark('final'); map.setView(CITIES.beijing); await settle(); await wait(Math.max(2000, 60000 - (performance.now() - start)));
  } finally {
    rendered.stop(); stopPixelAudit(); recording = false; cancelAnimationFrame(frameHandle); observer.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged);
    if (recorder) await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
    stream.getTracks().forEach(track => track.stop());
  }
  const moving = rendered.frames.filter(f => ['pan-zoom-rotate', 'beijing-to-shanghai', 'shanghai-to-beijing'].includes(f.stage));
  const frameSummary = summarizeFrames(moving);
  const final = map.getDiagnostics();
  const motionSamples = samples.filter(s => ['pan-zoom-rotate', 'beijing-to-shanghai', 'shanghai-to-beijing'].includes(s.stage));
  const cacheA = stages.find(s => s.name === 'cache-A')!.diagnostics.tiles!;
  const cacheB = stages.find(s => s.name === 'cache-B')!.diagnostics.tiles!;
  const cacheReturn = stages.find(s => s.name === 'cache-A-return')!.diagnostics.tiles!;
  const assertions = {
    webgpu: map.getBackend() === 'webgpu', motionFrameP95: frameSummary.p95 <= 6.25, motionFrameP99: frameSummary.p99 <= 6.25,
    stable160fps: frameSummary.minWindowFps >= 160,
    renderedEveryRaf: rendered.frames.length >= intervals.length - 2,
    motionLongFrames: frameSummary.over33ms <= .01, no100msMotionStall: frameSummary.max < 100,
    finalCoverage: final.tiles?.targetMissing === 0 && final.tiles.uncoveredCells === 0,
    boundedRequests: samples.every(s => (s.diagnostics.tiles?.scheduler.active ?? 0) <= 12),
    boundedWorkers: samples.every(s => (s.diagnostics.workers?.active ?? 0) <= 4),
    entryBudget: samples.every(s => (s.diagnostics.tiles?.cache.entries ?? 0) <= (s.diagnostics.tiles?.cache.maxEntries ?? 0)),
    cpuBudget: samples.every(s => (s.diagnostics.tiles?.cache.cpuBytes ?? 0) <= (s.diagnostics.tiles?.cache.maxCpuBytes ?? 0)),
    gpuBudget: samples.every(s => (s.diagnostics.tiles?.resources.gpuBytes ?? 0) <= (s.diagnostics.tiles?.resources.maxGpuBytes ?? Infinity)),
    motionCoverage: moving.every(f => f.uncovered === 0),
    interactionCoverage: visualFrames.filter(f => f.stage !== 'initial').every(f => f.uncovered === 0),
    motionDetail: motionSamples.filter(s => (s.diagnostics.tiles?.displayZoomGap ?? Infinity) <= 2).length / Math.max(1, motionSamples.length) >= .95,
    noExtremeOverzoom: motionSamples.every(s => (s.diagnostics.tiles?.displayZoomGap ?? Infinity) <= 3),
    cityArrivalsReady: stages.filter(s => ['shanghai-arrival', 'beijing-return'].includes(s.name)).every(s => s.diagnostics.tiles?.targetMissing === 0 && s.diagnostics.tiles.uncoveredCells === 0),
    noNetworkErrors: final.tiles?.network.errors === 0,
    cacheRevisitHits: cacheReturn.cacheHits > cacheA.cacheHits,
    cacheRevisitNoFetch: cacheReturn.network.starts === cacheB.network.starts,
  };
  let video = { file: '' };
  if (recorder) {
    const response = await fetch('/__kmap/video', { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
    if (!response.ok) throw new Error('视频证据保存失败。');
    video = await response.json() as { file: string };
  }
  const result = { at: new Date().toISOString(), recordVideo, pixelAuditEnabled, backend: map.getBackend(), durationMs: performance.now() - start, frameSummary, renderFrames: rendered.frames, covers: rendered.covers, assertions, passed: Object.values(assertions).every(Boolean), video: video.file, visualReview: 'pending', visibility, stages, final, intervals, longFrames, samples, visualFrames, pixelAudits };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('视觉与时序证据保存失败。');
  const saved = await response.json() as { file: string };
  return { ...result, renderFrames: [], covers: [], samples: [], visualFrames: [], intervals: [], evidence: saved.file };
}
