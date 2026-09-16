import { MAX_MAP_PITCH } from '../spatial/viewState.js';
import type { ViewState } from '../types.js';
import {
  WEB_MERCATOR_WORLD_SIZE,
  projectLngLat,
} from '../spatial/mercator.js';

export interface InteractionVelocity {
  readonly panX: number;
  readonly panY: number;
  readonly bearing: number;
  readonly pitch: number;
}

export interface InteractionDisplacement {
  readonly panX: number;
  readonly panY: number;
  readonly bearing: number;
  readonly pitch: number;
}

export interface InertiaStep {
  readonly displacement: InteractionDisplacement;
  readonly velocity: InteractionVelocity;
}

export const INERTIA_DECAY_PER_SECOND = 6.4;
export const INERTIA_MAX_DURATION_MS = 1_500;
export const POINTER_SAMPLE_WINDOW_MS = 120;

const MIN_PAN_START_PX_PER_SECOND = 40;
const MIN_PAN_STOP_PX_PER_SECOND = 8;
const MAX_PAN_PX_PER_SECOND = 3_200;
const MIN_ROTATE_START_DEGREES_PER_SECOND = 8;
const MIN_ROTATE_STOP_DEGREES_PER_SECOND = 1.5;
const MAX_BEARING_DEGREES_PER_SECOND = 720;
const MAX_PITCH_DEGREES_PER_SECOND = 480;

/** 使用指数衰减的解析积分，避免终点随帧率明显漂移。 */
export function integrateInertiaStep(
  velocity: InteractionVelocity,
  deltaSeconds: number,
  decayPerSecond = INERTIA_DECAY_PER_SECOND,
): InertiaStep {
  if (deltaSeconds <= 0) {
    return {
      displacement: stoppedVelocity(),
      velocity,
    };
  }

  const decay = Math.exp(-decayPerSecond * deltaSeconds);
  const displacementScale = (1 - decay) / decayPerSecond;

  return {
    displacement: {
      panX: velocity.panX * displacementScale,
      panY: velocity.panY * displacementScale,
      bearing: velocity.bearing * displacementScale,
      pitch: velocity.pitch * displacementScale,
    },
    velocity: {
      panX: velocity.panX * decay,
      panY: velocity.panY * decay,
      bearing: velocity.bearing * decay,
      pitch: velocity.pitch * decay,
    },
  };
}

/** 将 release 速度限制到有界范围，防止异常事件产生长距离飞移。 */
export function clampReleaseVelocity(
  velocity: InteractionVelocity,
  view: ViewState,
): InteractionVelocity {
  const metersPerPixel = metersPerCssPixel(view);
  const pan = clampVectorMagnitude(
    velocity.panX,
    velocity.panY,
    MAX_PAN_PX_PER_SECOND * metersPerPixel,
  );

  return {
    panX: pan.x,
    panY: pan.y,
    bearing: clampAbs(velocity.bearing, MAX_BEARING_DEGREES_PER_SECOND),
    pitch: clampAbs(velocity.pitch, MAX_PITCH_DEGREES_PER_SECOND),
  };
}

/** 判断 release 速度是否足以进入惯性，慢速精确操作直接停止。 */
export function shouldStartInertia(
  velocity: InteractionVelocity,
  view: ViewState,
): boolean {
  return !isVelocityBelowThreshold(
    velocity,
    view,
    MIN_PAN_START_PX_PER_SECOND,
    MIN_ROTATE_START_DEGREES_PER_SECOND,
  );
}

/** 判断惯性是否已衰减到停止阈值。 */
export function isInertiaStopped(
  velocity: InteractionVelocity,
  view: ViewState,
): boolean {
  return isVelocityBelowThreshold(
    velocity,
    view,
    MIN_PAN_STOP_PX_PER_SECOND,
    MIN_ROTATE_STOP_DEGREES_PER_SECOND,
  );
}

export function stoppedVelocity(): InteractionVelocity {
  return { panX: 0, panY: 0, bearing: 0, pitch: 0 };
}

/** 纬度或 pitch clamp 命中后清除对应速度分量，避免边界抖动。 */
export function stopClampedVelocity(
  before: ViewState,
  after: ViewState,
  displacement: InteractionDisplacement,
  velocity: InteractionVelocity,
): InteractionVelocity {
  const beforeCenter = projectLngLat(before.center);
  const afterCenter = projectLngLat(after.center);
  const actualPanY = afterCenter.y - beforeCenter.y;
  const panY =
    displacement.panY !== 0 &&
    Math.abs(actualPanY - displacement.panY) >
      Math.max(1e-6, Math.abs(displacement.panY) * 0.5)
      ? 0
      : velocity.panY;
  const pitch =
    (after.pitch === 0 && displacement.pitch < 0) ||
    (after.pitch === MAX_MAP_PITCH && displacement.pitch > 0)
      ? 0
      : velocity.pitch;

  return { ...velocity, panY, pitch };
}

function metersPerCssPixel(
  view: Pick<ViewState, 'zoom'>,
): number {
  const zoomScale = 256 * 2 ** view.zoom;
  return WEB_MERCATOR_WORLD_SIZE / zoomScale;
}

function isVelocityBelowThreshold(
  velocity: InteractionVelocity,
  view: ViewState,
  panPixelsPerSecond: number,
  rotateDegreesPerSecond: number,
): boolean {
  const metersPerPixel = metersPerCssPixel(view);
  const panThreshold = panPixelsPerSecond * metersPerPixel;
  return (
    Math.hypot(velocity.panX, velocity.panY) < panThreshold &&
    Math.abs(velocity.bearing) < rotateDegreesPerSecond &&
    Math.abs(velocity.pitch) < rotateDegreesPerSecond
  );
}

function clampVectorMagnitude(
  x: number,
  y: number,
  maxMagnitude: number,
): { readonly x: number; readonly y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return { x: x * scale, y: y * scale };
}

function clampAbs(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}
