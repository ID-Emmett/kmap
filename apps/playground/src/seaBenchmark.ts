import type { Map3D } from '@kmap/map3d';
import { captureRenderFrames } from './frameAcceptance.js';
import { createMapRecorder } from './recording.js';

/** 黄海边界的短路径专项复现，像素回读包含真实纹理和屏幕结果。 */
export async function runSeaBenchmark(map: Map3D, progress: (text: string) => void) {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const view = { center: { lng: 118.4, lat: 36.6 }, zoom: 8.3, bearing: 0, pitch: 31 };
  map.setView(view); map.prefetchViews([{ ...view, zoom: 6, pitch: 0 }], { ttlMs: 12000, limit: 8 });
  const stream = canvas.captureStream(60); const recorder = createMapRecorder(stream);
  const chunks: Blob[] = []; recorder.ondataavailable = event => chunks.push(event.data);
  const start = performance.now(); let previous = 0;
  const audits: { atMs: number; defects: ReturnType<Map3D['auditPixels']> }[] = [];
  const rendered = captureRenderFrames(map, start, () => 'sea-pixels');
  const stop = map.observeFrames(() => {
    if (performance.now() - previous < 100) return;
    previous = performance.now(); const defects = map.auditPixels();
    audits.push({ atMs: previous - start, defects });
  });
  recorder.start(1000); progress('黄海边界像素核验');
  while (performance.now() - start < 10000) {
    const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    const t = Math.max(0, (now - start - 2000) / 1000);
    map.setView({ ...view, center: { lng: 118.4 + Math.sin(t * 2) * .8, lat: 36.6 + Math.sin(t * 2) * 1.4 }, zoom: 8.3 + Math.sin(t) * .25 });
  }
  stop(); rendered.stop();
  await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
  stream.getTracks().forEach(track => track.stop());
  const videoResponse = await fetch('/__kmap/video', { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
  const video = await videoResponse.json() as { file: string };
  const result = { kind: 'sea-pixel-audit', at: new Date().toISOString(), durationMs: 10000, video: video.file,
    renderFrames: rendered.frames, covers: rendered.covers, audits,
    blankSamples: audits.reduce((n, a) => n + a.defects.filter(d => d.actual.join(',') === '245,245,242').length, 0) };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  const saved = await response.json() as { file: string };
  document.documentElement.dataset.kmapSeaBenchmark = JSON.stringify({ evidence: saved.file, blankSamples: result.blankSamples, video: result.video, frames: rendered.frames.length });
  progress(`黄海边界记录已保存：${saved.file}`);
}
