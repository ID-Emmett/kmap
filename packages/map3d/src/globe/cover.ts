import { Box3, Frustum, Matrix4, Scene, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { MapOrigin } from '../spatial/types.js';
import type { ViewState } from '../types.js';
import { childrenOf, keyOf, tileBounds, type Address } from '../streaming/address.js';
import { emptySelection, type Selection } from '../streaming/coveringTiles.js';
import { facesCamera, projectMapPoint, updateProjection } from './projection.js';

/** 球面覆盖在曲面上测试视锥，根瓦片只存在一份地理副本。 */
export function selectGlobeTiles(camera: PerspectiveCamera, origin: MapOrigin, view: ViewState, maxZoom: number, limit: number): Selection {
  const projection = updateProjection(new Scene(), view, origin, true), result = emptySelection();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  const box = new Box3(), point = new Vector3();
  result.fogStart = 1e12; result.fogEnd = result.cutoff = 2e12;
  result.visible = (address: Address) => {
    const b = tileBounds(address); box.makeEmpty(); let facing = false;
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
      point.set(b.west + b.span * x / 4 - origin.meters.x, 0, origin.meters.y - b.north + b.span * y / 4);
      projectMapPoint(point, projection); box.expandByPoint(point); facing ||= facesCamera(point, camera.position, projection);
    }
    // 采样弦的最大弓高作为保守边界，保持地平线边缘瓦片可用。
    box.expandByScalar(projection.origin.w * (1 - Math.cos(Math.PI / (4 * 2 ** address.z))));
    return (address.z <= 2 || facing) && frustum.intersectsBox(box);
  };
  const target = Math.min(maxZoom, Math.max(2, Math.floor(view.zoom))), stack: Address[] = [{ z: 0, x: 0, y: 0 }];
  while (stack.length) {
    const address = stack.pop()!; result.visited++;
    if (!result.visible(address)) { result.culled++; continue; }
    if (address.z < target) { stack.push(...childrenOf(address)); continue; }
    const b = tileBounds(address);
    point.set(b.west + b.span / 2 - origin.meters.x, 0, origin.meters.y - b.north + b.span / 2);
    projectMapPoint(point, projection).project(camera);
    result.priorities.set(keyOf(address), Math.hypot(point.x, point.y) * 10); result.leaves.push(address);
  }
  if (result.leaves.length > limit && target > 0) return selectGlobeTiles(camera, origin, view, target - 1, limit);
  result.leaves.sort((a, b) => result.priorities.get(keyOf(a))! - result.priorities.get(keyOf(b))!);
  result.ideal = [...result.leaves]; return result;
}
