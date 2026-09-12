import { projectLngLat } from '../spatial/mercator.js';
import type { ViewState } from '../types.js';
import {
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

  while (
    samples.length > 2 &&
    latest.timeMs - (samples[0]?.timeMs ?? latest.timeMs) >
      POINTER_SAMPLE_WINDOW_MS
  ) {
    samples.shift();
  }
}

export function estimateReleaseVelocity(
  mode: PointerInteractionMode,
  samples: readonly PointerSample[],
): InteractionVelocity {
  const last = samples.at(-1);
  if (last === undefined) {
    return stoppedVelocity();
  }

  const first = findVelocityStartSample(samples, last);
  const elapsedSeconds = (last.timeMs - first.timeMs) / 1_000;
  if (elapsedSeconds <= 0) {
    return stoppedVelocity();
  }

  if (mode === 'pan') {
    return {
      panX: (last.mercatorX - first.mercatorX) / elapsedSeconds,
      panY: (last.mercatorY - first.mercatorY) / elapsedSeconds,
      bearing: 0,
      pitch: 0,
    };
  }

  return {
    panX: 0,
    panY: 0,
    bearing: shortestBearingDelta(first.bearing, last.bearing) / elapsedSeconds,
    pitch: (last.pitch - first.pitch) / elapsedSeconds,
  };
}

function findVelocityStartSample(
  samples: readonly PointerSample[],
  last: PointerSample,
): PointerSample {
  for (const sample of samples) {
    if (last.timeMs - sample.timeMs <= POINTER_SAMPLE_WINDOW_MS) {
      return sample;
    }
  }

  return samples[0] ?? last;
}

function shortestBearingDelta(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}
