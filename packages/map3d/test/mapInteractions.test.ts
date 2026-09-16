import { describe, expect, it, vi } from 'vitest';

import {
  type InteractionFrameScheduler,
  MapInteractionController,
  panViewByPixels,
  rotateViewByPixels,
  zoomViewByWheel,
} from '../src/interaction/mapInteractions.js';
import {
  INERTIA_MAX_DURATION_MS,
  integrateInertiaStep,
  isInertiaStopped,
} from '../src/interaction/inertia.js';
import type { InteractionMotionSnapshot } from '../src/interaction/motionSnapshot.js';
import { normalizeViewState } from '../src/spatial/viewState.js';
import type { ViewState } from '../src/types.js';

describe('Map interactions', () => {
  it('平移、缩放和 bearing/pitch 手势遵守 ViewState 语义', () => {
    const view = normalizeViewState({
      center: { lng: 0, lat: 0 },
      zoom: 5,
      bearing: 0,
      pitch: 0,
    });
    const panned = panViewByPixels(view, { width: 800, height: 600 }, 100, 50);
    const rotated = rotateViewByPixels(view, 400, -400);
    const zoomed = zoomViewByWheel(
      view,
      -200,
      0,
      { width: 800, height: 600 },
    );

    expect(panned.center.lng).toBeLessThan(view.center.lng);
    expect(panned.center.lat).toBeGreaterThan(view.center.lat);
    expect(rotated.bearing).toBe(100);
    expect(rotated.pitch).toBe(75);
    expect(zoomed.zoom).toBe(5.5);
  });

  it('绑定 pointer/wheel/contextmenu 并在 dispose 后完全解除', () => {
    const target = new FakeInteractionTarget();
    const scheduler = new FakeFrameScheduler();
    let view = normalizeViewState({ zoom: 5 });
    const setView = vi.fn((update: Partial<ViewState>) => {
      view = normalizeViewState(update, view);
    });
    const controller = new MapInteractionController({
      target,
      getView: () => view,
      setView,
      getViewport: () => ({ width: 800, height: 600 }),
      frameScheduler: scheduler,
    });

    expect(target.listenerCount()).toBe(7);
    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 10, clientY: 10, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 30, clientY: 20, timeStamp: 1_000 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 30, clientY: 20, timeStamp: 1_000 }));
    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    target.dispatch('contextmenu', syntheticEvent({}));

    expect(setView).toHaveBeenCalledTimes(1);
    scheduler.step(16);
    expect(setView).toHaveBeenCalledTimes(2);
    expect(target.captured).toEqual([1]);
    expect(target.released).toEqual([1]);

    target.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 10, clientY: 10 }));
    controller.dispose();
    controller.dispose();
    expect(target.listenerCount()).toBe(0);
    expect(target.released).toEqual([1, 2]);
    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    expect(setView).toHaveBeenCalledTimes(2);
  });

  it('快速 pan 释放后按真实 delta time 单调衰减', () => {
    const { target, scheduler, getView } = createInteractionHarness({
      zoom: 15,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    const released = getView();

    scheduler.setNow(80);
    scheduler.runUntilIdle(1_000 / 60, 2_000);
    const final = getView();

    expect(final.center.lng).toBeLessThan(released.center.lng);
    expect(scheduler.now() - 80).toBeLessThanOrEqual(1_520);
  });

  it('bearing/pitch 快速释放后继续运动并在阈值内停止', () => {
    const { target, scheduler, getView } = createInteractionHarness({
      zoom: 15,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, button: 0, shiftKey: true, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 120, clientY: -90, timeStamp: 90 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 120, clientY: -90, timeStamp: 90 }));
    const released = getView();

    scheduler.setNow(90);
    scheduler.runUntilIdle(1_000 / 120, 2_000);
    const final = getView();

    expect(final.bearing).toBeGreaterThan(released.bearing);
    expect(final.pitch).toBeGreaterThan(released.pitch);
    expect(final.pitch).toBeLessThanOrEqual(75);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('reduced-motion 下释放不会启动惯性', () => {
    const { target, scheduler, getView } = createInteractionHarness({
      zoom: 15,
      reducedMotion: true,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 180, clientY: 0, timeStamp: 70 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 180, clientY: 0, timeStamp: 70 }));
    const released = getView();

    scheduler.setNow(70);
    scheduler.runUntilIdle(16, 500);

    expect(getView()).toEqual(released);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('外部取消会停止既有惯性', () => {
    const { target, scheduler, getView, controller } = createInteractionHarness({
      zoom: 15,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    const released = getView();

    scheduler.setNow(80);
    controller.cancelMotion();
    scheduler.runUntilIdle(16, 500);

    expect(getView()).toEqual(released);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('页面失活会停止既有惯性', () => {
    const target = new FakeInteractionTarget();
    const lifecycleTarget = new FakeLifecycleTarget();
    const scheduler = new FakeFrameScheduler();
    let view = normalizeViewState({ zoom: 15 });
    const setView = vi.fn((update: Partial<ViewState>) => {
      view = normalizeViewState(update, view);
    });
    const controller = new MapInteractionController({
      target,
      lifecycleTarget,
      isPageHidden: () => lifecycleTarget.visibilityState === 'hidden',
      getView: () => view,
      setView,
      getViewport: () => ({ width: 800, height: 600 }),
      frameScheduler: scheduler,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    scheduler.setNow(80);
    const released = view;

    lifecycleTarget.visibilityState = 'hidden';
    lifecycleTarget.dispatch('visibilitychange', syntheticEvent({}));
    scheduler.runUntilIdle(16, 500);

    expect(view).toEqual(released);
    expect(scheduler.pendingCount()).toBe(0);
    controller.dispose();
    expect(lifecycleTarget.listenerCount()).toBe(0);
  });

  it('pitch 命中边界后停止对应速度分量', () => {
    const { target, scheduler, getView } = createInteractionHarness({
      zoom: 15,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, button: 0, shiftKey: true, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 0, clientY: -400, timeStamp: 80 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 0, clientY: -400, timeStamp: 80 }));
    scheduler.setNow(80);
    scheduler.step(16);

    expect(getView().pitch).toBe(75);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('指数阻尼在 30/60/120Hz 下保持近似同终点', () => {
    const endpoint30 = simulatePanInertiaEndpoint(1_000 / 30);
    const endpoint60 = simulatePanInertiaEndpoint(1_000 / 60);
    const endpoint120 = simulatePanInertiaEndpoint(1_000 / 120);

    expect(Math.abs(endpoint30 - endpoint60)).toBeLessThan(2);
    expect(Math.abs(endpoint120 - endpoint60)).toBeLessThan(2);
  });

  it('wheel burst 合并为逐帧 zoom 更新', () => {
    const { target, scheduler, getView, setView } = createInteractionHarness({
      zoom: 5,
    });

    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));

    expect(setView).not.toHaveBeenCalled();
    scheduler.step(16);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(getView().zoom).toBeGreaterThan(5);
    expect(getView().zoom).toBeLessThan(5.3);

    scheduler.runUntilIdle(16, 1_000);

    expect(getView().zoom).toBeCloseTo(6.2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('滚轮在 60/120/170Hz 下按相同时间推进并准确到达目标', () => {
    const positions = [60, 120, 170].map(hz => {
      const { target, scheduler, getView } = createInteractionHarness({ zoom: 5 });
      target.dispatch('wheel', wheelEvent({ deltaY: -400, deltaMode: 0 }));
      let elapsed = 0;
      while (elapsed < 160) { const step = Math.min(1000 / hz, 160 - elapsed); scheduler.step(step); elapsed += step; }
      const mid = getView().zoom;
      scheduler.runUntilIdle(1000 / hz, 1000);
      expect(getView().zoom).toBeCloseTo(6, 6);
      return mid;
    });
    expect(positions[0]).toBeGreaterThan(5.8); expect(positions[0]).toBeLessThan(6);
    expect(positions[0]).toBeCloseTo(positions[1]!, 10); expect(positions[0]).toBeCloseTo(positions[2]!, 10);
  });

  it('wheel 新输入会取消旧惯性', () => {
    const { target, scheduler, getView } = createInteractionHarness({
      zoom: 15,
    });

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 160, clientY: 0, timeStamp: 80 }));
    scheduler.setNow(80);
    const released = getView();

    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    scheduler.runUntilIdle(16, 1_000);

    expect(getView().center).toEqual(released.center);
    expect(getView().zoom).toBeGreaterThan(released.zoom);
  });

  it('pan、rotate 和惯性发出可预测的 motion snapshot', () => {
    const motion: InteractionMotionSnapshot[] = [];
    const { target, scheduler } = createInteractionHarness(
      { zoom: 15 },
      (snapshot) => motion.push(snapshot),
    );

    target.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 160, clientY: 20, timeStamp: 80 }));
    expect(motion.at(-1)?.phase).toBe('active');
    expect(Math.hypot(
      motion.at(-1)?.velocity.panX ?? 0,
      motion.at(-1)?.velocity.panY ?? 0,
    )).toBeGreaterThan(0);

    target.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 160, clientY: 20, timeStamp: 80 }));
    expect(motion.at(-1)?.phase).toBe('settling');
    scheduler.runUntilIdle(16, 2_000);
    expect(motion.at(-1)?.phase).toBe('idle');

    target.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 0, clientY: 0, button: 2, timeStamp: 2_100 }));
    target.dispatch('pointermove', pointerEvent({ pointerId: 2, clientX: 40, clientY: -30, button: 2, timeStamp: 2_180 }));
    expect(Math.abs(motion.at(-1)?.velocity.bearing ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(motion.at(-1)?.velocity.pitch ?? 0)).toBeGreaterThan(0);
  });

  it('wheel 报告 zoom 速度，外部取消后回到 idle', () => {
    const motion: InteractionMotionSnapshot[] = [];
    const { target, scheduler, controller } = createInteractionHarness(
      { zoom: 5 },
      (snapshot) => motion.push(snapshot),
    );

    target.dispatch('wheel', wheelEvent({ deltaY: -160, deltaMode: 0 }));
    scheduler.step(16);

    expect(motion.at(-1)?.phase).toBe('active');
    expect(motion.at(-1)?.velocity.zoom).toBeGreaterThan(0);
    controller.cancelMotion();
    expect(motion.at(-1)?.phase).toBe('idle');
  });
});

class FakeInteractionTarget {
  readonly captured: number[] = [];
  readonly released: number[] = [];
  readonly #listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    const typedEvent = { ...event, type } as Event;
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener(typedEvent);
    }
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.released.push(pointerId);
  }
}

class FakeLifecycleTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  readonly #listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    const typedEvent = { ...event, type } as Event;
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener(typedEvent);
    }
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}

class FakeFrameScheduler implements InteractionFrameScheduler {
  #nowMs = 0;
  #nextHandle = 1;
  readonly #callbacks = new Map<number, (timeMs: number) => void>();

  now(): number {
    return this.#nowMs;
  }

  requestFrame(callback: (timeMs: number) => void): number {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: unknown): void {
    this.#callbacks.delete(handle as number);
  }

  setNow(timeMs: number): void {
    this.#nowMs = timeMs;
  }

  step(deltaMs: number): void {
    this.#nowMs += deltaMs;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) {
      callback(this.#nowMs);
    }
  }

  runUntilIdle(deltaMs: number, maxElapsedMs: number): void {
    const startedAt = this.#nowMs;
    while (
      this.#callbacks.size > 0 &&
      this.#nowMs - startedAt < maxElapsedMs
    ) {
      this.step(deltaMs);
    }
  }

  pendingCount(): number {
    return this.#callbacks.size;
  }
}

function createInteractionHarness(
  initial: Partial<ViewState> & { reducedMotion?: boolean },
  onMotion?: (snapshot: InteractionMotionSnapshot) => void,
): {
  readonly target: FakeInteractionTarget;
  readonly scheduler: FakeFrameScheduler;
  readonly controller: MapInteractionController;
  readonly getView: () => ViewState;
  readonly setView: ReturnType<typeof vi.fn>;
} {
  const target = new FakeInteractionTarget();
  const scheduler = new FakeFrameScheduler();
  let view = normalizeViewState(initial);
  const setView = vi.fn((update: Partial<ViewState>) => {
    view = normalizeViewState(update, view);
  });
  const controller = new MapInteractionController({
    target,
    getView: () => view,
    setView,
    getViewport: () => ({ width: 800, height: 600 }),
    frameScheduler: scheduler,
    ...(onMotion === undefined ? {} : { onMotion }),
    ...(initial.reducedMotion === undefined
      ? {}
      : { reducedMotion: initial.reducedMotion }),
  });

  return {
    target,
    scheduler,
    controller,
    getView: () => view,
    setView,
  };
}

function simulatePanInertiaEndpoint(frameMs: number): number {
  const view = normalizeViewState({ zoom: 15 });
  let velocity = {
    panX: 1_000,
    panY: 500,
    bearing: 0,
    pitch: 0,
  };
  let elapsedMs = 0;
  let panX = 0;

  while (
    elapsedMs < INERTIA_MAX_DURATION_MS &&
    !isInertiaStopped(velocity, view)
  ) {
    const step = integrateInertiaStep(velocity, frameMs / 1_000);
    panX += step.displacement.panX;
    velocity = step.velocity;
    elapsedMs += frameMs;
  }

  return panX;
}

function pointerEvent(
  values: Partial<PointerEvent> & Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>,
): Event {
  return syntheticEvent({ button: 0, shiftKey: false, ...values });
}

function wheelEvent(
  values: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
): Event {
  return syntheticEvent(values);
}

function syntheticEvent(values: object): Event {
  return {
    ...values,
    preventDefault: vi.fn(),
  } as unknown as Event;
}
