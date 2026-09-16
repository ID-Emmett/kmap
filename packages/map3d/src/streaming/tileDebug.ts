import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { MapOrigin } from '../spatial/types.js';
import type { ViewportSize } from '../types.js';
import { keyOf, tileBounds } from './address.js';
import type { CoverPatch } from './renderCover.js';

/** 当前有效区域的屏幕投影，编号与 source 的地理地址共同标识绘制来源。 */
export function debugTiles(camera: PerspectiveCamera, origin: MapOrigin, viewport: ViewportSize, patches: readonly CoverPatch[], cutoff: number) {
  const ids = new Map<string, number>(); const point = new Vector3();
  const cells = patches.map(p => {
    const key = keyOf(p.source); if (!ids.has(key)) ids.set(key, ids.size + 1);
    const b = tileBounds(p.cell); const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
    const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
      point.set(x + u! * b.span, 0, z + v! * b.span).project(camera);
      return { x: (point.x + 1) * viewport.width / 2, y: (1 - point.y) * viewport.height / 2 };
    });
    point.set(x + b.span / 2, 0, z + b.span / 2).project(camera);
    return { id: ids.get(key)!, source: key, cell: keyOf(p.cell), z: p.source.z, polygon,
      center: { x: (point.x + 1) * viewport.width / 2, y: (1 - point.y) * viewport.height / 2 } };
  });
  return { width: viewport.width, height: viewport.height, cutoff, sources: ids.size, cells };
}
