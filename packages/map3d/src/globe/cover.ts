import { fogDistances } from '../streaming/fog.js';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import { Box3, Frustum, Matrix4, Scene, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { MapOrigin } from '../spatial/types.js';
import type { ViewState } from '../types.js';
import { childrenOf, keyOf, tileBounds, type Address } from '../streaming/address.js';
import { emptySelection, type Selection } from '../streaming/coveringTiles.js';
import { projectMapPoint, updateProjection } from './projection.js';

/** 球面覆盖在曲面上测试视锥，根瓦片只存在一份地理副本。 */
export function selectGlobeTiles(camera: PerspectiveCamera, origin: MapOrigin, view: ViewState, maxZoom: number, limit: number, frame?: MapCameraFrame, targetZoom = Math.floor(view.zoom)): Selection {
  const projection = updateProjection(new Scene(), view, origin, true), result = emptySelection();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  const box = new Box3(), point = new Vector3();
  const earth = new Vector3(projection.center.x, -projection.origin.w, projection.center.y);
  const horizon = camera.position.clone().sub(earth), horizonOffset = projection.origin.w ** 2 / horizon.length(); horizon.normalize();
  const horizonConstant = -horizonOffset - earth.dot(horizon);
  const fog = frame ? fogDistances(frame, view.pitch) : { start: 1e12, end: 2e12 };
  result.fogStart = fog.start; result.fogEnd = result.cutoff = fog.end;
  const visibility = new Map<string, boolean>();
  result.visible = (address: Address) => {
    const key = keyOf(address), cached = visibility.get(key); if (cached !== undefined) return cached;
    const b = tileBounds(address); box.makeEmpty();
    const steps = address.z < 6 ? 4 : 2;
    for (let y = 0; y <= steps; y++) for (let x = 0; x <= steps; x++) {
      point.set(b.west + b.span * x / steps - origin.meters.x, 0, origin.meters.y - b.north + b.span * y / steps);
      projectMapPoint(point, projection); box.expandByPoint(point);
    }
    // 采样弦的最大弓高作为保守边界，保持地平线边缘瓦片可用。
    box.expandByScalar(projection.origin.w * Math.PI ** 2 / (steps ** 2 * 4 ** address.z));
    const horizonMax = horizon.x * (horizon.x >= 0 ? box.max.x : box.min.x)
      + horizon.y * (horizon.y >= 0 ? box.max.y : box.min.y) + horizon.z * (horizon.z >= 0 ? box.max.z : box.min.z) + horizonConstant;
    const visible = horizonMax >= 0 && box.distanceToPoint(camera.position) < result.cutoff && frustum.intersectsBox(box);
    visibility.set(key, visible); return visible;
  };
  const target = Math.min(maxZoom, Math.max(2, targetZoom)), stack: Address[] = [{ z: 0, x: 0, y: 0 }];
  while (stack.length) {
    const address = stack.pop()!; result.visited++;
    if (!result.visible(address)) { result.culled++; continue; }
    if (address.z < target) { stack.push(...childrenOf(address)); continue; }
    const b = tileBounds(address);
    point.set(b.west + b.span / 2 - origin.meters.x, 0, origin.meters.y - b.north + b.span / 2);
    projectMapPoint(point, projection).project(camera);
    result.priorities.set(keyOf(address), Math.hypot(point.x, point.y) * 10); result.leaves.push(address);
  }
  if (result.leaves.length > limit && target > 0) return selectGlobeTiles(camera, origin, view, target - 1, limit, frame, targetZoom);
  result.leaves.sort((a, b) => result.priorities.get(keyOf(a))! - result.priorities.get(keyOf(b))!);
  result.ideal = [...result.leaves]; return result;
}
