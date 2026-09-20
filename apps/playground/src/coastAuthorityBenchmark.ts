import type { Map3D, ViewState } from '@kmap/map3d';
import { Vector3, type Mesh, type PerspectiveCamera, type Scene } from 'three/webgpu';
import auditUrl from '../../../docs/evidence/maplibre-alignment/coast-source-audit.json?url';

const next = (map: Map3D) => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
const settle = async (map: Map3D) => {
  const start = performance.now(); let n = 0;
  while (performance.now() - start < 45000 && n < 20) { await next(map); const f = map.getFrameState(); n = !f.missing && !f.uncovered ? n + 1 : 0; }
  return n >= 20;
};
interface Probe { lng: number; lat: number; id: number; water: boolean }

/** 隐藏建筑、线和文字后读取实际地表像素，独立检查建筑底部海陆与近岸海面。 */
export async function runCoastAuthorityBenchmark(map: Map3D): Promise<void> {
  const audit = await (await fetch(auditUrl)).json() as { buildings?: { id: number; lng: number; lat: number }[]; seaProbes?: { lng: number; lat: number }[] }[];
  const points: Probe[] = audit.flatMap(r => (r.buildings ?? []).map(p => ({ ...p, water: false })));
  points.push(...audit.flatMap(r => r.seaProbes ?? []).map((p, i) => ({ ...p, water: true, id: -i - 1 })));
  const runtime = map as unknown as { scene: Scene; camera: PerspectiveCamera; labels?: { surface: { mesh: Mesh } } };
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const read = new OffscreenCanvas(canvas.width, canvas.height), ctx = read.getContext('2d', { willReadFrequently: true })!;
  const sample = () => {
    const hidden: [Mesh, boolean][] = [];
    runtime.scene.traverse(o => {
      if (o instanceof Object && ('userData' in o) && (o.userData.lineState || o.userData.buildingState || o === runtime.labels?.surface.mesh)) {
        hidden.push([o as Mesh, o.visible]); o.visible = false;
      }
    });
    try {
      map.getRenderer().render(runtime.scene, runtime.camera); ctx.drawImage(canvas, 0, 0);
      const origin = map.getDiagnostics().camera.origin.meters;
      return points.flatMap(p => {
        const v = new Vector3(p.lng * Math.PI / 180 * 6378137 - origin.x, 0, origin.y - Math.asinh(Math.tan(p.lat * Math.PI / 180)) * 6378137).project(runtime.camera);
        const x = Math.round((v.x + 1) * canvas.width / 2), y = Math.round((1 - v.y) * canvas.height / 2);
        if (v.z < -1 || v.z > 1 || x < 2 || y < 2 || x >= canvas.width - 2 || y >= canvas.height - 2) return [];
        const bytes = ctx.getImageData(x - 1, y - 1, 3, 3).data; let wet = 0;
        for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 2]! - bytes[i]! > 45 && bytes[i + 1]! - bytes[i]! > 20) wet++;
        return [{ id: p.id, water: p.water, wet, pass: p.water ? wet >= 7 : wet <= 2 }];
      });
    } finally { for (const [o, visible] of hidden) o.visible = visible; map.getRenderer().render(runtime.scene, runtime.camera); }
  };
  const scenes: object[] = [], frames: object[] = [], visualFrames: object[] = [], errors: object[] = [];
  const off = map.on('error', e => errors.push({ code: e.code, message: e.message }));
  const base: ViewState = { center: { lng: 114.221, lat: 22.202 }, zoom: 16, bearing: 0, pitch: 35 };
  try {
    for (const zoom of [7.34, 10, 14, 16, 17, 18]) {
      document.documentElement.dataset.coastAuthority = `z${zoom}`; map.setView({ ...base, zoom });
      const settled = await settle(map);
      // 建筑地面以 z14 以上的可分辨像素核验；概览保留完整海岸截图。
      scenes.push({ zoom, settled, samples: zoom >= 14 ? sample() : [], diagnostics: map.getDiagnostics() });
      visualFrames.push({ name: `stanley-${zoom}`, atMs: performance.now(), image: canvas.toDataURL('image/jpeg', .95) });
    }
    map.setView(base); await settle(map);
    for (let i = 0; i < 240; i++) {
      document.documentElement.dataset.coastAuthority = `motion-${i}`;
      map.setView({ ...base, zoom: 16.3 + Math.sin(i / 45) * .65, bearing: Math.sin(i / 75) * 25,
        center: { lng: base.center.lng + Math.sin(i / 50) * .002, lat: base.center.lat + Math.sin(i / 60) * .001 } });
      await next(map); frames.push({ ...map.getFrameState(), samples: sample() });
    }
    await settle(map); document.documentElement.dataset.coastAuthority = 'performance';
    const perf: ReturnType<Map3D['getFrameState']>[] = [], start = performance.now();
    while (performance.now() - start < 8000) {
      const t = (performance.now() - start) / 1000;
      map.setView({ ...base, zoom: 16.3 + Math.sin(t) * .4, bearing: Math.sin(t) * 15,
        center: { lng: base.center.lng + Math.sin(t) * .001, lat: base.center.lat + Math.cos(t) * .001 } });
      await next(map); perf.push(map.getFrameState());
    }
    const p95 = (a: number[]) => a.sort((a, b) => a - b)[Math.floor(a.length * .95)];
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'coast-authority', at: new Date().toISOString(), backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
      scenes, frames, visualFrames, errors, final: map.getDiagnostics(),
      performance: { fps: perf.length * 1000 / perf.reduce((s, f) => s + f.ms, 0), frames: perf.length,
        intervalP95: p95(perf.map(f => f.ms)), cpuP95: p95(perf.map(f => f.cpuMs)), uncovered: perf.filter(f => f.uncovered).length,
        maxCpuBytes: Math.max(...perf.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...perf.map(f => f.gpuBytes)) },
    }) });
    document.documentElement.dataset.coastAuthority = `done:${(await response.json() as { file: string }).file}`;
  } finally { off(); }
}
