import type { Map3D, ViewState } from '@kmap/map3d';
import { Vector3, type PerspectiveCamera } from 'three/webgpu';

const next = (map: Map3D) => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
const settle = async (map: Map3D) => {
  const start = performance.now(); let stable = 0;
  while (performance.now() - start < 45000 && stable < 15) {
    await next(map); const frame = map.getFrameState(); stable = frame.missing === 0 && frame.uncovered === 0 ? stable + 1 : 0;
  }
  return stable >= 15;
};

/** 以固定海陆坐标采样实际 GPU 像素，覆盖内容校验独立于瓦片就绪指标。 */
export async function runOceanContinuityBenchmark(map: Map3D): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const runtime = map as unknown as { camera: PerspectiveCamera };
  const sample = new OffscreenCanvas(canvas.width, canvas.height), ctx = sample.getContext('2d', { willReadFrequently: true })!;
  const points = [[122.1, 23.5], [124, 23], [125, 23], [126, 23], [127, 23], [128, 23], [124, 22], [126, 22], [125, 24], [127, 24], [128, 24]];
  const read = () => {
    ctx.drawImage(canvas, 0, 0); const diagnostics = map.getDiagnostics(), origin = diagnostics.camera.origin.meters;
    return [...points.map(p => ({ lng: p[0]!, lat: p[1]!, water: true })), { lng: 121.1, lat: 23.5, water: false }].flatMap(p => {
      const v = new Vector3(p.lng * Math.PI / 180 * 6378137 - origin.x, 0,
        origin.y - Math.asinh(Math.tan(p.lat * Math.PI / 180)) * 6378137);
      if (v.distanceTo(runtime.camera.position) > map.getFrameState().fogStart * .95) return [];
      v.project(runtime.camera); const x = Math.round((v.x + 1) * canvas.width / 2), y = Math.round((1 - v.y) * canvas.height / 2);
      if (x < 4 || y < 4 || x >= canvas.width - 4 || y >= canvas.height - 4) return [];
      const bytes = ctx.getImageData(x - 3, y - 3, 7, 7).data; let waterPixels = 0;
      for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 2]! - bytes[i]! > 45 && bytes[i + 1]! - bytes[i]! > 20) waterPixels++;
      return [{ ...p, x, y, waterPixels, pass: p.water ? waterPixels >= 40 : waterPixels < 10 }];
    });
  };
  const errors: unknown[] = [], scenes: object[] = [], frames: object[] = [], visualFrames: object[] = [];
  const off = map.on('error', e => errors.push(e.message));
  const views: [string, ViewState][] = [
    ['user-6.84', { center: { lng: 119.199903, lat: 23.553010 }, zoom: 6.84, bearing: 43.3, pitch: 49 }],
    ['user-7.34', { center: { lng: 121.231560, lat: 23.596148 }, zoom: 7.34, bearing: 43.3, pitch: 49 }],
    ['same-view-6.84', { center: { lng: 121.231560, lat: 23.596148 }, zoom: 6.84, bearing: 43.3, pitch: 49 }],
    ['threshold-7', { center: { lng: 121.231560, lat: 23.596148 }, zoom: 7, bearing: 43.3, pitch: 49 }],
    ['taiwan10', { center: { lng: 121.3, lat: 23.5 }, zoom: 10, bearing: 0, pitch: 0 }],
  ];
  try {
    for (const [name, view] of views) {
      document.documentElement.dataset.oceanContinuity = name; map.setView(view); const settled = await settle(map);
      scenes.push({ name, settled, samples: read(), diagnostics: map.getDiagnostics() });
      visualFrames.push({ name, atMs: performance.now(), image: canvas.toDataURL('image/jpeg', .95) });
    }
    map.setView(views[1]![1]); await settle(map);
    for (let i = 0; i < 240; i++) {
      document.documentElement.dataset.oceanContinuity = `motion-${i}`;
      map.setView({ ...views[1]![1], zoom: 7.05 + Math.sin(i / 25) * .28,
        center: { lng: 121.231560 + Math.sin(i / 60) * .15, lat: 23.596148 + Math.cos(i / 40) * .1 } });
      await next(map); frames.push({ ...map.getFrameState(), samples: read() });
    }
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'ocean-content-continuity', at: new Date().toISOString(), backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
      scenes, frames, visualFrames, errors,
    }) });
    document.documentElement.dataset.oceanContinuity = `done:${(await response.json() as { file: string }).file}`;
  } finally { off(); }
}
