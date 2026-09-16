import type { Map3D, ViewState } from '@kmap/map3d';
import { CITIES } from './cityFlight.js';
import { captureRenderFrames, summarizeFrames } from './frameAcceptance.js';
import { createMapRecorder } from './recording.js';

/** 首帧开始保留录像，重复快速缩放和平移以检查覆盖内容与线宽稳定性。 */
export async function runRapidBenchmark(map: Map3D, progress: (value: string) => void) {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const stream = canvas.captureStream(60);
  const recorder = createMapRecorder(stream);
  const chunks: Blob[] = []; recorder.ondataavailable = event => chunks.push(event.data);
  const start = performance.now(); let previous = start; let lastSample = -Infinity;
  const intervals: { atMs: number; stage: string; ms: number }[] = [];
  const samples: { atMs: number; stage: string; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const stages: { atMs: number; name: string; timeline: ReturnType<Map3D['getTileTimeline']> }[] = [];
  const longFrames: unknown[] = [];
  const observer = new PerformanceObserver(list => longFrames.push(...list.getEntries().map(entry => entry.toJSON())));
  observer.observe({ type: 'long-animation-frame', buffered: false });
  let lastStage = 'initial'; const rendered = captureRenderFrames(map, start, () => lastStage); recorder.start(1000);
  while (performance.now() - start < 26000) {
    const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    const elapsed = now - start;
    const stage = elapsed < 2500 ? 'initial' : elapsed < 14500 ? 'rapid-zoom' : elapsed < 23500 ? 'rapid-pan-pitch' : 'settled';
    if (stage !== lastStage) { stages.push({ atMs: elapsed, name: stage, timeline: map.getTileTimeline() }); lastStage = stage; progress(`瞬时画面验收：${stage}`); }
    intervals.push({ atMs: elapsed, stage, ms: now - previous }); previous = now;
    if (now - lastSample >= 100) { lastSample = now; samples.push({ atMs: elapsed, stage, diagnostics: map.getDiagnostics() }); }
    const t = (elapsed - 2500) / 1000;
    let view: ViewState | undefined;
    if (stage === 'rapid-zoom') view = { ...CITIES.beijing, zoom: 12.5 + 2.5 * Math.cos(t * Math.PI / 1.5), pitch: 48, bearing: t * 8 };
    if (stage === 'rapid-pan-pitch') {
      const s = (elapsed - 14500) / 1000;
      view = { center: { lng: CITIES.beijing.center.lng + Math.sin(s * 2) * .06, lat: CITIES.beijing.center.lat + Math.sin(s * 1.6) * .03 },
        zoom: 14.5 + Math.sin(s * 1.3) * .8, bearing: s * 35, pitch: [0, 60, 20, 40][Math.floor(s) % 4]! };
    }
    if (view) map.setView(view);
    if (stage === 'settled') map.setView(CITIES.beijing);
  }
  rendered.stop(); observer.disconnect();
  await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); }); stream.getTracks().forEach(track => track.stop());
  const moving = rendered.frames.filter(f => f.stage.startsWith('rapid'));
  const frameSummary = summarizeFrames(moving);
  const motion = samples.filter(s => s.stage.startsWith('rapid'));
  const assertions = { webgpu: map.getBackend() === 'webgpu', frameP95: frameSummary.p95 <= 6.25, frameP99: frameSummary.p99 <= 6.25,
    stable160fps: frameSummary.minWindowFps >= 160,
    longFrames: frameSummary.over33ms <= .01, no100msStall: frameSummary.max < 100,
    coverage: moving.every(s => s.uncovered === 0),
    motionDetail: motion.filter(s => (s.diagnostics.tiles?.displayZoomGap ?? Infinity) <= 2).length / Math.max(1, motion.length) >= .95,
    noExtremeOverzoom: motion.every(s => (s.diagnostics.tiles?.displayZoomGap ?? Infinity) <= 3),
    finalReady: map.getDiagnostics().tiles?.targetMissing === 0,
    entryBudget: samples.every(s => (s.diagnostics.tiles?.cache.entries ?? 0) <= (s.diagnostics.tiles?.cache.maxEntries ?? 0)),
    cpuBudget: samples.every(s => (s.diagnostics.tiles?.cache.cpuBytes ?? 0) <= (s.diagnostics.tiles?.cache.maxCpuBytes ?? 0)),
    boundedRequests: samples.every(s => (s.diagnostics.tiles?.scheduler.active ?? 0) <= 12),
    boundedWorkers: samples.every(s => (s.diagnostics.workers?.active ?? 0) <= 4),
    gpuBudget: samples.every(s => (s.diagnostics.tiles?.resources.gpuBytes ?? 0) <= (s.diagnostics.tiles?.resources.maxGpuBytes ?? 0)),
    noNetworkErrors: map.getDiagnostics().tiles?.network.errors === 0 };
  const videoResponse = await fetch('/__kmap/video', { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
  if (!videoResponse.ok) throw new Error('瞬时画面录像保存失败。');
  const video = await videoResponse.json() as { file: string };
  const result = { at: new Date().toISOString(), kind: 'startup-rapid', backend: map.getBackend(), video: video.file, videoMimeType: recorder.mimeType, stages, renderFrames: rendered.frames, covers: rendered.covers, intervals, samples, longFrames, frameSummary, assertions, passed: Object.values(assertions).every(Boolean), visualReview: 'pending' };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('瞬时画面时序保存失败。');
  const saved = await response.json() as { file: string };
  document.documentElement.dataset.kmapRapidBenchmark = JSON.stringify({ evidence: saved.file, frameSummary, assertions });
  progress(`首屏与快速交互记录已保存：${saved.file}`);
}
