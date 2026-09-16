import type { Map3D, ViewState } from '@kmap/map3d';

/** 前台真实渲染帧采样；截图回读在计时区间外执行。 */
export async function runRefinementBenchmark(map: Map3D, status: (text: string) => void): Promise<void> {
  const base = { center: { lng: 116.394653, lat: 39.90552 }, bearing: 0, pitch: 0 };
  const views = [0, 2, 4, 4.5, 5, 5.5, 6, 8, 10, 12, 13, 14, 15, 17].map(zoom => ({ name: `z${zoom}`, view: { ...base, zoom } }));
  views.push({ name: 'pitch60', view: { ...base, zoom: 15.9, pitch: 60, bearing: 30 } },
    { name: 'pitch75', view: { ...base, zoom: 16.5, pitch: 75, bearing: 45 } },
    { name: 'dateline', view: { ...base, zoom: 0, center: { lng: 179, lat: -20 } } },
    { name: 'north', view: { ...base, zoom: 0, center: { lng: 0, lat: 80 } } });
  const results: unknown[] = [], visualFrames: { image: string; atMs: number }[] = [], errors: unknown[] = [];
  const started = performance.now(), unsubscribe = map.on('error', error => errors.push(error));
  const next = () => new Promise<void>(resolve => { const stop = map.observeFrames(() => { stop(); resolve(); }); });
  const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0;
  try {
    for (const { name, view } of views) {
      status(`地图优化验证：${map.getBackend()} ${name}`); map.setView(view);
      let settled = 0; const begin = performance.now();
      while (performance.now() - begin < 25000 && settled < 20) {
        await next(); const d = map.getDiagnostics();
        settled = d.tiles?.targetMissing === 0 && d.tiles.uncoveredCells === 0 && d.labels?.pendingRanges === 0 ? settled + 1 : 0;
      }
      const frames: ReturnType<Map3D['getFrameState']>[] = [], counts: number[] = [];
      const sample = performance.now();
      while (performance.now() - sample < 3000) {
        const t = (performance.now() - sample) / 3000, oscillation = Math.sin(t * Math.PI * 2);
        map.setView({ ...view, zoom: Math.max(0, view.zoom + oscillation * .12), bearing: view.bearing + oscillation * 6,
          center: { ...view.center, lng: view.center.lng + oscillation * 360 / 2 ** view.zoom * .025 } });
        await next(); frames.push(map.getFrameState()); if (frames.length % 15 === 0) counts.push(map.getDiagnostics().labels?.placed ?? 0);
      }
      map.setView(view as ViewState); await next();
      const d = map.getDiagnostics();
      visualFrames.push({ image: document.querySelector<HTMLCanvasElement>('#map-canvas')!.toDataURL('image/jpeg', .92), atMs: performance.now() - started });
      results.push({ name, view, settled: settled >= 20, frames, labels: d.labels, minLabels: Math.min(...counts), maxLabels: Math.max(...counts),
        motion: { fps: 1000 / (frames.reduce((n, f) => n + f.ms, 0) / frames.length), intervalP95: quantile(frames.map(f => f.ms), .95),
          cpuP95: quantile(frames.map(f => f.cpuMs), .95), cpuP99: quantile(frames.map(f => f.cpuMs), .99),
          uncovered: frames.filter(f => f.uncovered > 0).length }, render: d.render, tiles: d.tiles, memory: d.memory });
    }
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'map-refinement', backend: map.getBackend(), at: new Date().toISOString(), viewport: map.getDiagnostics().viewport,
      visibility: document.visibilityState, results, errors, visualFrames,
    }) });
    const saved = await response.json() as { file: string };
    document.documentElement.dataset.kmapRefinement = saved.file; status(`优化验证证据：${saved.file}`);
  } finally { unsubscribe(); map.setView({ ...base, zoom: 15 }); }
}
