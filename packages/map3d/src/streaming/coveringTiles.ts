import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { ViewportSize, ViewState } from '../types.js';
import { childrenOf, contains, keyOf, parentOf, tileBounds, type Address } from './address.js';
import { distanceToGroundBox, fogDistances } from './fog.js';
import { groundVisibility } from './groundVisibility.js';
import { TILE_LIMITS } from './limits.js';

export interface Selection {
  visible: (cell: Address) => boolean; leaves: Address[]; ideal: Address[]; priorities: Map<string, number>;
  cutoff: number; fogStart: number; fogEnd: number; visited: number; culled: number; fogCulled: number; budgetReduced: number;
}
export function emptySelection(): Selection {
  return { visible: () => false, leaves: [], ideal: [], priorities: new Map(), cutoff: 1, fogStart: 1, fogEnd: 1, visited: 0, culled: 0, fogCulled: 0, budgetReduced: 0 };
}
/** MapLibre covering-tiles 的等屏幕面积尺度模型；数据层级由局部斜距和倾角决定。 */
export function localTileZoom(viewZoom: number, centerDistance: number, distance: number, height: number, fov: number): number {
  return viewZoom + Math.log2(centerDistance / distance / Math.cos(fov * Math.PI / 360))
    + .5 * Math.log2(Math.min(1, height / distance));
}
/** 视锥和完全入雾剔除先于细分，预算合并按屏幕质量代价排序。 */
export function selectTiles(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize,
  minZoom: number, maxZoom: number, margin = 1, maxLeaves: number = TILE_LIMITS.visible): Selection {
  const result = emptySelection(); const fog = fogDistances(frame, view.pitch);
  // Mapbox 的 98% 可见雾阈值；0.915962 为 smoothstep(t)=0.98 的根。
  result.cutoff = fog.start + (fog.end - fog.start) * .915962; result.fogStart = fog.start; result.fogEnd = fog.end;
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  const exactVisible = groundVisibility(frustum, frame.position, result.cutoff);
  const box = new Box3();
  result.visible = (a: Address): boolean => {
    const b = tileBounds(a); const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
    if (distanceToGroundBox(x, z, b.span, frame.position) >= result.cutoff) return false;
    box.min.set(x, -.01, z); box.max.set(x + b.span, .01, z + b.span);
    return frustum.intersectsBox(box) && exactVisible(x, z, b.span);
  };
  const center = new Vector3();
  const copy = Math.floor((origin.meters.x + WORLD / 2) / WORLD);
  const stack: Address[] = [-1, 0, 1].map(offset => ({ z: 0, x: copy + offset, y: 0 }));
  const importance = new Map<string, number>();
  const variable = view.pitch > Math.min(60, 78.5 - camera.fov / 2);
  while (stack.length) {
    const a = stack.pop()!; result.visited++;
    const b = tileBounds(a); const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
    const distance = distanceToGroundBox(x, z, b.span, frame.position);
    if (distance >= result.cutoff) { result.culled++; result.fogCulled++; continue; }
    const pad = b.span * (margin - 1) / 2;
    box.min.set(x - pad, -.01, z - pad); box.max.set(x + b.span + pad, .01, z + b.span + pad);
    if (!frustum.intersectsBox(box)) { result.culled++; continue; }
    const fogT = Math.min(1, Math.max(0, (distance - fog.start) / (fog.end - fog.start)));
    const opacity = fogT * fogT * (3 - 2 * fogT);
    const localZoom = variable ? localTileZoom(view.zoom, frame.distance, distance, frame.position.y, camera.fov) : view.zoom;
    // 清晰区域保持相机对应的数据语义，达到 90% 雾遮挡后才允许远景降级。
    const desired = Math.min(maxZoom, Math.max(minZoom, Math.floor(opacity < .9 ? Math.max(view.zoom, localZoom) : localZoom)));
    if (a.z < desired) { stack.push(...childrenOf(a)); continue; }
    if (!exactVisible(x, z, b.span)) { result.culled++; result.fogCulled++; continue; }
    center.set(x + b.span / 2, 0, z + b.span / 2).project(camera);
    const key = keyOf(a);
    result.priorities.set(key, Math.hypot(center.x, center.y) * 10 + Math.max(0, distance / frame.distance - 1));
    const fade = Math.min(1, Math.max(0, (distance - fog.start) / (fog.end - fog.start)));
    importance.set(key, (b.span * viewport.height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance)) ** 2 * (1 - fade));
    result.leaves.push(a);
  }
  result.ideal = [...result.leaves];
  while (result.leaves.length > maxLeaves) {
    const candidates = new Map<string, { address: Address; cost: number; count: number; priority: number }>();
    for (const leaf of result.leaves) {
      if (leaf.z <= minZoom) continue;
      const parent = parentOf(leaf); const key = keyOf(parent);
      const item = candidates.get(key) ?? { address: parent, cost: 0, count: 0, priority: Infinity };
      item.count++; item.cost += importance.get(keyOf(leaf)) ?? 0;
      item.priority = Math.min(item.priority, result.priorities.get(keyOf(leaf)) ?? 0); candidates.set(key, item);
    }
    const ranked = [...candidates.values()].filter(c => c.count > 1).sort((a, b) => a.cost / (a.count - 1) - b.cost / (b.count - 1));
    if (!ranked.length) break;
    let merged = false;
    for (const best of ranked) {
      if (result.leaves.length <= maxLeaves) break;
      if (result.leaves.some(a => contains(a, best.address))) continue;
      const remaining = result.leaves.filter(a => !contains(best.address, a));
      const removed = result.leaves.length - remaining.length;
      if (removed < 2) continue;
      result.leaves = remaining; result.leaves.push(best.address); result.budgetReduced += removed - 1; merged = true;
      result.priorities.set(keyOf(best.address), best.priority); importance.set(keyOf(best.address), best.cost * 4);
    }
    if (!merged) break;
  }
  result.leaves.sort((a, b) => (result.priorities.get(keyOf(a)) ?? 0) - (result.priorities.get(keyOf(b)) ?? 0));
  return result;
}
