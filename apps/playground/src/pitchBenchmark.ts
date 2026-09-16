import type { Map3D, ViewState } from '@kmap/map3d';
import { captureRenderFrames, summarizeFrames } from './frameAcceptance.js';
import { createMapRecorder } from './recording.js';

/** 用户截图对应的三组相机视角，保存静态证据和连续缩放旋转的真实画面。 */
export const PITCH_CASES: readonly { name: string; view: ViewState }[] = [
  { name: 'regional-lod', view: { center: { lng: 110.135698, lat: 35.040858 }, zoom: 6.75, bearing: 271.3, pitch: 60 } },
  { name: 'city-lod', view: { center: { lng: 116.394653, lat: 39.905523 }, zoom: 14.5, bearing: 27, pitch: 60 } },
  { name: 'sea-grid', view: { center: { lng: 119.730918, lat: 35.190539 }, zoom: 7.75, bearing: 251.3, pitch: 60 } },
];

export async function runPitchBenchmark(map: Map3D, progress: (text: string) => void) {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const stream = canvas.captureStream(60), recorder = createMapRecorder(stream);
  const chunks: Blob[] = []; recorder.ondataavailable = event => chunks.push(event.data);
  const start = performance.now(); let stage = 'initial';
  const errorsBefore = map.getDiagnostics().tiles?.network.errors ?? 0;
  const rendered = captureRenderFrames(map, start, () => stage);
  const snapshots: { name: string; atMs: number; screenshot: string; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const samples: { atMs: number; stage: string; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const stages: { name: string; atMs: number }[] = [];
  const mark = (name: string) => { stage = name; stages.push({ name, atMs: performance.now() - start }); progress(`大倾角与海面验收：${name}`); };
  const next = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
  let lastSample = 0;
  const stopSample = map.observeFrames(() => {
    if (performance.now() - lastSample < 100) return;
    lastSample = performance.now(); samples.push({ atMs: lastSample - start, stage, diagnostics: map.getDiagnostics() });
  });
  recorder.start(1000);
  try {
    const cases = [...PITCH_CASES, ...[15, 16].map(zoom => ({ name: `city-z${zoom}`, view: { ...PITCH_CASES[1]!.view, zoom } }))];
    for (const item of cases) {
      mark(`${item.name}-load`); map.setView(item.view);
      const loading = performance.now();
      do { await next(); } while (performance.now() - loading < 500 ||
        ((map.getDiagnostics().tiles?.targetMissing || !map.getDiagnostics().tiles?.idle) && performance.now() - loading < 12000));
      mark(`${item.name}-settled`);
      await next(); snapshots.push({ name: item.name, atMs: performance.now() - start, screenshot: canvas.toDataURL('image/png'), diagnostics: map.getDiagnostics() });
      const stationary = performance.now(); while (performance.now() - stationary < 1500) await next();
      mark(`${item.name}-motion`); const movement = performance.now();
      while (performance.now() - movement < 6000) {
        const t = (await next() - movement) / 1000;
        map.setView({ ...item.view, zoom: item.view.zoom + .65 * Math.sin(t * Math.PI / 2), bearing: item.view.bearing + 15 * Math.sin(t), pitch: 57.5 + 2.5 * Math.cos(t) });
      }
    }
  } finally {
    rendered.stop(); stopSample();
    await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
    stream.getTracks().forEach(track => track.stop());
  }
  const moving = rendered.frames.filter(f => f.stage.endsWith('-motion'));
  const frameSummary = summarizeFrames(moving);
  const assertions = { webgpu: map.getBackend() === 'webgpu', coverage: moving.length > 0 && moving.every(f => f.uncovered === 0),
    stable160fps: frameSummary.minWindowFps >= 160, frameP95: frameSummary.p95 <= 6.25, frameP99: frameSummary.p99 <= 6.25,
    targets: rendered.frames.every(f => f.target <= 128),
    entries: rendered.frames.every(f => f.entries <= 256),
    cpu: rendered.frames.every(f => f.cpuBytes <= 256 * 1048576),
    gpu: rendered.frames.every(f => f.gpuBytes <= 256 * 1048576),
    settled: snapshots.every(s => s.diagnostics.tiles?.targetMissing === 0 && s.diagnostics.tiles.uncoveredCells === 0),
    errors: samples.every(s => s.diagnostics.tiles?.network.errors === errorsBefore) };
  const videoResponse = await fetch('/__kmap/video', { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
  if (!videoResponse.ok) throw new Error('大倾角录像保存失败');
  const video = await videoResponse.json() as { file: string };
  const result = { kind: 'pitch-semantic-grid', at: new Date().toISOString(), durationMs: performance.now() - start,
    viewport: map.getDiagnostics().viewport, backend: map.getBackend(), userAgent: navigator.userAgent, errorsBefore,
    stages, samples, snapshots, frameSummary, assertions, video: video.file, renderFrames: rendered.frames, covers: rendered.covers, visualReview: 'pending' };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('大倾角证据保存失败');
  const saved = await response.json() as { file: string };
  document.documentElement.dataset.kmapPitchBenchmark = JSON.stringify({ evidence: saved.file, assertions, frameSummary });
  progress(`大倾角证据已保存：${saved.file}`);
}
