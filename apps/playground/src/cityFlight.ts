import type { Map3D, ViewState } from '@kmap/map3d';

export const CITIES = {
  beijing: { center: { lng: 116.39465, lat: 39.90552 }, zoom: 15.8, bearing: 0, pitch: 0 },
  shanghai: { center: { lng: 121.4737, lat: 31.2304 }, zoom: 15.8, bearing: 0, pitch: 0 },
  guangzhou: { center: { lng: 113.2644, lat: 23.1291 }, zoom: 15.8, bearing: 0, pitch: 0 },
} satisfies Record<string, ViewState>;
const smooth = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

/** van Wijk / Nuij 双曲函数路径，以屏幕跨度协调缩放和平移。 */
export function flightView(from: ViewState, to: ViewState, progress: number, viewportWidth = 1280): ViewState {
  if (progress <= 0) return { ...from, center: { ...from.center } };
  if (progress >= 1) return { ...to, center: { ...to.center } };
  const deltaLng = ((to.center.lng - from.center.lng + 540) % 360) - 180;
  const dy = (mercatorY(to.center.lat) - mercatorY(from.center.lat)) / (2 * Math.PI);
  const distance = Math.hypot(deltaLng / 360, dy) * 256 * 2 ** from.zoom;
  const w0 = viewportWidth; const w1 = w0 / 2 ** (to.zoom - from.zoom); const rho = 1.42; const rho2 = rho * rho;
  let pan = smooth(progress); let zoom = from.zoom + (to.zoom - from.zoom) * pan;
  if (distance > .001) {
    const factor = (end: boolean) => -Math.asinh((w1 * w1 - w0 * w0 + (end ? -1 : 1) * rho2 * rho2 * distance * distance) / (2 * (end ? w1 : w0) * rho2 * distance));
    const r0 = factor(false); const length = (factor(true) - r0) / rho; const s = smooth(progress) * length;
    const scale = Math.cosh(r0) / Math.cosh(r0 + rho * s);
    zoom = from.zoom - Math.log2(scale);
    pan = Math.min(1, Math.max(0, w0 * (Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2 / distance));
  }
  const y = mercatorY(from.center.lat) + (mercatorY(to.center.lat) - mercatorY(from.center.lat)) * pan;
  return { center: { lng: from.center.lng + deltaLng * pan, lat: (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI }, zoom,
    bearing: from.bearing + (to.bearing - from.bearing) * smooth(progress), pitch: from.pitch + (to.pitch - from.pitch) * smooth(progress) };
}

export async function flyToCity(map: Map3D, destination: ViewState, duration = 12000, cancelled = () => false, onFrame?: (progress: number) => void): Promise<void> {
  const from = map.getView(); const width = map.getDiagnostics().viewport.width;
  const overview = flightView(from, destination, .5, width);
  map.prefetchViews([{ ...overview, zoom: Math.max(0, overview.zoom - 2), pitch: 0 }], { ttlMs: duration + 2000, priority: -100, limit: 4 });
  map.prefetchViews([{ ...destination, zoom: Math.max(0, destination.zoom - 1) }, destination], { ttlMs: duration + 2000, priority: 75, limit: 8 });
  const start = performance.now(); let prefetchedAt = -Infinity;
  while (true) {
    if (cancelled()) throw new Error('飞行已取消。');
    const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    const progress = Math.min(1, (now - start) / duration);
    if (now - prefetchedAt >= 250) {
      prefetchedAt = now;
      const latency = (map.getDiagnostics().tiles?.requestTime.p95 ?? 0) / 1000;
      const near = Math.min(1, Math.max(.5, latency));
      const far = Math.min(2.4, Math.max(1.5, latency * 2));
      for (const [seconds, priority] of [[near, 0], [far, 10]] as const) {
        const future = flightView(from, destination, Math.min(1, progress + seconds * 1000 / duration), width);
        if (priority === 10) map.prefetchViews([{ ...future, zoom: Math.max(0, future.zoom - 2) }], { priority: -20, limit: 8, ttlMs: 1400 });
        else map.prefetchViews([future], { priority, limit: 16 });
      }
    }
    map.setView(flightView(from, destination, progress, width)); onFrame?.(progress);
    if (progress === 1) break;
  }
}
