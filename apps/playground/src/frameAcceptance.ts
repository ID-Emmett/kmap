import type { Map3D } from '@kmap/map3d';
export type RenderFrame = ReturnType<Map3D['getFrameState']> & { atMs: number; stage: string };

/** 每个样本对应 SDK 一次真实 render 调用，原始帧与区域版本随证据保存。 */
export function captureRenderFrames(map: Map3D, start: number, stage: () => string) {
  const frames: RenderFrame[] = [];
  const covers: { revision: number; frameId: number; patches: ReturnType<Map3D['getTileSnapshot']>['patches'] }[] = [];
  let revision = -1;
  const stop = map.observeFrames(() => {
    const f = map.getFrameState(); frames.push({ ...f, atMs: f.at - start, stage: stage() });
    if (f.revision !== revision) { revision = f.revision; covers.push({ revision, frameId: f.id, patches: map.getTileSnapshot().patches }); }
  });
  return { frames, covers, stop };
}
export function summarizeFrames(frames: readonly RenderFrame[]) {
  const values = frames.map(f => f.ms).filter(ms => ms > 0).sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.ceil(values.length * p) - 1] ?? Infinity;
  const windows: { stage: string; endMs: number; fps: number; frames: number; elapsedMs: number }[] = [];
  let stage = ''; let elapsed = 0; let count = 0;
  for (const f of frames) {
    if (f.stage !== stage) { stage = f.stage; elapsed = 0; count = 0; }
    elapsed += f.ms; count++;
    if (elapsed >= 1000) { windows.push({ stage, endMs: f.atMs, fps: count * 1000 / elapsed, frames: count, elapsedMs: elapsed }); elapsed = 0; count = 0; }
  }
  return { count: values.length, p95: percentile(.95), p99: percentile(.99), max: Math.max(0, ...values),
    over33ms: values.filter(ms => ms > 33.34).length / Math.max(1, values.length),
    minWindowFps: windows.length ? Math.min(...windows.map(w => w.fps)) : 0, windows };
}
