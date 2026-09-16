import type { Map3D } from '@kmap/map3d';
import { createMapRecorder } from './recording.js';
import { captureRenderFrames, summarizeFrames } from './frameAcceptance.js';

/** 真实指针和滚轮测试保留完整录像与每帧相机状态。 */
export async function captureGestures(map: Map3D, progress: (text: string) => void, durationMs = 30000) {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const stream = canvas.captureStream(60);
  const recorder = createMapRecorder(stream);
  const chunks: Blob[] = []; recorder.ondataavailable = event => chunks.push(event.data);
  const frames: { atMs: number; interval: number; view: ReturnType<Map3D['getView']> }[] = [];
  const samples: { atMs: number; diagnostics: ReturnType<Map3D['getDiagnostics']> }[] = [];
  const start = performance.now(); let previous = start; let lastSample = -Infinity;
  const rendered = captureRenderFrames(map, start, () => 'trusted-gestures');
  const inputEvents: { type: string; trusted: boolean; atMs: number }[] = [];
  const input = (event: Event) => inputEvents.push({ type: event.type, trusted: event.isTrusted, atMs: performance.now() - start });
  for (const type of ['pointerdown', 'pointerup', 'wheel']) canvas.addEventListener(type, input, { passive: true });
  const longFrames: unknown[] = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longFrames.push(entry.toJSON()); });
  observer.observe({ type: 'long-animation-frame', buffered: false });
  recorder.start(1000); progress('手势录像中：拖动、滚轮、旋转和倾斜 · 30 秒');
  while (performance.now() - start < durationMs) {
    const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    frames.push({ atMs: now - start, interval: now - previous, view: map.getView() }); previous = now;
    if (now - lastSample >= 100) { lastSample = now; samples.push({ atMs: now - start, diagnostics: map.getDiagnostics() }); }
  }
  observer.disconnect(); rendered.stop();
  for (const type of ['pointerdown', 'pointerup', 'wheel']) canvas.removeEventListener(type, input);
  await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); }); stream.getTracks().forEach(track => track.stop());
  const videoResponse = await fetch('/__kmap/video', { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
  if (!videoResponse.ok) throw new Error('手势录像保存失败。');
  const video = await videoResponse.json() as { file: string };
  const frameSummary = summarizeFrames(rendered.frames);
  const result = { at: new Date().toISOString(), kind: 'trusted-pointer-wheel', backend: map.getBackend(), durationMs, video: video.file, frames, samples, longFrames,
    renderFrames: rendered.frames, covers: rendered.covers, frameSummary, inputEvents,
    assertions: { webgpu: map.getBackend() === 'webgpu', coverage: rendered.frames.every(f => f.uncovered === 0),
      stable160fps: frameSummary.minWindowFps >= 160, frameP99: frameSummary.p99 <= 6.25,
      realPan: inputEvents.some(e => e.type === 'pointerdown' && e.trusted), realZoom: inputEvents.some(e => e.type === 'wheel' && e.trusted) } };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('手势时序保存失败。');
  const saved = await response.json() as { file: string }; progress(`手势录像已保存：${saved.file}`);
  return saved;
}
