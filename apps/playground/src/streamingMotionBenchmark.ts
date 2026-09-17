import type { Map3D, ViewState } from '@kmap/map3d';
import type { PerspectiveCamera, Scene } from 'three/webgpu';

/** 开发验证：相同状态重复绘制逐像素对照，运动取证与性能计时分别执行。 */
export async function runStreamingMotionBenchmark(map: Map3D): Promise<void> {
  const base: ViewState = { center: { lng: 116.39465, lat: 39.9055 }, zoom: 15, pitch: 0, bearing: 0 };
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const renderer = map.getRenderer();
  // 开发探针只读取场景与相机；生产 SDK 的公共接口保持独立。
  const runtime = map as unknown as { scene: Scene; camera: PerspectiveCamera };
  const preview = document.createElement('canvas'); preview.width = 480; preview.height = Math.round(canvas.height * 480 / canvas.width);
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  const read = () => { ctx.drawImage(canvas, 0, 0, preview.width, preview.height); return ctx.getImageData(0, 0, preview.width, preview.height).data; };
  const snapshot = () => preview.toDataURL('image/jpeg', .85);
  const next = () => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
  const status = (value: string) => { document.documentElement.dataset.motionTest = value; };
  const samples: unknown[] = [], images: { name: string; image: string }[] = [], anomalies: unknown[] = [], scenes: unknown[] = [], errors: unknown[] = [];
  const offError = map.on('error', error => errors.push(error));
  let comparisons = 0, maxDifference = 0;
  const compare = (name: string) => {
    const first = read(), before = snapshot();
    renderer.render(runtime.scene, runtime.camera);
    const second = read(); let changed = 0;
    for (let i = 0; i < first.length; i += 4)
      if (Math.max(Math.abs(first[i]! - second[i]!), Math.abs(first[i + 1]! - second[i + 1]!), Math.abs(first[i + 2]! - second[i + 2]!)) > 16) changed++;
    comparisons++; maxDifference = Math.max(maxDifference, changed);
    if (changed > 120) {
      anomalies.push({ name, changed, frame: map.getFrameState() });
      if (images.length < 24) images.push({ name: `${name}-first`, image: before }, { name: `${name}-second`, image: snapshot() });
    }
    samples.push({ name, changed, ...map.getFrameState() });
  };
  const settle = async () => {
    const began = performance.now(); let stable = 0;
    while (performance.now() - began < 20000 && stable < 8) {
      await next(); const f = map.getFrameState();
      stable = !f.missing && !f.uncovered ? stable + 1 : 0;
    }
    return stable === 8;
  };
  try {
    map.setLabelStyle({ visible: false });
    status('motion');
    for (let n = 0; n < 720; n++) {
      const t = n / 60;
      map.setView({ center: { lng: base.center.lng + Math.sin(t * 1.8) * .02, lat: base.center.lat + Math.sin(t * 1.2) * .009 },
        zoom: 15.5 + Math.sin(t * 2.1) * 2.8, pitch: 35 + Math.sin(t * .8) * 35, bearing: t * 12 });
      await next(); compare(`motion-${n}`);
    }
    for (const zoom of [5, 8, 10, 13, 15, 16, 17, 20]) for (const pitch of [0, 60, 75]) {
      const name = `view-${zoom}-${pitch}`; status(name); map.setView({ ...base, zoom, pitch, bearing: 35 });
      const settled = await settle(); compare(name); read(); images.push({ name, image: snapshot() });
      scenes.push({ name, settled, ...map.getFrameState() });
    }
    status('threshold'); map.setView({ ...base, zoom: 16.2 }); await settle();
    for (let n = 0; n < 160; n++) {
      map.setView({ ...base, zoom: 16 + Math.sin(n * .3) * .07, pitch: 60, bearing: n * .5 });
      await next(); compare(`threshold-${n}`);
    }
    map.setLabelStyle({}); map.setView(base); await settle();
    status('performance'); const frames: ReturnType<Map3D['getFrameState']>[] = [], began = performance.now();
    while (performance.now() - began < 30000) {
      const t = (performance.now() - began) / 1000;
      map.setView({ ...base, center: { lng: base.center.lng + Math.sin(t * .7) * .014, lat: base.center.lat + Math.sin(t * .4) * .008 },
        zoom: 15.4 + Math.sin(t * 1.4) * .65, pitch: 35 + Math.sin(t * .4) * 25, bearing: Math.sin(t * .2) * 30 });
      await next(); frames.push(map.getFrameState());
    }
    const q = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * .95)];
    const performanceResult = { frames: frames.length, fps: 1000 * frames.length / frames.reduce((n, f) => n + f.ms, 0),
      intervalP95: q(frames.map(f => f.ms)), cpuP95: q(frames.map(f => f.cpuMs)), uncovered: frames.filter(f => f.uncovered).length,
      maxCpuBytes: Math.max(...frames.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...frames.map(f => f.gpuBytes)) };
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'streaming-motion', at: new Date().toISOString(), backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
      comparisons, maxDifference, anomalies, scenes, samples, images, frames, performance: performanceResult, errors,
    }) });
    if (!response.ok) throw new Error('运动验证证据保存失败。');
    status(`done:${(await response.json() as { file: string }).file}`);
  } finally { offError(); map.setView(base); map.setLabelStyle({}); }
}
