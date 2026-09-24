import { GLOBE_START } from '../globe/globeCamera.js';
import {
  PerspectiveCamera,
  Vector3,
} from 'three/webgpu';

import { normalizeViewport } from './viewport.js';
import {
  projectLngLat,
  WEB_MERCATOR_WORLD_SIZE,
} from '../spatial/mercator.js';
import type { MapOrigin, MercatorPoint } from '../spatial/types.js';
import { MAX_SAFE_TILE_ZOOM } from '../spatial/validation.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewportSize, ViewState } from '../types.js';

export const MAP_CAMERA_FOV = 45;
export const MAP_TILE_SIZE_PIXELS = 256;

export interface MapCameraFrame {
  position: Readonly<{ x: number; y: number; z: number }>;
  target: Readonly<{ x: number; y: number; z: number }>;
  up: Readonly<{ x: number; y: number; z: number }>;
  distance: number;
  metersPerPixel: number;
}

/** 以 256px XYZ zoom 语义计算赤道投影平面上的米/像素。 */
export function getMapMetersPerPixel(zoom: number): number {
  const normalized = normalizeViewState({ zoom });
  const renderZoom = Math.min(normalized.zoom, MAX_SAFE_TILE_ZOOM);
  return (
    WEB_MERCATOR_WORLD_SIZE /
    (MAP_TILE_SIZE_PIXELS * 2 ** renderZoom)
  );
}

/** 从 ViewState、viewport 和浮动原点推导 Three.js PerspectiveCamera。 */
export function updateMapCamera(
  camera: PerspectiveCamera,
  view: ViewState,
  viewport: ViewportSize,
  origin: MapOrigin,
  globe = false,
): MapCameraFrame {
  const normalizedView = normalizeViewState(view);
  const normalizedViewport = normalizeViewport(viewport);
  const center = projectLngLat(normalizedView.center);
  const target = mercatorPointToScene(center, origin);
  const metersPerPixel = getMapMetersPerPixel(normalizedView.zoom);
  const verticalSpan = metersPerPixel * normalizedViewport.height;
  const halfFovRadians = (MAP_CAMERA_FOV * Math.PI) / 360;
  let distance = verticalSpan / (2 * Math.tan(halfFovRadians));
  if (globe && normalizedView.zoom < GLOBE_START) {
    const radius = WEB_MERCATOR_WORLD_SIZE / (2 * Math.PI * Math.cos(normalizedView.center.lat * Math.PI / 180));
    const fit = 1 / Math.sin(Math.atan(Math.tan(halfFovRadians) * Math.min(1, normalizedViewport.width / normalizedViewport.height))) / .82;
    const start = getMapMetersPerPixel(GLOBE_START) * normalizedViewport.height / (2 * Math.tan(halfFovRadians));
    distance = radius * (fit - 1) * (start / (radius * (fit - 1))) ** (normalizedView.zoom / GLOBE_START);
  }
  const pitch = (normalizedView.pitch * Math.PI) / 180 * (globe ? Math.min(1, normalizedView.zoom / GLOBE_START) : 1);
  const bearing = (normalizedView.bearing * Math.PI) / 180;
  const horizontalDistance = Math.sin(pitch) * distance;
  const verticalDistance = Math.cos(pitch) * distance;
  const sinBearing = Math.sin(bearing);
  const cosBearing = Math.cos(bearing);
  const position = {
    x: target.x - sinBearing * horizontalDistance,
    y: target.y + verticalDistance,
    z: target.z + cosBearing * horizontalDistance,
  };
  const up = {
    x: sinBearing * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -cosBearing * Math.cos(pitch),
  };

  camera.fov = MAP_CAMERA_FOV;
  camera.aspect = normalizedViewport.width / normalizedViewport.height;
  camera.near = distance / 10_000;
  camera.far = distance * 16;
  camera.position.set(position.x, position.y, position.z);
  camera.up.set(up.x, up.y, up.z);
  camera.lookAt(target.x, target.y, target.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return Object.freeze({
    position: Object.freeze(position),
    target: Object.freeze(target),
    up: Object.freeze(up),
    distance,
    metersPerPixel,
  });
}

/** 将场景中的地面点还原为全局 Web Mercator 米坐标。 */
export function sceneGroundToMercator(
  point: Readonly<{ x: number; z: number }>,
  origin: MapOrigin,
): MercatorPoint {
  return {
    x: origin.meters.x + point.x,
    y: origin.meters.y - point.z,
  };
}

/** 将全局 Web Mercator 米坐标转换到当前浮动原点场景。 */
export function mercatorPointToScene(
  point: MercatorPoint,
  origin: MapOrigin,
): { x: number; y: number; z: number } {
  return {
    x: point.x - origin.meters.x,
    y: 0,
    z: origin.meters.y - point.y,
  };
}

/** 计算 NDC 射线与地图平面交点；近地平线时按有限距离截断。 */
export function intersectCameraRayWithGround(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  maxGroundDistance: number,
): Vector3 {
  return intersectCameraRayWithGroundInto(
    new Vector3(),
    camera,
    ndcX,
    ndcY,
    maxGroundDistance,
  );
}

/** 复用输出向量与模块级临时向量，供逐帧交互路径使用；调用不可重入。 */
export function intersectCameraRayWithGroundInto(
  out: Vector3,
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  maxGroundDistance: number,
): Vector3 {
  if (!Number.isFinite(maxGroundDistance) || maxGroundDistance <= 0) {
    throw new RangeError('maxGroundDistance 必须是正有限数值。');
  }

  const direction = groundDirection
    .set(ndcX, ndcY, 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  const epsilon = 1e-9;

  if (direction.y < -epsilon) {
    const distance = -camera.position.y / direction.y;

    if (Number.isFinite(distance) && distance <= maxGroundDistance) {
      return out.copy(direction).multiplyScalar(distance).add(camera.position);
    }
  }

  const horizontal = groundHorizontal.set(direction.x, 0, direction.z);
  if (horizontal.lengthSq() < epsilon) {
    camera.getWorldDirection(horizontal);
    horizontal.y = 0;
  }
  horizontal.normalize().multiplyScalar(maxGroundDistance);
  return out.set(
    camera.position.x + horizontal.x,
    0,
    camera.position.z + horizontal.z,
  );
}

const groundDirection = new Vector3();
const groundHorizontal = new Vector3();
