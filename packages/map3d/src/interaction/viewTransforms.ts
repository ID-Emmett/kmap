import { PerspectiveCamera, Vector3 } from 'three/webgpu';

import {
  intersectCameraRayWithGroundInto,
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

const scratchCamera = new PerspectiveCamera();
const scratchCenterGround = new Vector3();
const scratchMovedGround = new Vector3();

/** 按屏幕拖拽的地面射线差更新中心，支持 bearing/pitch。 */
export function panViewByPixels(
  view: ViewState,
  viewport: ViewportSize,
  deltaX: number,
  deltaY: number,
): ViewState {
  const normalizedView = normalizeViewState(view);
  const normalizedViewport = normalizeViewport(viewport);
  const originZoom = Math.min(
    MAX_SAFE_TILE_ZOOM,
    Math.floor(normalizedView.zoom),
  );
  const origin = selectMapOrigin(normalizedView.center, originZoom);
  // 交互期间每帧调用一次，复用相机与射线向量，避免逐事件构造 Three 对象。
  const camera = scratchCamera;
  const frame = updateMapCamera(camera, normalizedView, normalizedViewport, origin);
  // 截断距离至少覆盖相机到目标的距离：低缩放或大视口下相机距离可超过世界宽度的数倍，
  // 固定世界倍数会把正常向下射线误判为近地平线并退化成水平截断，平移随即跳变。
  const maxGroundDistance = Math.max(WEB_MERCATOR_WORLD_SIZE * 4, frame.distance * 4);
  const centerGround = intersectCameraRayWithGroundInto(
    scratchCenterGround,
    camera,
    0,
    0,
    maxGroundDistance,
  );
  const movedGround = intersectCameraRayWithGroundInto(
    scratchMovedGround,
    camera,
    (deltaX / normalizedViewport.width) * 2,
    (-deltaY / normalizedViewport.height) * 2,
    maxGroundDistance,
  );
  const centerMercator = projectLngLat(normalizedView.center);
  const centerGroundMercator = sceneGroundToMercator(centerGround, origin);
  const movedGroundMercator = sceneGroundToMercator(movedGround, origin);

  const planar = normalizeViewState(
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
  return planar;
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
