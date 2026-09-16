import type { Map3D } from '@kmap/map3d';

/** 暂停地图提交，独立记录当前浏览器 RAF 节奏作为环境对照。 */
export async function measureRafBaseline(map: Map3D, progress: (text: string) => void) {
  map.stop(); progress('浏览器刷新基线采样中（地图提交暂停 5 秒）');
  const frames: number[] = []; let last = 0; const start = performance.now();
  try {
    while (performance.now() - start < 5000) {
      const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
      if (last) frames.push(now - last); last = now;
    }
  } finally { map.start(); }
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const result = { kind: 'browser-raf-baseline', at: new Date().toISOString(), viewport: map.getDiagnostics().viewport,
    visibility: document.visibilityState, fps: 1000 / mean, p95: sorted[Math.ceil(sorted.length * .95) - 1], p99: sorted[Math.ceil(sorted.length * .99) - 1], frames };
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!response.ok) throw new Error('刷新基线保存失败');
  const saved = await response.json() as { file: string };
  document.documentElement.dataset.kmapBaseline = JSON.stringify({ ...result, frames: [], evidence: saved.file });
  progress(`浏览器刷新基线 ${result.fps.toFixed(1)} fps · 地图提交已恢复`);
}
