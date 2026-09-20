import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { projectMapPoint, updateProjection } from '../globe/projection.js';
import { intersectCameraRayWithGround, sceneGroundToMercator, updateMapCamera } from '../rendering/mapCamera.js';
import { selectMapOrigin } from '../spatial/mapOrigin.js';
import { projectLngLat, unprojectMercator, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewState, ViewportSize } from '../types.js';

const camera = new PerspectiveCamera(), scene = new Scene(), point = new Vector3();
type XY = { x: number; y: number };

/** 相机、球面权重与文字投影共用同一几何定义。 */
function project(view: ViewState, viewport: ViewportSize, location: XY, globe: boolean): XY {
  const origin = selectMapOrigin(view.center, Math.floor(view.zoom));
  updateMapCamera(camera, view, viewport, origin, globe);
  const projection = updateProjection(scene, view, origin, globe);
  const center = projectLngLat(view.center);
  const x = center.x + ((location.x - center.x + WORLD * 1.5) % WORLD) - WORLD / 2;
  projectMapPoint(point.set(x - origin.meters.x, 0, origin.meters.y - location.y), projection).project(camera);
  return { x: (point.x + 1) * viewport.width / 2, y: (1 - point.y) * viewport.height / 2 };
}

/** 二维牛顿校正以屏幕像素误差收敛，奇异或离屏球面射线返回空。 */
function solve(initial: XY, target: XY, sample: (xy: XY) => XY, step: number): XY | undefined {
  let result = { ...initial };
  for (let n = 0; n < 10; n++) {
    const p = sample(result), ex = target.x - p.x, ey = target.y - p.y;
    if (Math.hypot(ex, ey) < .005) return result;
    const px = sample({ x: result.x + step, y: result.y }), py = sample({ x: result.x, y: result.y + step });
    const ax = (px.x - p.x) / step, ay = (px.y - p.y) / step;
    const bx = (py.x - p.x) / step, by = (py.y - p.y) / step, det = ax * by - ay * bx;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return;
    const dx = (ex * by - ey * bx) / det, dy = (ey * ax - ex * ay) / det;
    if (!Number.isFinite(dx + dy) || Math.hypot(dx, dy) > WORLD / 2) return;
    result = { x: result.x + dx, y: result.y + dy };
  }
  return Math.hypot(sample(result).x - target.x, sample(result).y - target.y) < .1 ? result : undefined;
}

export function locationAtPixel(view: ViewState, viewport: ViewportSize, pixel: XY, globe = false): XY | undefined {
  const origin = selectMapOrigin(view.center, Math.floor(view.zoom));
  updateMapCamera(camera, view, viewport, origin, globe);
  const ground = intersectCameraRayWithGround(camera, pixel.x / viewport.width * 2 - 1, 1 - pixel.y / viewport.height * 2, WORLD * 4);
  const initial = sceneGroundToMercator(ground, origin);
  if (!globe || view.zoom >= 5.5) return initial;
  return solve(initial, pixel, xy => project(view, viewport, xy, globe), Math.max(.1, WORLD / (256 * 2 ** view.zoom)));
}

/** 每个滚轮动画帧固定指针下的地理位置，包含旋转、倾斜和球面过渡。 */
export function zoomAroundPixel(view: ViewState, viewport: ViewportSize, zoom: number, pixel: XY, globe = false): ViewState {
  const next = normalizeViewState({ zoom }, view);
  if (next.zoom === view.zoom) return next;
  if (pixel.x === viewport.width / 2 && pixel.y === viewport.height / 2) return next;
  const anchor = locationAtPixel(view, viewport, pixel, globe);
  if (!anchor) return next;
  if (!globe || Math.min(view.zoom, next.zoom) >= 5.5) {
    const after = locationAtPixel(next, viewport, pixel)!, center = projectLngLat(view.center);
    return normalizeViewState({ center: unprojectMercator({ x: center.x + anchor.x - after.x, y: center.y + anchor.y - after.y }) }, next);
  }
  const center = solve(projectLngLat(next.center), pixel, xy => project(normalizeViewState({ center: unprojectMercator(xy) }, next), viewport, anchor, globe), Math.max(.1, WORLD / (256 * 2 ** zoom)));
  return center ? normalizeViewState({ center: unprojectMercator(center) }, next) : next;
}
