import type { MapCameraFrame } from '../rendering/mapCamera.js';

/** 相机空间距离雾：完全遮挡边界同时供四叉树剔除和 TSL 使用。 */
export function fogDistances(frame: MapCameraFrame, pitch: number) {
  const t = Math.min(1, Math.max(0, (pitch - 20) / 30));
  const blend = t * t * (3 - 2 * t);
  return { start: frame.distance * (12 - 10.55 * blend), end: frame.distance * (16 - 13.6 * blend) };
}

/** 平面包围矩形到相机的最近三维距离，跨雾边界的瓦片保留近侧。 */
export function distanceToGroundBox(x: number, z: number, span: number, camera: MapCameraFrame['position']): number {
  return Math.hypot(Math.max(x - camera.x, 0, camera.x - x - span), camera.y,
    Math.max(z - camera.z, 0, camera.z - z - span));
}
