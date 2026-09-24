import { projectLngLat } from '../spatial/mercator.js';
import type { ViewState } from '../types.js';
import {
  MIN_RELEASE_WINDOW_MS,
  POINTER_SAMPLE_WINDOW_MS,
  stoppedVelocity,
} from './inertia.js';
import type { InteractionVelocity } from './inertia.js';

export type PointerInteractionMode = 'pan' | 'rotate';

export interface PointerSample {
  readonly timeMs: number;
  readonly mercatorX: number;
  readonly mercatorY: number;
  readonly bearing: number;
  readonly pitch: number;
}

export function createPointerSample(
  view: ViewState,
  timeMs: number,
): PointerSample {
  const center = projectLngLat(view.center);
  return {
    timeMs,
    mercatorX: center.x,
    mercatorY: center.y,
    bearing: view.bearing,
    pitch: view.pitch,
  };
}

export function recordPointerSample(
  samples: PointerSample[],
  view: ViewState,
  timeMs: number,
): void {
  samples.push(createPointerSample(view, timeMs));
  const latest = samples.at(-1);
  if (latest === undefined) {
    return;
  }

  // 只保留速度窗口内的样本，并额外保留窗口起点之前最近的锚点样本：
  // 锚点定义手势起点与窗口起点的位置，缺少它会让窗口塌缩到最后一小段位移。
  const windowStart = latest.timeMs - POINTER_SAMPLE_WINDOW_MS;
  let anchorIndex = -1;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined || sample.timeMs >= windowStart) {
      anchorIndex = index - 1;
      break;
    }
  }

  if (anchorIndex > 0) {
    samples.splice(0, anchorIndex);
  }
}

/**
 * 释放速度 = 窗口内的时间加权平均速度。
 * 窗口为 [endTimeMs - POINTER_SAMPLE_WINDOW_MS, endTimeMs]（endTimeMs 默认取最后样本），
 * 越出窗口的位移按时间比例截断，落在窗口内但没有位移的静止时间只参与分母。
 * 因此"拖动结束后静止再松手"会被静止时间摊薄，不会沿用拖动速度；
 * 亚帧拖拽由 MIN_RELEASE_WINDOW_MS 兜底，避免微量位移被放大成高速度惯性。
 */
export function estimateReleaseVelocity(
  mode: PointerInteractionMode,
  samples: readonly PointerSample[],
  endTimeMs: number = samples.at(-1)?.timeMs ?? 0,
): InteractionVelocity {
  const first = samples[0];
  if (first === undefined) {
    return stoppedVelocity();
  }

  const startTimeMs = Math.max(endTimeMs - POINTER_SAMPLE_WINDOW_MS, first.timeMs);
  const elapsedSeconds = Math.max(endTimeMs - startTimeMs, MIN_RELEASE_WINDOW_MS) / 1_000;
  let panX = 0;
  let panY = 0;
  let bearing = 0;
  let pitch = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    const segmentMs = current.timeMs - previous.timeMs;
    const overlapMs =
      Math.min(current.timeMs, endTimeMs) - Math.max(previous.timeMs, startTimeMs);
    if (segmentMs <= 0 || overlapMs <= 0) {
      continue;
    }

    const weight = overlapMs / segmentMs;
    panX += (current.mercatorX - previous.mercatorX) * weight;
    panY += (current.mercatorY - previous.mercatorY) * weight;
    bearing += shortestBearingDelta(previous.bearing, current.bearing) * weight;
    pitch += (current.pitch - previous.pitch) * weight;
  }

  if (mode === 'pan') {
    return {
      panX: panX / elapsedSeconds,
      panY: panY / elapsedSeconds,
      bearing: 0,
      pitch: 0,
    };
  }

  return {
    panX: 0,
    panY: 0,
    bearing: bearing / elapsedSeconds,
    pitch: pitch / elapsedSeconds,
  };
}

function shortestBearingDelta(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}
