import type { MapInteractionControllerOptions, InteractionFrameScheduler } from './mapInteractions.js';
import type { PointerInteractionMode } from './pointerVelocity.js';

// 80 ms 指数时间常数使滚轮在不同刷新率下具有相同轨迹，约 240 ms 完成 95%。
const WHEEL_ZOOM_TIME_CONSTANT_MS = 80;

export function getPointerMode(
  event: Pick<PointerEvent, 'button' | 'shiftKey'>,
): PointerInteractionMode | undefined {
  if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
    return 'rotate';
  }
  if (event.button === 0) {
    return 'pan';
  }
  return undefined;
}

export function takeWheelZoomStep(pendingDelta: number, elapsedMs: number): number {
  if (Math.abs(pendingDelta) <= .001) {
    return pendingDelta;
  }

  return pendingDelta * (1 - Math.exp(-elapsedMs / WHEEL_ZOOM_TIME_CONSTANT_MS));
}

export function getEventTime(
  event: Pick<Event, 'timeStamp'>,
  scheduler: InteractionFrameScheduler,
): number {
  const now = scheduler.now();
  const timestamp = event.timeStamp;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return now;
  }

  // 浏览器自动化和部分兼容层可能提供非同源或停滞的 timeStamp。
  if (Math.abs(timestamp - now) > 60_000) {
    return now;
  }

  return Math.max(timestamp, now);
}

export function createDefaultFrameScheduler(): InteractionFrameScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => {
      if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
      }

      return setTimeout(() => callback(performance.now()), 16);
    },
    cancelFrame: (handle) => {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(handle as number);
        return;
      }

      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

export function releasePointerCapture(
  target: MapInteractionControllerOptions['target'],
  pointerId: number,
): void {
  if (target.hasPointerCapture?.(pointerId) === false) {
    return;
  }

  try {
    target.releasePointerCapture?.(pointerId);
  } catch {
    // pointercancel/lostpointercapture 可能已由浏览器隐式释放。
  }
}
