import type { Map3D, ViewState } from '@kmap/map3d';
import { THEMES, type ThemeId } from './themes.js';

/** 实际提交帧的冷加载回读、地球过渡与独立性能计时。 */
export async function runInspectorBenchmark(map: Map3D): Promise<void> {
  const base: ViewState = { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15, pitch: 0, bearing: 0 };
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const preview = document.createElement('canvas'); preview.width = 240; preview.height = Math.round(canvas.height * 240 / canvas.width);
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  const full = document.createElement('canvas'); full.width = 1280; full.height = Math.round(canvas.height * 1280 / canvas.width);
  const fullCtx = full.getContext('2d')!;
  const images: { name: string; image: string }[] = [], cold: { frame: ReturnType<Map3D['getFrameState']>; white: number; image: string }[] = [];
  const results: unknown[] = [], errors: unknown[] = [];
  const offError = map.on('error', error => errors.push(error));
  const status = (value: string) => { document.documentElement.dataset.inspectorTest = value; };
  const next = () => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
  const settle = async () => {
    const began = performance.now(); let stable = 0;
    while (performance.now() - began < 20000 && stable < 8) {
      await next(); const d = map.getDiagnostics();
      stable = d.tiles?.targetMissing === 0 && d.tiles.uncoveredCells === 0 && d.labels?.pendingRanges === 0 ? stable + 1 : 0;
    }
    return stable === 8;
  };
  const capture = (name: string) => { fullCtx.drawImage(canvas, 0, 0, full.width, full.height); images.push({ name, image: full.toDataURL('image/png') }); };
  try {
    map.setLabelStyle({ visible: false }); status('cold');
    const coldStart = performance.now();
    while (performance.now() - coldStart < 6500) {
      await next(); ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
      const pixels = ctx.getImageData(0, 0, preview.width, preview.height).data; let white = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 248 && pixels[i + 1]! > 248 && pixels[i + 2]! > 248) white++;
      cold.push({ frame: map.getFrameState(), white: white / (pixels.length / 4), image: preview.toDataURL('image/jpeg', .8) });
    }
    const flashes = cold.flatMap((f, i) => i > 0 && i < cold.length - 1 && f.white - Math.max(cold[i - 1]!.white, cold[i + 1]!.white) > .015 ? [i] : []);
    results.push({ name: 'cold-labels-off', frames: cold.length, flashes });
    map.setLabelStyle({});
    for (const pitch of [0, 75]) for (const zoom of [6.2, 5.51, 5.49, 5.2, 5, 4.8, 4.51, 4.49, 4.2, 2]) {
      const name = `transition-${pitch}-${zoom}`; status(name); map.setView({ ...base, zoom, pitch });
      const settled = await settle(); capture(name); const d = map.getDiagnostics();
      results.push({ name, settled, missing: d.tiles?.targetMissing, uncovered: d.tiles?.uncoveredCells, labels: d.labels, drawCalls: d.render.drawCalls });
    }
    for (const lng of [179.9, 180.1, 476.394653]) {
      const name = `dateline-${lng}`; status(name); map.setView({ ...base, center: { lng, lat: 40 }, zoom: 5 });
      const settled = await settle(); capture(name); results.push({ name, settled });
    }
    for (const theme of ['default', 'dark', 'vivid'] as ThemeId[]) {
      map.setTheme(THEMES[theme]);
      for (const zoom of [10, 16.3, 20, 22]) {
        const name = `${theme}-${zoom}`; status(name); map.setView({ ...base, zoom, pitch: zoom === 16.3 ? 60 : 0 });
        const settled = await settle(); capture(name); const d = map.getDiagnostics();
        results.push({ name, settled, missing: d.tiles?.targetMissing, labels: d.labels, drawCalls: d.render.drawCalls });
      }
    }
    map.setTheme(THEMES.default); map.setLabelStyle({ visible: false });
    const scan = document.createElement('canvas'); scan.width = canvas.width; scan.height = 1;
    const scanCtx = scan.getContext('2d', { willReadFrequently: true })!;
    for (const zoom of [20, 22]) {
      status(`subpixel-${zoom}`); const step = .25 * 360 / (256 * 2 ** zoom);
      map.setView({ ...base, zoom, center: { ...base.center, lng: base.center.lng - 60 * step } }); await settle();
      const samples: { expected: number; actual: number; error: number }[] = []; let edge = 0, initial = 0;
      for (let n = 0; n <= 120; n++) {
        map.setView({ center: { ...base.center, lng: base.center.lng + (n - 60) * step } }); await next();
        scanCtx.drawImage(canvas, 0, Math.floor(canvas.height / 2), canvas.width, 1, 0, 0, scan.width, 1);
        const pixels = scanCtx.getImageData(0, 0, scan.width, 1).data;
        const gradient = (x: number) => Math.abs(pixels[x * 4]! - pixels[(x - 1) * 4]!) + Math.abs(pixels[x * 4 + 1]! - pixels[(x - 1) * 4 + 1]!) + Math.abs(pixels[x * 4 + 2]! - pixels[(x - 1) * 4 + 2]!);
        if (!n) for (let x = 100; x < scan.width - 100; x++) if (gradient(x) > gradient(edge || 100)) edge = x;
        const expected = edge - n * .25; let weighted = 0, total = 0;
        for (let x = Math.round(expected) - 5; x <= Math.round(expected) + 5; x++) { const w = gradient(x); total += w; weighted += x * w; }
        const actual = weighted / total; if (!n) initial = actual;
        samples.push({ expected: initial - n * .25, actual, error: actual - initial + n * .25 });
      }
      results.push({ name: `subpixel-${zoom}`, samples, maxError: Math.max(...samples.map(s => Math.abs(s.error))) });
    }
    map.setLabelStyle({});
    map.setView(base); map.setTheme(THEMES.default); await settle();
    status('performance'); const frames: ReturnType<Map3D['getFrameState']>[] = [], began = performance.now(); let themeIndex = -1;
    while (performance.now() - began < 30000) {
      const t = (performance.now() - began) / 1000, index = Math.floor(t / 10);
      if (index !== themeIndex) { themeIndex = index; map.setTheme(THEMES[(['default', 'dark', 'vivid'] as const)[index]!]); }
      map.setView({ ...base, center: { lng: base.center.lng + Math.sin(t * .7) * .014, lat: base.center.lat + Math.sin(t * .4) * .008 },
        zoom: 15.4 + Math.sin(t * 1.4) * .65, pitch: 35 + Math.sin(t * .4) * 25, bearing: Math.sin(t * .2) * 30 });
      await next(); frames.push(map.getFrameState());
    }
    const q = (list: number[]) => list.sort((a, b) => a - b)[Math.floor(list.length * .95)];
    results.push({ name: 'performance', frames: frames.length, fps: 1000 * frames.length / frames.reduce((n, f) => n + f.ms, 0),
      intervalP95: q(frames.map(f => f.ms)), cpuP95: q(frames.map(f => f.cpuMs)), uncovered: frames.filter(f => f.uncovered).length,
      maxCpuBytes: Math.max(...frames.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...frames.map(f => f.gpuBytes)) });
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'map-inspector', backend: map.getBackend(), at: new Date().toISOString(), viewport: map.getDiagnostics().viewport, results, cold, images, frames, errors,
    }) });
    if (!response.ok) throw new Error('浏览器证据保存失败。');
    status(`done:${(await response.json() as { file: string }).file}`);
  } finally { offError(); map.setView(base); map.setTheme(THEMES.default); map.setLabelStyle({}); }
}
