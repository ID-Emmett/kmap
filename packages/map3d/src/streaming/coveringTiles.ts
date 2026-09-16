import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { ViewportSize, ViewState } from '../types.js';
import { childrenOf, keyOf, tileBounds, type Address } from './address.js';
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
/** 视锥和完全入雾剔除先于细分，同一视图的目标瓦片使用单一层级。 */
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
  const desired = Math.min(maxZoom, Math.max(minZoom, Math.floor(view.zoom)));
  while (stack.length) {
    const a = stack.pop()!; result.visited++;
    const b = tileBounds(a); const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
    const distance = distanceToGroundBox(x, z, b.span, frame.position);
    if (distance >= result.cutoff) { result.culled++; result.fogCulled++; continue; }
    const pad = b.span * (margin - 1) / 2;
    box.min.set(x - pad, -.01, z - pad); box.max.set(x + b.span + pad, .01, z + b.span + pad);
    if (!frustum.intersectsBox(box)) { result.culled++; continue; }
    if (a.z < desired) { stack.push(...childrenOf(a)); continue; }
    if (!exactVisible(x, z, b.span)) { result.culled++; result.fogCulled++; continue; }
    center.set(x + b.span / 2, 0, z + b.span / 2).project(camera);
    const key = keyOf(a);
    result.priorities.set(key, Math.hypot(center.x, center.y) * 10 + Math.max(0, distance / frame.distance - 1));
    result.leaves.push(a);
  }
  result.ideal = [...result.leaves];
  // 容量不足时整体选取一个父层级，所有区域保持相同数据层级。
  if (result.leaves.length > maxLeaves && desired > minZoom) {
    const coarser = selectTiles(camera, frame, origin, view, viewport, minZoom, desired - 1, margin, maxLeaves);
    coarser.ideal = result.ideal;
    coarser.budgetReduced = result.ideal.length - coarser.leaves.length;
    return coarser;
  }
  result.leaves.sort((a, b) => (result.priorities.get(keyOf(a)) ?? 0) - (result.priorities.get(keyOf(b)) ?? 0));
  return result;
}
