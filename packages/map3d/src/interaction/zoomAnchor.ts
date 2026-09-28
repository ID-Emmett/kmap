import { PerspectiveCamera } from 'three/webgpu';
import { intersectCameraRayWithGround, sceneGroundToMercator, updateMapCamera } from '../rendering/mapCamera.js';
import { selectMapOrigin } from '../spatial/mapOrigin.js';
import { projectLngLat, unprojectMercator, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewState, ViewportSize } from '../types.js';

const camera = new PerspectiveCamera();
type XY = { x: number; y: number };

export function locationAtPixel(view: ViewState, viewport: ViewportSize, pixel: XY): XY | undefined {
  const origin = selectMapOrigin(view.center, Math.floor(view.zoom));
  const frame = updateMapCamera(camera, view, viewport, origin);
  // 与平移使用同一截断口径：低缩放时相机距离超过世界宽度的数倍，固定世界倍数会让锚点求交失真。
  const maxGroundDistance = Math.max(WORLD * 4, frame.distance * 4);
  const ground = intersectCameraRayWithGround(camera, pixel.x / viewport.width * 2 - 1, 1 - pixel.y / viewport.height * 2, maxGroundDistance);
  return sceneGroundToMercator(ground, origin);
}

/** 每个滚轮动画帧固定指针下的地理位置，包含旋转与倾斜。 */
export function zoomAroundPixel(view: ViewState, viewport: ViewportSize, zoom: number, pixel: XY): ViewState {
  const next = normalizeViewState({ zoom }, view);
  if (next.zoom === view.zoom) return next;
  if (pixel.x === viewport.width / 2 && pixel.y === viewport.height / 2) return next;
  const anchor = locationAtPixel(view, viewport, pixel);
  if (!anchor) return next;
  const after = locationAtPixel(next, viewport, pixel)!;
  const center = projectLngLat(view.center);
  return normalizeViewState({ center: unprojectMercator({ x: center.x + anchor.x - after.x, y: center.y + anchor.y - after.y }) }, next);
}
