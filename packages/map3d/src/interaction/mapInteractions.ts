import type { ViewportSize, ViewState } from '../types.js';
import {
  INERTIA_MAX_DURATION_MS,
  clampReleaseVelocity,
  integrateInertiaStep,
  isInertiaStopped,
  shouldStartInertia,
  stopClampedVelocity,
} from './inertia.js';
import type { InteractionVelocity } from './inertia.js';
import {
  createIdleMotionSnapshot,
  createInteractionMotionSnapshot,
} from './motionSnapshot.js';
import type { InteractionMotionSnapshot } from './motionSnapshot.js';
import {
  createPointerSample,
  estimateReleaseVelocity,
  recordPointerSample,
} from './pointerVelocity.js';
import type {
  PointerInteractionMode,
  PointerSample,
} from './pointerVelocity.js';
import {
  applyInertiaDisplacement,
  getWheelZoomDelta,
  panViewByPixels,
  rotateViewByPixels,
} from './viewTransforms.js';

export {
  applyInertiaDisplacement,
  panViewByPixels,
  rotateViewByPixels,
  zoomViewByWheel,
} from './viewTransforms.js';

type FrameHandle = unknown;

interface InteractionEventTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface InteractionLifecycleTarget extends InteractionEventTarget {
  readonly visibilityState?: DocumentVisibilityState;
}

interface InteractionTarget extends InteractionEventTarget {
  readonly ownerDocument?: InteractionLifecycleTarget;
  setPointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
  releasePointerCapture?(pointerId: number): void;
}

export interface InteractionFrameScheduler {
  now: () => number;
  requestFrame: (callback: (timeMs: number) => void) => FrameHandle;
  cancelFrame: (handle: FrameHandle) => void;
}

export interface MapInteractionControllerOptions {
  target: InteractionTarget;
  getView: () => ViewState;
  setView: (view: Partial<ViewState>) => void;
  getViewport: () => ViewportSize;
  reducedMotion?: boolean;
  frameScheduler?: InteractionFrameScheduler;
  lifecycleTarget?: InteractionLifecycleTarget;
  isPageHidden?: () => boolean;
  onMotion?: (snapshot: InteractionMotionSnapshot) => void;
}

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  mode: PointerInteractionMode;
  samples: PointerSample[];
}

interface InertiaState {
  velocity: InteractionVelocity;
  lastFrameTimeMs: number;
  readonly startedAtMs: number;
  frame: FrameHandle | undefined;
}

const WHEEL_ZOOM_STEP_PER_FRAME = 0.35;
const WHEEL_ZOOM_EPSILON = 1e-6;

/** 地图鼠标控制：拖拽跟手、释放阻尼、滚轮逐帧缩放。 */
export class MapInteractionController {
  readonly #options: MapInteractionControllerOptions;
  readonly #scheduler: InteractionFrameScheduler;
  readonly #lifecycleTarget: InteractionLifecycleTarget | undefined;
  readonly #isPageHidden: () => boolean;
  #active: ActivePointer | undefined;
  #inertia: InertiaState | undefined;
  #wheelFrame: FrameHandle | undefined;
  #pendingWheelZoomDelta = 0;
  #lastWheelFrameTimeMs: number | undefined;
  #disposed = false;

  constructor(options: MapInteractionControllerOptions) {
    this.#options = options;
    this.#scheduler = options.frameScheduler ?? createDefaultFrameScheduler();
    this.#lifecycleTarget = options.lifecycleTarget ?? options.target.ownerDocument;
    this.#isPageHidden =
      options.isPageHidden ??
      (() => this.#lifecycleTarget?.visibilityState === 'hidden');
    options.target.addEventListener('pointerdown', this.#onPointerDown);
    options.target.addEventListener('pointermove', this.#onPointerMove);
    options.target.addEventListener('pointerup', this.#onPointerEnd);
    options.target.addEventListener('pointercancel', this.#onPointerEnd);
    options.target.addEventListener('lostpointercapture', this.#onLostPointerCapture);
    options.target.addEventListener('wheel', this.#onWheel, { passive: false });
    options.target.addEventListener('contextmenu', this.#onContextMenu);
    this.#lifecycleTarget?.addEventListener(
      'visibilitychange',
      this.#onPageVisibilityChange,
    );
  }

  /** 外部 setView、dispose 或页面失活时取消内部动画。 */
  cancelMotion(): void {
    const hadMotion =
      this.#inertia !== undefined ||
      this.#wheelFrame !== undefined ||
      this.#pendingWheelZoomDelta !== 0;
    this.#cancelInertia();
    this.#cancelWheel();
    if (hadMotion) {
      this.#emitIdleMotion();
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.cancelMotion();
    const target = this.#options.target;
    target.removeEventListener('pointerdown', this.#onPointerDown);
    target.removeEventListener('pointermove', this.#onPointerMove);
    target.removeEventListener('pointerup', this.#onPointerEnd);
    target.removeEventListener('pointercancel', this.#onPointerEnd);
    target.removeEventListener('lostpointercapture', this.#onLostPointerCapture);
    target.removeEventListener('wheel', this.#onWheel);
    target.removeEventListener('contextmenu', this.#onContextMenu);
    this.#lifecycleTarget?.removeEventListener(
      'visibilitychange',
      this.#onPageVisibilityChange,
    );
    if (this.#active !== undefined) {
      releasePointerCapture(target, this.#active.id);
    }
    this.#active = undefined;
  }

  readonly #onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    const mode = getPointerMode(pointer);

    if (
      this.#disposed ||
      this.#active !== undefined ||
      mode === undefined ||
      this.#isPageHidden()
    ) {
      return;
    }

    event.preventDefault();
    this.cancelMotion();
    const timeMs = getEventTime(pointer, this.#scheduler);
    const view = this.#options.getView();
    this.#active = {
      id: pointer.pointerId,
      x: pointer.clientX,
      y: pointer.clientY,
      mode,
      samples: [createPointerSample(view, timeMs)],
    };
    this.#emitMotion(
      createInteractionMotionSnapshot(
        'active',
        timeMs,
        stoppedInteractionVelocity(),
      ),
    );
    this.#options.target.setPointerCapture?.(pointer.pointerId);
  };

  readonly #onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    const active = this.#active;

    if (
      this.#disposed ||
      active === undefined ||
      pointer.pointerId !== active.id
    ) {
      return;
    }

    const deltaX = pointer.clientX - active.x;
    const deltaY = pointer.clientY - active.y;
    active.x = pointer.clientX;
    active.y = pointer.clientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    event.preventDefault();
    const view = this.#options.getView();
    const next = active.mode === 'pan'
      ? panViewByPixels(view, this.#options.getViewport(), deltaX, deltaY)
      : rotateViewByPixels(view, deltaX, deltaY);
    const timeMs = getEventTime(pointer, this.#scheduler);
    recordPointerSample(
      active.samples,
      next,
      timeMs,
    );
    this.#emitMotion(
      createInteractionMotionSnapshot(
        'active',
        timeMs,
        estimateReleaseVelocity(active.mode, active.samples),
      ),
    );
    this.#setViewFromInteraction(next);
  };

  readonly #onPointerEnd = (event: Event): void => {
    const pointer = event as PointerEvent;
    const active = this.#active;

    if (active?.id !== pointer.pointerId) {
      return;
    }

    releasePointerCapture(this.#options.target, pointer.pointerId);
    this.#active = undefined;
    if (event.type === 'pointerup') {
      const started = this.#startInertia(
        active,
        getEventTime(pointer, this.#scheduler),
      );
      if (!started) {
        this.#emitIdleMotion();
      }
    } else {
      this.#emitIdleMotion();
    }
  };

  readonly #onLostPointerCapture = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.#active?.id === pointer.pointerId) {
      this.#active = undefined;
      this.#emitIdleMotion();
    }
  };

  readonly #onWheel = (event: Event): void => {
    if (this.#disposed) {
      return;
    }

    const wheel = event as WheelEvent;
    event.preventDefault();
    if (this.#isPageHidden()) {
      return;
    }

    this.#cancelInertia();
    this.#pendingWheelZoomDelta += getWheelZoomDelta(
      wheel.deltaY,
      wheel.deltaMode,
      this.#options.getViewport(),
    );
    this.#lastWheelFrameTimeMs ??= this.#scheduler.now();
    this.#scheduleWheelFrame();
  };

  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  readonly #onPageVisibilityChange = (): void => {
    if (!this.#isPageHidden()) {
      return;
    }

    this.cancelMotion();
    if (this.#active !== undefined) {
      releasePointerCapture(this.#options.target, this.#active.id);
      this.#active = undefined;
      this.#emitIdleMotion();
    }
  };

  readonly #onInertiaFrame = (timeMs: number): void => {
    const inertia = this.#inertia;
    if (inertia === undefined) {
      return;
    }

    inertia.frame = undefined;
    if (this.#disposed || this.#isPageHidden()) {
      this.#cancelInertia();
      if (!this.#disposed) {
        this.#emitIdleMotion(timeMs);
      }
      return;
    }

    const deltaSeconds = Math.max(
      0,
      (timeMs - inertia.lastFrameTimeMs) / 1_000,
    );
    inertia.lastFrameTimeMs = timeMs;

    if (deltaSeconds > 0) {
      const before = this.#options.getView();
      const step = integrateInertiaStep(inertia.velocity, deltaSeconds);
      const next = applyInertiaDisplacement(before, step.displacement);
      this.#emitMotion(
        createInteractionMotionSnapshot(
          'settling',
          timeMs,
          step.velocity,
        ),
      );
      this.#setViewFromInteraction(next);
      const after = this.#options.getView();
      inertia.velocity = stopClampedVelocity(
        before,
        after,
        step.displacement,
        step.velocity,
      );
    }

    if (
      timeMs - inertia.startedAtMs >= INERTIA_MAX_DURATION_MS ||
      isInertiaStopped(
        inertia.velocity,
        this.#options.getView(),
      )
    ) {
      this.#inertia = undefined;
      this.#emitIdleMotion(timeMs);
      return;
    }

    this.#scheduleInertiaFrame();
  };

  readonly #onWheelFrame = (timeMs: number): void => {
    this.#wheelFrame = undefined;
    if (this.#disposed || this.#isPageHidden()) {
      this.#pendingWheelZoomDelta = 0;
      this.#lastWheelFrameTimeMs = undefined;
      if (!this.#disposed) {
        this.#emitIdleMotion(timeMs);
      }
      return;
    }

    const zoomDelta = takeWheelZoomStep(this.#pendingWheelZoomDelta);
    this.#pendingWheelZoomDelta -= zoomDelta;
    if (Math.abs(this.#pendingWheelZoomDelta) < WHEEL_ZOOM_EPSILON) {
      this.#pendingWheelZoomDelta = 0;
    }

    if (zoomDelta !== 0) {
      const view = this.#options.getView();
      const previousTime = this.#lastWheelFrameTimeMs ?? timeMs - 16;
      const deltaSeconds = Math.max((timeMs - previousTime) / 1_000, 1 / 240);
      this.#lastWheelFrameTimeMs = timeMs;
      this.#emitMotion(
        createInteractionMotionSnapshot(
          'active',
          timeMs,
          stoppedInteractionVelocity(),
          zoomDelta / deltaSeconds,
        ),
      );
      this.#setViewFromInteraction({ zoom: view.zoom + zoomDelta });
    }

    if (this.#pendingWheelZoomDelta !== 0) {
      this.#scheduleWheelFrame();
    } else {
      this.#lastWheelFrameTimeMs = undefined;
      this.#emitIdleMotion(timeMs);
    }
  };

  #setViewFromInteraction(view: Partial<ViewState>): void {
    this.#options.setView(view);
  }

  #startInertia(active: ActivePointer, timeMs: number): boolean {
    if (this.#options.reducedMotion === true) {
      return false;
    }

    const view = this.#options.getView();
    const velocity = clampReleaseVelocity(
      estimateReleaseVelocity(active.mode, active.samples),
      view,
    );
    if (!shouldStartInertia(velocity, view)) {
      return false;
    }

    this.#inertia = {
      velocity,
      lastFrameTimeMs: timeMs,
      startedAtMs: timeMs,
      frame: undefined,
    };
    this.#emitMotion(
      createInteractionMotionSnapshot('settling', timeMs, velocity),
    );
    this.#scheduleInertiaFrame();
    return true;
  }

  #scheduleInertiaFrame(): void {
    if (this.#inertia === undefined || this.#inertia.frame !== undefined) {
      return;
    }

    this.#inertia.frame = this.#scheduler.requestFrame(this.#onInertiaFrame);
  }

  #scheduleWheelFrame(): void {
    if (this.#wheelFrame !== undefined) {
      return;
    }

    this.#wheelFrame = this.#scheduler.requestFrame(this.#onWheelFrame);
  }

  #cancelInertia(): void {
    if (this.#inertia?.frame !== undefined) {
      this.#scheduler.cancelFrame(this.#inertia.frame);
    }
    this.#inertia = undefined;
  }

  #cancelWheel(): void {
    if (this.#wheelFrame !== undefined) {
      this.#scheduler.cancelFrame(this.#wheelFrame);
    }
    this.#wheelFrame = undefined;
    this.#pendingWheelZoomDelta = 0;
    this.#lastWheelFrameTimeMs = undefined;
  }

  #emitIdleMotion(timeMs = this.#scheduler.now()): void {
    this.#emitMotion(createIdleMotionSnapshot(timeMs));
  }

  #emitMotion(snapshot: InteractionMotionSnapshot): void {
    if (!this.#disposed) {
      this.#options.onMotion?.(snapshot);
    }
  }
}

function stoppedInteractionVelocity(): InteractionVelocity {
  return { panX: 0, panY: 0, bearing: 0, pitch: 0 };
}

function getPointerMode(
  event: Pick<PointerEvent, 'button' | 'shiftKey'>,
): ActivePointer['mode'] | undefined {
  if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
    return 'rotate';
  }
  if (event.button === 0) {
    return 'pan';
  }
  return undefined;
}

function takeWheelZoomStep(pendingDelta: number): number {
  if (Math.abs(pendingDelta) <= WHEEL_ZOOM_STEP_PER_FRAME) {
    return pendingDelta;
  }

  return Math.sign(pendingDelta) * WHEEL_ZOOM_STEP_PER_FRAME;
}

function getEventTime(
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

function createDefaultFrameScheduler(): InteractionFrameScheduler {
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

function releasePointerCapture(
  target: InteractionTarget,
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
