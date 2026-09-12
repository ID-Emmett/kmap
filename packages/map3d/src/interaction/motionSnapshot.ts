import {
  projectLngLat,
  unprojectMercator,
} from '../spatial/mercator.js';
import { normalizeViewState } from '../spatial/viewState.js';
import type { ViewState } from '../types.js';
import type { InteractionVelocity } from './inertia.js';

export type InteractionMotionPhase = 'active' | 'settling' | 'idle';

export interface InteractionMotionVelocity extends InteractionVelocity {
  readonly zoom: number;
}

export interface InteractionMotionSnapshot {
  readonly phase: InteractionMotionPhase;
  readonly timeMs: number;
  readonly velocity: InteractionMotionVelocity;
}

/** 创建供 Tile 调度使用的内部相机运动快照。 */
export function createInteractionMotionSnapshot(
  phase: InteractionMotionPhase,
  timeMs: number,
  velocity: InteractionVelocity,
  zoom = 0,
): InteractionMotionSnapshot {
  return Object.freeze({
    phase,
    timeMs,
    velocity: Object.freeze({ ...velocity, zoom }),
  });
}

export function createIdleMotionSnapshot(
  timeMs = 0,
): InteractionMotionSnapshot {
  return createInteractionMotionSnapshot(
    'idle',
    timeMs,
    { panX: 0, panY: 0, bearing: 0, pitch: 0 },
  );
}

/** 按短时间恒速外推 ViewState；结果仍遵守公共 ViewState 约束。 */
export function predictViewFromMotion(
  view: ViewState,
  snapshot: InteractionMotionSnapshot,
  lookaheadMs: number,
): ViewState {
  if (snapshot.phase === 'idle' || lookaheadMs <= 0) {
    return normalizeViewState(view);
  }

  const seconds = lookaheadMs / 1_000;
  const center = projectLngLat(view.center);
  return normalizeViewState(
    {
      center: unprojectMercator({
        x: center.x + snapshot.velocity.panX * seconds,
        y: center.y + snapshot.velocity.panY * seconds,
      }),
      zoom: view.zoom + snapshot.velocity.zoom * seconds,
      bearing: view.bearing + snapshot.velocity.bearing * seconds,
      pitch: view.pitch + snapshot.velocity.pitch * seconds,
    },
    view,
  );
}

