import type { PerspectiveCamera } from 'three/webgpu';

const CAMERA_PADDING = 1.08;

/** 为单个固定 Tile 建立俯视相机；动态 ViewState 相机由 T007 实现。 */
export function frameFixedTileCamera(
  camera: PerspectiveCamera,
  tileSpanMeters: number,
  aspect: number,
): void {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const verticalHalfFov = (camera.fov * Math.PI) / 360;
  const verticalDistance = tileSpanMeters / (2 * Math.tan(verticalHalfFov));
  const horizontalDistance = verticalDistance / safeAspect;
  const distance = Math.max(verticalDistance, horizontalDistance) * CAMERA_PADDING;

  camera.near = Math.max(0.1, distance / 1000);
  camera.far = distance + tileSpanMeters * 2;
  camera.position.set(0, distance, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
