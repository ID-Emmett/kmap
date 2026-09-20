import type { Map3D } from '@kmap/map3d';
import { Color, type Scene, type PerspectiveCamera, type Mesh } from 'three/webgpu';

/** 真实字体在亚像素移动中的独立墨量检查；额外绘制与读取独立于性能基准。 */
export async function runLabelMotionBenchmark(map: Map3D): Promise<void> {
  const runtime = map as unknown as { scene: Scene; camera: PerspectiveCamera; labels: { surface: { mesh: Mesh; count: number } } };
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  const read = new OffscreenCanvas(canvas.width, canvas.height), ctx = read.getContext('2d', { willReadFrequently: true })!;
  const next = () => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
  const base = { center: { lng: 116.39465, lat: 39.9055 }, zoom: 15.8, pitch: 0, bearing: 0 };
  map.setView(base); document.documentElement.dataset.labelMotion = 'settling';
  const start = performance.now(); let steady = 0;
  while (performance.now() - start < 30000 && steady < 90) {
    await next(); const d = map.getDiagnostics(); steady = d.tiles?.coverageComplete && !d.tiles.targetMissing && !d.labels?.pendingRanges ? steady + 1 : 0;
  }
  const frames: { mass: number; glyphs: number; x: number }[] = [], visualFrames: object[] = [];
  document.documentElement.dataset.labelMotion = 'sampling';
  for (let i = 0; i < 128; i++) {
    const x = i / 32;
    map.setView({ ...base, center: { ...base.center, lng: base.center.lng + x * 360 / (256 * 2 ** base.zoom) } });
    await next();
    const hidden = runtime.scene.children.filter(o => o !== runtime.labels.surface.mesh).map(o => [o, o.visible] as const);
    const background = runtime.scene.background;
    try {
      for (const [o] of hidden) o.visible = false;
      runtime.scene.background = new Color('#ffffff'); map.getRenderer().render(runtime.scene, runtime.camera);
      ctx.drawImage(canvas, 0, 0); const data = ctx.getImageData(0, 0, read.width, read.height).data;
      let mass = 0; for (let p = 0; p < data.length; p += 4) mass += (765 - data[p]! - data[p + 1]! - data[p + 2]!) / 765;
      frames.push({ mass, glyphs: runtime.labels.surface.count, x });
      if (i % 32 === 0) visualFrames.push({ name: `subpixel-${i}`, atMs: performance.now(), image: canvas.toDataURL('image/png') });
    } finally { for (const [o, visible] of hidden) o.visible = visible; runtime.scene.background = background; }
  }
  const masses = frames.map(f => f.mass), mean = masses.reduce((s, m) => s + m, 0) / masses.length;
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    kind: 'label-subpixel-motion', at: new Date().toISOString(), backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
    settled: steady >= 90, frames, visualFrames, meanMass: mean, relativeRange: (Math.max(...masses) - Math.min(...masses)) / mean,
    maxStep: Math.max(...masses.slice(1).map((m, i) => Math.abs(m - masses[i]!))) / mean,
  }) });
  document.documentElement.dataset.labelMotion = `done:${(await response.json() as { file: string }).file}`;
}
