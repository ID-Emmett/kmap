import type { MapCameraFrame } from './mapCamera.js';
import { mercatorPointToScene } from './mapCamera.js';
import type { GroundPoint } from '../nova-tile/coverage/index.js';
import { WEB_MERCATOR_HALF_WORLD_SIZE, WEB_MERCATOR_WORLD_SIZE } from '../spatial/mercator.js';
import type { MapOrigin, MercatorPoint } from '../spatial/types.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewState } from '../types.js';

const FADE_ENABLE_PITCH = 4;
const MAX_FADE_PITCH = 60;
const MAX_FADE_STRENGTH = 0.78;
const MIN_DEPTH_RANGE_RATIO = 0.75;
const FAR_START_MIN = 0.34;
const FAR_START_MAX = 0.52;
const FAR_END = 0.96;

export interface HorizonFadeParameters {
  start: number;
  end: number;
  strength: number;
}

export interface HorizonFadeInput {
  view: ViewState;
  camera: MapCameraFrame;
  origin: MapOrigin;
  footprint: readonly GroundPoint[];
  /** 兼容旧调用方的 Tile 坐标层级；生产 NTE 路径直接传 Mercator 米坐标。 */
  footprintZoom?: number;
}

export const DISABLED_HORIZON_FADE: HorizonFadeParameters = Object.freeze({
  start: 1,
  end: 2,
  strength: 0,
});

/** 从当前相机和地面覆盖推导远景渐隐的 view-space 距离参数。 */
export function calculateHorizonFadeParameters(
  input: HorizonFadeInput,
): HorizonFadeParameters {
  const view = normalizeViewState(input.view);
  const pitchAmount = smoothstepNumber(
    FADE_ENABLE_PITCH,
    MAX_FADE_PITCH,
    view.pitch,
  );
  const targetDepth = finitePositive(input.camera.distance, 1);
  const depthRange = Math.max(
    getFootprintDepthRange(input, targetDepth),
    targetDepth * MIN_DEPTH_RANGE_RATIO,
  );
  const startFactor =
    FAR_START_MAX - (FAR_START_MAX - FAR_START_MIN) * pitchAmount;
  const start = targetDepth + depthRange * startFactor;
  const end = Math.max(
    targetDepth + depthRange * FAR_END,
    start + targetDepth * 0.25,
  );

  return Object.freeze({
    start,
    end,
    strength: MAX_FADE_STRENGTH * pitchAmount,
  });
}

function getFootprintDepthRange(
  input: HorizonFadeInput,
  targetDepth: number,
): number {
  const forward = normalizeVector({
    x: input.camera.target.x - input.camera.position.x,
    y: input.camera.target.y - input.camera.position.y,
    z: input.camera.target.z - input.camera.position.z,
  });
  let farDepth = targetDepth;

  for (const tilePoint of input.footprint) {
    const mercator = input.footprintZoom === undefined ? tilePoint : tilePointToMercator(tilePoint, input.footprintZoom);
    const scene = mercatorPointToScene(mercator, input.origin);
    const depth =
      (scene.x - input.camera.position.x) * forward.x +
      (scene.y - input.camera.position.y) * forward.y +
      (scene.z - input.camera.position.z) * forward.z;

    if (Number.isFinite(depth)) {
      farDepth = Math.max(farDepth, depth);
    }
  }

  return Math.max(0, farDepth - targetDepth);
}

function tilePointToMercator(point: GroundPoint, zoom: number): MercatorPoint {
  const scale = 2 ** zoom;
  return { x: (point.x / scale) * WEB_MERCATOR_WORLD_SIZE - WEB_MERCATOR_HALF_WORLD_SIZE, y: WEB_MERCATOR_HALF_WORLD_SIZE - (point.y / scale) * WEB_MERCATOR_WORLD_SIZE };
}


function normalizeVector(vector: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number } {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (!Number.isFinite(length) || length <= 0) {
    return { x: 0, y: 0, z: -1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function smoothstepNumber(edge0: number, edge1: number, value: number): number {
  if (value <= edge0) {
    return 0;
  }
  if (value >= edge1) {
    return 1;
  }
  const t = (value - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
