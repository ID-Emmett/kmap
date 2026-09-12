import {
  Box3,
  Frustum,
  Matrix4,
  PerspectiveCamera,
  Vector3,
} from 'three/webgpu';

import { mercatorPointToScene } from '../rendering/mapCamera.js';
import { normalizeViewport } from '../rendering/viewport.js';
import type { ViewportSize } from '../types.js';
import {
  getTileSpanMeters,
  WEB_MERCATOR_HALF_WORLD_SIZE,
} from './mercator.js';
import { createRenderTileKey } from './tileKey.js';
import type { MapOrigin, RenderTileKey } from './types.js';

/** 创建与 Camera 当前矩阵一致的视锥。 */
export function createCameraFrustum(camera: PerspectiveCamera): Frustum {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
}

/** 判断指定 Tile 的地面包围体是否与 Camera Frustum 相交。 */
export function tileIntersectsCameraFrustum(
  camera: PerspectiveCamera,
  origin: MapOrigin,
  key: RenderTileKey,
): boolean {
  return tileIntersectsFrustum(createCameraFrustum(camera), origin, key);
}

export function tileIntersectsFrustum(
  frustum: Frustum,
  origin: MapOrigin,
  key: RenderTileKey,
): boolean {
  return frustum.intersectsBox(createTileSceneBox(key, origin));
}

/** 估算 Tile 边长投影到视口后的像素尺寸。 */
export function calculateProjectedTileSize(
  camera: PerspectiveCamera,
  viewport: ViewportSize,
  origin: MapOrigin,
  key: RenderTileKey,
): number {
  const normalizedViewport = normalizeViewport(viewport);
  const box = createTileSceneBox(key, origin);
  const distance = Math.max(
    box.distanceToPoint(camera.position),
    camera.near,
  );
  const focalPixels =
    normalizedViewport.height /
    (2 * Math.tan((camera.fov * Math.PI) / 360));
  return (getTileSpanMeters(key.canonical.z) * focalPixels) / distance;
}

/** 计算 Tile 中心与视口中心的屏幕距离。 */
export function calculateTileScreenDistance(
  camera: PerspectiveCamera,
  viewport: ViewportSize,
  origin: MapOrigin,
  key: RenderTileKey,
): number {
  const normalizedViewport = normalizeViewport(viewport);
  const scale = 2 ** key.canonical.z;
  const globalX = key.canonical.x + key.wrap * scale;
  const span = getTileSpanMeters(key.canonical.z);
  const center = {
    x: -WEB_MERCATOR_HALF_WORLD_SIZE + (globalX + 0.5) * span,
    y: WEB_MERCATOR_HALF_WORLD_SIZE - (key.canonical.y + 0.5) * span,
  };
  const scene = mercatorPointToScene(center, origin);
  const projected = new Vector3(scene.x, 0, scene.z).project(camera);
  const pixelX = ((projected.x + 1) / 2) * normalizedViewport.width;
  const pixelY = ((1 - projected.y) / 2) * normalizedViewport.height;
  const distance = Math.hypot(
    pixelX - normalizedViewport.width / 2,
    pixelY - normalizedViewport.height / 2,
  );
  return Number.isFinite(distance) ? distance : Number.MAX_VALUE;
}

export function tilesOverlap(left: RenderTileKey, right: RenderTileKey): boolean {
  return isDescendantOf(left, right) || isDescendantOf(right, left);
}

export function isDescendantOf(
  descendant: RenderTileKey,
  ancestor: RenderTileKey,
): boolean {
  const difference = descendant.canonical.z - ancestor.canonical.z;
  if (
    difference < 0 ||
    descendant.canonical.sourceId !== ancestor.canonical.sourceId
  ) {
    return false;
  }
  const scale = 2 ** difference;
  const descendantGlobalX =
    descendant.canonical.x + descendant.wrap * 2 ** descendant.canonical.z;
  const ancestorGlobalX =
    ancestor.canonical.x + ancestor.wrap * 2 ** ancestor.canonical.z;
  return (
    Math.floor(descendantGlobalX / scale) === ancestorGlobalX &&
    Math.floor(descendant.canonical.y / scale) === ancestor.canonical.y
  );
}

export function getAncestorAtZoom(
  key: RenderTileKey,
  zoom: number,
): RenderTileKey | undefined {
  if (zoom < 0 || zoom > key.canonical.z) {
    return undefined;
  }
  const difference = key.canonical.z - zoom;
  const scale = 2 ** difference;
  const globalX = key.canonical.x + key.wrap * 2 ** key.canonical.z;
  return createRenderTileKey(
    key.canonical.sourceId,
    zoom,
    Math.floor(globalX / scale),
    Math.floor(key.canonical.y / scale),
  );
}

export function areEdgeNeighbors(
  left: RenderTileKey,
  right: RenderTileKey,
): boolean {
  if (left.canonical.sourceId !== right.canonical.sourceId) {
    return false;
  }
  const a = getNormalizedBounds(left);
  const b = getNormalizedBounds(right);
  const epsilon = 1e-12;
  const horizontalEdge =
    (Math.abs(a.maxX - b.minX) <= epsilon ||
      Math.abs(b.maxX - a.minX) <= epsilon) &&
    overlapLength(a.minY, a.maxY, b.minY, b.maxY) > epsilon;
  const verticalEdge =
    (Math.abs(a.maxY - b.minY) <= epsilon ||
      Math.abs(b.maxY - a.minY) <= epsilon) &&
    overlapLength(a.minX, a.maxX, b.minX, b.maxX) > epsilon;
  return horizontalEdge || verticalEdge;
}

function createTileSceneBox(key: RenderTileKey, origin: MapOrigin): Box3 {
  const scale = 2 ** key.canonical.z;
  const globalX = key.canonical.x + key.wrap * scale;
  const span = getTileSpanMeters(key.canonical.z);
  const west = -WEB_MERCATOR_HALF_WORLD_SIZE + globalX * span;
  const east = west + span;
  const north = WEB_MERCATOR_HALF_WORLD_SIZE - key.canonical.y * span;
  const south = north - span;
  const northwest = mercatorPointToScene({ x: west, y: north }, origin);
  const southeast = mercatorPointToScene({ x: east, y: south }, origin);
  const heightEpsilon = Math.max(1e-3, span * 1e-9);

  return new Box3(
    new Vector3(northwest.x, -heightEpsilon, northwest.z),
    new Vector3(southeast.x, heightEpsilon, southeast.z),
  );
}

function getNormalizedBounds(key: RenderTileKey): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const scale = 2 ** key.canonical.z;
  const globalX = key.canonical.x + key.wrap * scale;
  return {
    minX: globalX / scale,
    maxX: (globalX + 1) / scale,
    minY: key.canonical.y / scale,
    maxY: (key.canonical.y + 1) / scale,
  };
}

function overlapLength(
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): number {
  return Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin);
}
