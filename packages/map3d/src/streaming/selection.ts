import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { ViewportSize, ViewState } from '../types.js';
import { childrenOf, contains, keyOf, parentOf, tileBounds, type Address } from './address.js';

export interface Selection { leaves: Address[]; priorities: Map<string, number>; cutoff: number; fogStart: number; visited: number; culled: number }

/** 视锥、地面距离与投影误差共同限制四叉树遍历。 */
export function selectTiles(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, minZoom: number, maxZoom: number, margin = 1.18, maxLeaves = 80): Selection {
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  const tilt = Math.min(1, Math.max(0, (view.pitch - 25) / 35));
  const cutoff = frame.distance * (4 - 1.2 * tilt * tilt * (3 - 2 * tilt));
  const fogStart = cutoff * .58;
  const leaves: Address[] = [];
  const priorities = new Map<string, number>();
  const box = new Box3(); const center = new Vector3();
  const worldCopy = Math.floor((origin.meters.x + WORLD / 2) / WORLD);
  const stack: Address[] = [-1, 0, 1].map(offset => ({ z: 0, x: worldCopy + offset, y: 0 }));
  let visited = 0; let culled = 0;
  const maximum = Math.min(maxZoom, Math.floor(view.zoom));
  while (stack.length > 0) {
    const a = stack.pop()!; visited++;
    const b = tileBounds(a);
    const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
    const pad = b.span * (margin - 1) / 2;
    box.min.set(x - pad, -1, z - pad); box.max.set(x + b.span + pad, 1, z + b.span + pad);
    const dx = Math.max(x - frame.target.x, 0, frame.target.x - x - b.span);
    const dz = Math.max(z - frame.target.z, 0, frame.target.z - z - b.span);
    if (Math.hypot(dx, dz) >= cutoff || !frustum.intersectsBox(box)) { culled++; continue; }
    center.set(x + b.span / 2, 0, z + b.span / 2);
    const distance = Math.max(camera.position.distanceTo(center) - b.span * .35, frame.distance * .35);
    const pixels = b.span * viewport.height / (2 * Math.tan(Math.PI / 8) * distance);
    // 256 CSS 像素的数据级别与 512 像素纹理提供二倍采样。
    if (a.z < minZoom || (a.z < maximum && pixels > 300)) { stack.push(...childrenOf(a)); continue; }
    leaves.push(a);
    const projected = center.clone().project(camera);
    priorities.set(keyOf(a), Math.hypot(projected.x, projected.y) * 10 + Math.abs(view.zoom - a.z));
  }
  // 远侧兄弟节点合并为父级，保留完整覆盖并限制纹理驻留工作集。
  while (leaves.length > maxLeaves) {
    const candidates = new Map<string, { address: Address; score: number; count: number }>();
    for (const leaf of leaves) {
      if (leaf.z <= minZoom) continue;
      const parent = parentOf(leaf); const key = keyOf(parent);
      const item = candidates.get(key) ?? { address: parent, score: 0, count: 0 };
      item.count++; item.score += priorities.get(keyOf(leaf)) ?? 0; candidates.set(key, item);
    }
    const candidate = [...candidates.values()].filter(c => c.count > 1 && c.address.z >= maximum - 2).sort((a, b) => b.address.z - a.address.z || b.score / b.count - a.score / a.count)[0];
    if (!candidate) break;
    for (let i = leaves.length - 1; i >= 0; i--) if (contains(candidate.address, leaves[i]!)) leaves.splice(i, 1);
    leaves.push(candidate.address); priorities.set(keyOf(candidate.address), candidate.score / candidate.count);
  }
  leaves.sort((a, b) => priorities.get(keyOf(a))! - priorities.get(keyOf(b))!);
  return { leaves, priorities, cutoff, fogStart, visited, culled };
}
