import type { Map3D, ViewState } from '@kmap/map3d';
import { THEMES, type ThemeId } from './themes.js';

/** 真实浏览器逐帧矩阵：稳定画面、连续交互、样式切换和独立视觉采样。 */
export async function runAppearanceBenchmark(map: Map3D): Promise<void> {
  const base: ViewState = { center: { lng: 116.394653, lat: 39.90552 }, zoom: 15, pitch: 0, bearing: 0 };
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!, status = document.querySelector('#benchmark-status')!;
  const errors: unknown[] = [], stopErrors = map.on('error', error => errors.push(error));
  const results: unknown[] = [], visualFrames: { image: string; atMs: number; name: string }[] = [];
  const start = performance.now();
  const preview = document.createElement('canvas'); preview.width = Math.min(1280, canvas.width); preview.height = Math.round(canvas.height * preview.width / canvas.width);
  const context = preview.getContext('2d')!;
  const next = () => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
  const settle = async () => {
    let stable = 0; const start = performance.now();
    while (performance.now() - start < 25000 && stable < 12) {
      await next(); const d = map.getDiagnostics();
      stable = d.tiles?.targetMissing === 0 && d.tiles.uncoveredCells === 0 && d.tiles.target > 0 && d.labels?.pendingRanges === 0 ? stable + 1 : 0;
    }
    return stable >= 12;
  };
  const capture = (name: string) => { context.drawImage(canvas, 0, 0, preview.width, preview.height); visualFrames.push({ name, image: preview.toDataURL('image/jpeg', .82), atMs: performance.now() - start }); };
  const summarize = (frames: ReturnType<Map3D['getFrameState']>[]) => {
    const q = (values: number[], percentile: number) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * percentile))] ?? 0;
    return { count: frames.length, fps: 1000 / (frames.reduce((n, f) => n + f.ms, 0) / frames.length), cpuP95: q(frames.map(f => f.cpuMs), .95),
      intervalP95: q(frames.map(f => f.ms), .95), uncovered: frames.filter(f => f.uncovered > 0).length, emptyTarget: frames.filter(f => !f.target).length,
      maxCpuBytes: Math.max(...frames.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...frames.map(f => f.gpuBytes)), revisions: new Set(frames.map(f => f.revision)).size };
  };
  try {
    for (const theme of ['default', 'dark', 'vivid'] as ThemeId[]) {
      map.setTheme(THEMES[theme]);
      map.setLabelStyle({ layers: Object.fromEntries(['place-label', 'poi-label', 'road-label'].map(id => [id, { haloColor: theme === 'default' ? '#fff' : THEMES[theme].backgroundColor }])) });
      for (const [name, view] of [
        ['city', base], ['buildings', { ...base, zoom: 16.3, pitch: 60, bearing: 25 }],
        ['fog', { ...base, zoom: 5.5, pitch: 75 }], ['globe', { ...base, zoom: 0 }],
        ['dateline', { ...base, center: { lng: 179.9, lat: 0 }, zoom: 3, pitch: 40 }],
      ] as [string, ViewState][]) {
        status.textContent = `${map.getBackend()} ${theme} ${name}`; map.setView(view);
        const settled = await settle(), frames: ReturnType<Map3D['getFrameState']>[] = [], began = performance.now();
        while (performance.now() - began < 1800) { await next(); frames.push(map.getFrameState()); }
        capture(`${theme}-${name}`); const d = map.getDiagnostics();
        results.push({ name: `${theme}-${name}`, settled, motion: summarize(frames), render: d.render, labels: d.labels, tiles: d.tiles });
      }
    }
    map.setTheme(THEMES.default); map.setLabelStyle({}); map.setView(base); await settle();
    const frames: ReturnType<Map3D['getFrameState']>[] = [], begin = performance.now(); let phase = -1;
    while (performance.now() - begin < 45000) {
      const t = (performance.now() - begin) / 1000, section = Math.floor(t / 15);
      if (section !== phase) { phase = section; map.setTheme(THEMES[(['default', 'dark', 'vivid'] as const)[section]!]); }
      map.setView({ ...base, center: { lng: base.center.lng + Math.sin(t * .6) * .012, lat: base.center.lat + Math.sin(t * .9) * .006 },
        zoom: 15 + Math.sin(t * 2) * .12, bearing: Math.sin(t * .35) * 30, pitch: (Math.sin(t * .2) + 1) * 30 });
      await next(); frames.push(map.getFrameState());
    }
    results.push({ name: 'continuous-pan-zoom-themes', frames, motion: summarize(frames) });
    // 连续运动的视觉回读独立于 FPS 计时，逐帧状态与图像共同保存。
    map.setTheme(THEMES.default); map.setLabelStyle({}); map.setView({ ...base, pitch: 45 }); await settle();
    const visualBegin = performance.now(), visualStates: ReturnType<Map3D['getFrameState']>[] = []; let lastCapture = -1;
    while (performance.now() - visualBegin < 12000) {
      const t = (performance.now() - visualBegin) / 12000;
      map.setView({ ...base, center: { lng: base.center.lng + Math.sin(t * Math.PI * 2) * .045, lat: base.center.lat },
        zoom: 15.1 + Math.sin(t * Math.PI * 4) * .8, pitch: 45, bearing: 20 });
      await next(); visualStates.push(map.getFrameState());
      const index = Math.floor(t * 120); if (index !== lastCapture) { capture(`pan-zoom-${index}`); lastCapture = index; }
    }
    results.push({ name: 'visual-pan-zoom', frames: visualStates, motion: summarize(visualStates), screenshotTiming: true });
    // 视觉回读独立于上面的 FPS 计时。
    for (let n = 0; n <= 48; n++) {
      const zoom = 6.2 - n / 48 * 2;
      map.setView({ ...base, zoom, pitch: 75 }); await settle(); await next(); capture(`transition-${n}`);
    }
    map.setView({ ...base, zoom: 0, center: { lng: 116.394653, lat: 0 } }); await settle();
    for (let n = 0; n <= 36; n++) {
      map.setView({ center: { lng: 116.394653 + n * 10, lat: 0 } }); await settle(); await next();
      if (n % 3 === 0) capture(`revolution-${n}`);
    }
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'spherical-appearance', backend: map.getBackend(), at: new Date().toISOString(), viewport: map.getDiagnostics().viewport,
      visibility: document.visibilityState, results, errors, visualFrames,
    }) });
    if (!response.ok) throw new Error('验收证据保存失败');
    const saved = await response.json() as { file: string };
    document.documentElement.dataset.kmapAppearance = saved.file; status.textContent = `外观验收完成：${saved.file}`;
  } finally { stopErrors(); map.setTheme(THEMES.default); map.setLabelStyle({}); map.setView(base); }
}
