import { PerspectiveCamera, Vector3 } from 'three/webgpu';

import {
  intersectCameraRayWithGround,
  sceneGroundToMercator,
  updateMapCamera,
} from '../rendering/mapCamera.js';
import { normalizeViewport } from '../rendering/viewport.js';
import {
  WEB_MERCATOR_WORLD_SIZE,
  projectLngLat,
  unprojectMercator,
} from '../spatial/mercator.js';
import { selectMapOrigin } from '../spatial/mapOrigin.js';
import { MAX_SAFE_TILE_ZOOM } from '../spatial/validation.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewportSize, ViewState } from '../types.js';
import type { InteractionDisplacement } from './inertia.js';

/** 按屏幕拖拽的地面射线差更新中心，支持 bearing/pitch。 */
export function panViewByPixels(
  view: ViewState,
  viewport: ViewportSize,
  deltaX: number,
  deltaY: number,
  globe = false,
): ViewState {
  const normalizedView = normalizeViewState(view);
  const normalizedViewport = normalizeViewport(viewport);
  const originZoom = Math.min(
    MAX_SAFE_TILE_ZOOM,
    Math.floor(normalizedView.zoom),
  );
  const origin = selectMapOrigin(normalizedView.center, originZoom);
  const camera = new PerspectiveCamera();
  updateMapCamera(camera, normalizedView, normalizedViewport, origin, globe);
  if (globe) {
    const radius = WEB_MERCATOR_WORLD_SIZE / (2 * Math.PI * Math.cos(normalizedView.center.lat * Math.PI / 180));
    const c = projectLngLat(normalizedView.center), cx = c.x - origin.meters.x, cz = origin.meters.y - c.y;
    const ray = new Vector3(deltaX / normalizedViewport.width * 2, -deltaY / normalizedViewport.height * 2, .5).unproject(camera).sub(camera.position).normalize();
    const from = camera.position.clone().sub(new Vector3(cx, -radius, cz));
    const dot = from.dot(ray), discriminant = dot * dot - (from.lengthSq() - radius * radius);
    const hit = from.addScaledVector(ray, -dot - Math.sqrt(Math.max(0, discriminant))).normalize();
    const lat = normalizedView.center.lat * Math.PI / 180, s = Math.sin(lat), c0 = Math.cos(lat);
    const deltaLng = Math.atan2(hit.x, hit.y * c0 + hit.z * s) * 180 / Math.PI;
    const hitLat = Math.asin(Math.max(-1, Math.min(1, hit.y * s - hit.z * c0))) * 180 / Math.PI;
    return normalizeViewState({ center: { lng: normalizedView.center.lng - deltaLng,
      lat: normalizedView.center.lat * 2 - hitLat } }, normalizedView);
  }
  const maxGroundDistance = WEB_MERCATOR_WORLD_SIZE * 4;
  const centerGround = intersectCameraRayWithGround(
    camera,
    0,
    0,
    maxGroundDistance,
  );
  const movedGround = intersectCameraRayWithGround(
    camera,
    (deltaX / normalizedViewport.width) * 2,
    (-deltaY / normalizedViewport.height) * 2,
    maxGroundDistance,
  );
  const centerMercator = projectLngLat(normalizedView.center);
  const centerGroundMercator = sceneGroundToMercator(centerGround, origin);
  const movedGroundMercator = sceneGroundToMercator(movedGround, origin);

  return normalizeViewState(
    {
      center: unprojectMercator({
        x:
          centerMercator.x +
          centerGroundMercator.x -
          movedGroundMercator.x,
        y:
          centerMercator.y +
          centerGroundMercator.y -
          movedGroundMercator.y,
      }),
    },
    normalizedView,
  );
}

/** 水平拖拽改变 bearing，垂直向上拖拽增加 pitch。 */
export function rotateViewByPixels(
  view: ViewState,
  deltaX: number,
  deltaY: number,
): ViewState {
  return normalizeViewState(
    {
      bearing: view.bearing + deltaX * 0.25,
      pitch: view.pitch - deltaY * 0.2,
    },
    view,
  );
}

/** 将 Wheel deltaMode 归一化为像素后更新连续 zoom。 */
export function zoomViewByWheel(
  view: ViewState,
  deltaY: number,
  deltaMode: number,
  viewport: ViewportSize,
): ViewState {
  return normalizeViewState(
    { zoom: view.zoom + getWheelZoomDelta(deltaY, deltaMode, viewport) },
    view,
  );
}

export function getWheelZoomDelta(
  deltaY: number,
  deltaMode: number,
  viewport: ViewportSize,
): number {
  const normalizedViewport = normalizeViewport(viewport);
  const pixelDelta = deltaMode === 1
    ? deltaY * 16
    : deltaMode === 2
      ? deltaY * normalizedViewport.height
      : deltaY;
  return Math.max(-1, Math.min(1, -pixelDelta / 400));
}

export function applyInertiaDisplacement(
  view: ViewState,
  displacement: InteractionDisplacement,
): ViewState {
  const center = projectLngLat(view.center);
  return normalizeViewState(
    {
      center: unprojectMercator({
        x: center.x + displacement.panX,
        y: center.y + displacement.panY,
      }),
      bearing: view.bearing + displacement.bearing,
      pitch: view.pitch + displacement.pitch,
    },
    view,
  );
}
