import type { Map3D, ViewState } from '@kmap/map3d';
import type { PerspectiveCamera, Scene } from 'three/webgpu';

/** 开发取证在真实 RAF 中采样；同步像素测试与独立性能阶段分别计量。 */
export async function runContinuityBenchmark(map: Map3D): Promise<void> {
  const runtime = map as unknown as { camera: PerspectiveCamera; scene: Scene; labels?: { retained: Set<string> } };
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const preview = document.createElement('canvas'); preview.width = 480; preview.height = 270;
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  const read = () => { ctx.drawImage(canvas, 0, 0, 480, 270); return ctx.getImageData(0, 0, 480, 270).data; };
  const next = () => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
  const phase = (name: string) => { document.documentElement.dataset.continuity = name; };
  const scenes: unknown[] = [], anomalies: unknown[] = [], errors: unknown[] = [];
  const frames: ReturnType<Map3D['getFrameState']>[] = [], visualFrames: { atMs: number; name: string; image: string }[] = [];
  const offError = map.on('error', e => errors.push({ code: e.code, message: e.message }));
  let comparisons = 0, maxChanged = 0;
  const compare = (name: string, save = false) => {
    const a = read(); map.getRenderer().render(runtime.scene, runtime.camera); const b = read();
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) > 16) changed++;
    comparisons++; maxChanged = Math.max(maxChanged, changed);
    if (changed > 120) anomalies.push({ name, changed, ...map.getFrameState() });
    if (save || changed > 120 && visualFrames.length < 100) visualFrames.push({ name, atMs: performance.now(), image: preview.toDataURL('image/jpeg', .9) });
  };
  const settle = async (name: string, labels = false) => {
    const started = performance.now(); let stable = 0;
    while (performance.now() - started < 20000 && stable < 12) {
      await next(); const f = map.getFrameState();
      stable = !f.missing && !f.uncovered && (!labels || !map.getDiagnostics().labels?.pendingRanges) ? stable + 1 : 0;
      compare(`${name}-load`, comparisons % 40 === 0); frames.push(f);
    }
    return stable >= 12;
  };
  const taiwan: ViewState = { center: { lng: 121, lat: 23.7 }, zoom: 7, pitch: 0, bearing: 0 };
  const beijing: ViewState = { center: { lng: 116.39465, lat: 39.9055 }, zoom: 15.5, pitch: 55, bearing: 0 };
  try {
    phase('cold-taiwan'); map.setView(taiwan);
    await settle('cold-taiwan', true);
    for (const zoom of [7, 8, 10, 12]) {
      const name = `taiwan-${zoom}`; phase(name); map.setView({ ...taiwan, zoom });
      const settled = await settle(name, true); compare(name, true);
      scenes.push({ name, settled, ...map.getFrameState(), diagnostics: map.getDiagnostics(), labels: [...runtime.labels?.retained ?? []] });
    }
    for (const zoom of [3, 4, 5, 6, 7]) {
      const name = `hierarchy-${zoom}`; phase(name); map.setView({ center: { lng: 112, lat: 35 }, zoom, pitch: 0, bearing: 0 });
      const settled = await settle(name, true); compare(name, true);
      scenes.push({ name, settled, ...map.getFrameState(), labels: [...runtime.labels?.retained ?? []], diagnostics: map.getDiagnostics() });
    }
    for (const base of [taiwan, beijing]) {
      const name = `pan-${base.zoom}`; phase(name); map.setView(base); await settle(name);
      for (let n = 0; n < 240; n++) {
        const scale = 2 ** (7 - base.zoom);
        map.setView({ ...base, center: { lng: base.center.lng + Math.sin(n / 60) * 3 * scale, lat: base.center.lat + Math.sin(n / 90) * scale } });
        await next(); compare(name, n % 30 === 0); frames.push(map.getFrameState());
      }
      const settled = await settle(`${name}-end`); scenes.push({ name, settled, ...map.getFrameState(), diagnostics: map.getDiagnostics() });
    }
    phase('zoom-pitch');
    for (let n = 0; n < 240; n++) {
      map.setView({ ...beijing, zoom: 14.5 + Math.sin(n / 30) * 2.2, pitch: 35 + Math.sin(n / 55) * 35, bearing: n / 3 });
      await next(); compare('zoom-pitch', n % 30 === 0); frames.push(map.getFrameState());
    }
    for (const pitch of [0, 60, 75]) {
      map.setView({ ...beijing, zoom: 16, pitch }); const settled = await settle(`pitch-${pitch}`); compare(`pitch-${pitch}`, true);
      scenes.push({ name: `pitch-${pitch}`, settled, ...map.getFrameState(), diagnostics: map.getDiagnostics() });
    }
    phase('performance'); map.setView(beijing); await settle('performance-ready');
    const timings: ReturnType<Map3D['getFrameState']>[] = [], start = performance.now();
    while (performance.now() - start < 12000) {
      const t = (performance.now() - start) / 1000;
      map.setView({ ...beijing, center: { lng: beijing.center.lng + Math.sin(t * .7) * .014, lat: beijing.center.lat + Math.sin(t * .4) * .008 },
        zoom: 15.4 + Math.sin(t * 1.4) * .65, pitch: 35 + Math.sin(t * .4) * 25, bearing: Math.sin(t * .2) * 30 });
      await next(); timings.push(map.getFrameState());
    }
    const q = (a: number[]) => a.sort((a, b) => a - b)[Math.floor(a.length * .95)];
    const perf = { frames: timings.length, fps: 1000 * timings.length / timings.reduce((n, f) => n + f.ms, 0),
      intervalP95: q(timings.map(f => f.ms)), cpuP95: q(timings.map(f => f.cpuMs)), uncovered: timings.filter(f => f.uncovered).length,
      maxCpuBytes: Math.max(...timings.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...timings.map(f => f.gpuBytes)) };
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'map-continuity', backend: map.getBackend(), at: new Date().toISOString(), viewport: map.getDiagnostics().viewport,
      comparisons, maxChanged, anomalies, errors, scenes, frames, visualFrames, performance: perf,
    }) });
    if (!response.ok) throw new Error('验证证据保存失败');
    phase(`done:${(await response.json() as { file: string }).file}`);
  } catch (e) { phase(`error:${String(e)}`); throw e; }
  finally { offError(); map.setView(taiwan); }
}
