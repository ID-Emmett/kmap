import type { Map3D, ViewState } from '@kmap/map3d';
import { CITIES } from './cityFlight.js';

interface SmoothnessFrame {
  id: number; atMs: number; stage: string; ms: number; cpuMs: number; engineMs: number; labelMs: number; renderMs: number;
  phases: ReturnType<Map3D['getFrameState']>['phases']; uploadPhases: ReturnType<Map3D['getFrameState']>['uploadPhases'];
  revision: number; uncovered: number; missing: number; fetching: number; cpuBytes: number; gpuBytes: number;
}

/** 逐帧采样主线程分阶段耗时、帧间隔与浏览器长任务，用于定位 pan/zoom 抖动来源。 */
export async function runSmoothnessBenchmark(map: Map3D, progress: (text: string) => void, durationMs = 24000) {
  if (map.getBackend() !== 'webgpu') throw new Error('流畅度探针要求 WebGPU 后端。');
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
  const start = performance.now();
  const frames: SmoothnessFrame[] = [];
  const wheelEvents: { atMs: number; deltaY: number }[] = [];
  const longFrames: unknown[] = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longFrames.push(entry.toJSON()); });
  observer.observe({ type: 'long-animation-frame', buffered: false });
  let stage = 'initial';
  const stop = map.observeFrames(() => {
    const f = map.getFrameState();
    frames.push({ id: f.id, atMs: f.at - start, stage, ms: f.ms, cpuMs: f.cpuMs, engineMs: f.engineMs, labelMs: f.labelMs, renderMs: f.renderMs,
      phases: { ...f.phases }, uploadPhases: { ...f.uploadPhases }, revision: f.revision, uncovered: f.uncovered, missing: f.missing,
      fetching: f.fetching, cpuBytes: f.cpuBytes, gpuBytes: f.gpuBytes });
  });
  const settle = async () => {
    const end = performance.now() + 15000;
    while (!map.getDiagnostics().tiles?.idle && performance.now() < end) await nextFrame();
  };
  const wheel = async (count: number, deltaY: number, gapMs = 16) => {
    const rect = canvas.getBoundingClientRect(); const clientX = rect.left + rect.width / 2; const clientY = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      wheelEvents.push({ atMs: performance.now() - start, deltaY });
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, clientX, clientY, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, gapMs));
    }
  };
  const motion = (t: number): ViewState => ({
    center: { lng: CITIES.beijing.center.lng + Math.sin(t * .35) * .035, lat: CITIES.beijing.center.lat + Math.sin(t * .22) * .016 },
    zoom: 14.6 + Math.sin(t * .45) * 1.2, bearing: t * 14, pitch: 34 + 26 * Math.sin(t * .3),
  });
  try {
    map.setView(CITIES.beijing); await settle();
    stage = 'static'; progress('流畅度探针：静止基线'); await new Promise(resolve => setTimeout(resolve, 1500));
    stage = 'pan-zoom-rotate';
    progress('流畅度探针：连续 pan/zoom/rotate');
    const movementStart = performance.now();
    while (performance.now() - movementStart < Math.max(6000, durationMs * .5)) { map.setView(motion((performance.now() - movementStart) / 1000)); await nextFrame(); }
    stage = 'wheel-burst'; progress('流畅度探针：连续滚轮缩放');
    await wheel(48, -120);
    stage = 'wheel-burst-out'; await wheel(32, 160);
    stage = 'settle'; progress('流畅度探针：收敛'); await settle(); await new Promise(resolve => setTimeout(resolve, 1500));
  } finally {
    stop(); observer.disconnect();
  }
  const summary = { ...summarize(frames), longTaskCount: longFrames.length };
  const result = { at: new Date().toISOString(), kind: 'smoothness-trace', backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
    durationMs: performance.now() - start, summary, frames, longFrames, wheelEvents,
    assertions: { webgpu: map.getBackend() === 'webgpu', motionP99: summary.stages['pan-zoom-rotate']!.p99 <= 6.25,
      motionMax: summary.stages['pan-zoom-rotate']!.max <= 12, wheelP99: summary.stages['wheel-burst']!.p99 <= 6.25,
      longFrames: summary.longTaskCount === 0, coverage: frames.every(f => f.uncovered === 0) } };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('流畅度证据保存失败。');
  const saved = await response.json() as { file: string };
  document.documentElement.dataset.kmapSmoothness = JSON.stringify({ evidence: saved.file, summary });
  progress(`流畅度证据已保存：${saved.file}`);
  return saved;
}

function summarize(frames: readonly SmoothnessFrame[]) {
  const stages: Record<string, StageStats> = {};
  for (const stage of [...new Set(frames.map(f => f.stage))]) {
    const items = frames.filter(f => f.stage === stage);
    const values = items.map(f => f.ms).filter(ms => ms > 0);
    stages[stage] = {
      frames: items.length, fps: 1000 / Math.max(1e-6, values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
      p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: Math.max(0, ...values),
      over625: countAbove(values, 6.25), over10: countAbove(values, 10), over167: countAbove(values, 16.7), over33: countAbove(values, 33.4),
      cpuP95: percentile(items.map(f => f.cpuMs), .95), cpuMax: Math.max(0, ...items.map(f => f.cpuMs)),
      engineP95: percentile(items.map(f => f.engineMs), .95), labelP95: percentile(items.map(f => f.labelMs), .95),
      renderP95: percentile(items.map(f => f.renderMs), .95),
      phaseMax: { plan: maxOf(items.map(f => f.phases.plan)), demand: maxOf(items.map(f => f.phases.demand)), commit: maxOf(items.map(f => f.phases.commit)),
        surfaces: maxOf(items.map(f => f.phases.surfaces)), upload: maxOf(items.map(f => f.phases.upload)), pump: maxOf(items.map(f => f.phases.pump)), recycle: maxOf(items.map(f => f.phases.recycle)) },
      phaseP95: { plan: percentile(items.map(f => f.phases.plan), .95), demand: percentile(items.map(f => f.phases.demand), .95),
        commit: percentile(items.map(f => f.phases.commit), .95), surfaces: percentile(items.map(f => f.phases.surfaces), .95),
        upload: percentile(items.map(f => f.phases.upload), .95), pump: percentile(items.map(f => f.phases.pump), .95), recycle: percentile(items.map(f => f.phases.recycle), .95) },
      uploadCreateMax: maxOf(items.map(f => f.uploadPhases.create)), uploadCompileMax: maxOf(items.map(f => f.uploadPhases.compile)),
    };
  }
  const all = frames.map(f => f.ms).filter(ms => ms > 0);
  return { totalFrames: frames.length, fps: 1000 / Math.max(1e-6, all.reduce((a, b) => a + b, 0) / Math.max(1, all.length)),
    p95: percentile(all, .95), p99: percentile(all, .99), max: Math.max(0, ...all), stages };
}

interface StageStats {
  frames: number; fps: number; p50: number; p95: number; p99: number; max: number;
  over625: number; over10: number; over167: number; over33: number;
  cpuP95: number; cpuMax: number; engineP95: number; labelP95: number; renderP95: number;
  phaseMax: Record<string, number>; phaseP95: Record<string, number>; uploadCreateMax: number; uploadCompileMax: number;
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
}

function countAbove(values: readonly number[], limit: number): number { return values.filter(value => value > limit).length; }
function maxOf(values: readonly number[]): number { return values.length ? Math.max(...values) : 0; }
