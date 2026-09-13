import type { ViewState } from '../../types.js';

export interface MotionSample {
  readonly timeMs: number;
  readonly view: ViewState;
}

export interface MotionVelocity {
  readonly lngPerSecond: number;
  readonly latPerSecond: number;
  readonly zoomPerSecond: number;
  readonly bearingPerSecond: number;
  readonly pitchPerSecond: number;
}

export interface MotionEstimate {
  readonly velocity: MotionVelocity;
  readonly acceleration: MotionVelocity;
  readonly direction: { readonly x: number; readonly y: number };
  readonly confidence: number;
  readonly phase: 'moving' | 'settling' | 'settled' | 'idle';
}

export interface MotionPrediction {
  readonly timeMs: number;
  readonly view: ViewState;
  readonly velocity: MotionVelocity;
  readonly confidence: number;
}

const ZERO_VELOCITY: MotionVelocity = Object.freeze({ lngPerSecond: 0, latPerSecond: 0, zoomPerSecond: 0, bearingPerSecond: 0, pitchPerSecond: 0 });

/** 从最近 ViewState 样本计算运动速度、加速度和预测视图。 */
export class MotionPredictor {
  readonly #samples: MotionSample[] = [];
  readonly #maxSamples: number;
  #estimate: MotionEstimate = Object.freeze({ velocity: ZERO_VELOCITY, acceleration: ZERO_VELOCITY, direction: Object.freeze({ x: 0, y: 0 }), confidence: 0, phase: 'idle' });

  constructor(options: { maxSamples?: number } = {}) {
    this.#maxSamples = normalizePositive(options.maxSamples ?? 8, 'maxSamples');
  }

  addSample(sample: MotionSample): MotionEstimate {
    validateSample(sample);
    const previous = this.#samples[this.#samples.length - 1];
    this.#samples.push(sample);
    while (this.#samples.length > this.#maxSamples) this.#samples.shift();
    if (previous === undefined || sample.timeMs <= previous.timeMs) return this.#estimate;
    const velocity = deriveVelocity(previous, sample);
    const older = this.#samples.length >= 3 ? this.#samples[this.#samples.length - 3] : undefined;
    const priorVelocity = older === undefined ? ZERO_VELOCITY : deriveVelocity(older, previous);
    const dt = (sample.timeMs - previous.timeMs) / 1000;
    const acceleration = subtractVelocity(velocity, priorVelocity, Math.max(dt, 1e-6));
    const magnitude = Math.hypot(velocity.lngPerSecond, velocity.latPerSecond);
    this.#estimate = Object.freeze({ velocity, acceleration, direction: Object.freeze({ x: velocity.lngPerSecond, y: velocity.latPerSecond }), confidence: Math.min(1, this.#samples.length / this.#maxSamples), phase: magnitude > 0.001 ? 'moving' : 'settled' });
    return this.#estimate;
  }

  estimate(): MotionEstimate {
    return this.#estimate;
  }

  predict(nowMs: number, options: { predictionMs?: number; guardBand?: number } = {}): MotionPrediction {
    if (!Number.isFinite(nowMs)) throw new RangeError('nowMs 必须是有限数值。');
    const latest = this.#samples[this.#samples.length - 1];
    const durationMs = options.predictionMs ?? choosePredictionWindow(this.#estimate.velocity);
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('predictionMs 必须是非负有限数值。');
    if (latest === undefined) return Object.freeze({ timeMs: nowMs + durationMs, view: defaultView(), velocity: this.#estimate.velocity, confidence: 0 });
    const seconds = durationMs / 1000;
    const v = this.#estimate.velocity;
    const a = this.#estimate.acceleration;
    const view = {
      center: {
        lng: latest.view.center.lng + v.lngPerSecond * seconds + 0.5 * a.lngPerSecond * seconds * seconds,
        lat: latest.view.center.lat + v.latPerSecond * seconds + 0.5 * a.latPerSecond * seconds * seconds,
      },
      zoom: Math.max(0, latest.view.zoom + v.zoomPerSecond * seconds + 0.5 * a.zoomPerSecond * seconds * seconds),
      bearing: latest.view.bearing + v.bearingPerSecond * seconds + 0.5 * a.bearingPerSecond * seconds * seconds,
      pitch: Math.min(60, Math.max(0, latest.view.pitch + v.pitchPerSecond * seconds + 0.5 * a.pitchPerSecond * seconds * seconds)),
    } satisfies ViewState;
    return Object.freeze({ timeMs: nowMs + durationMs, view: Object.freeze(view), velocity: this.#estimate.velocity, confidence: this.#estimate.confidence });
  }

  clear(): void {
    this.#samples.length = 0;
    this.#estimate = Object.freeze({ velocity: ZERO_VELOCITY, acceleration: ZERO_VELOCITY, direction: Object.freeze({ x: 0, y: 0 }), confidence: 0, phase: 'idle' });
  }
}

function deriveVelocity(a: MotionSample, b: MotionSample): MotionVelocity {
  const dt = Math.max(1e-6, (b.timeMs - a.timeMs) / 1000);
  return Object.freeze({ lngPerSecond: (b.view.center.lng - a.view.center.lng) / dt, latPerSecond: (b.view.center.lat - a.view.center.lat) / dt, zoomPerSecond: (b.view.zoom - a.view.zoom) / dt, bearingPerSecond: (b.view.bearing - a.view.bearing) / dt, pitchPerSecond: (b.view.pitch - a.view.pitch) / dt });
}

function subtractVelocity(a: MotionVelocity, b: MotionVelocity, dt: number): MotionVelocity {
  return Object.freeze({ lngPerSecond: (a.lngPerSecond - b.lngPerSecond) / dt, latPerSecond: (a.latPerSecond - b.latPerSecond) / dt, zoomPerSecond: (a.zoomPerSecond - b.zoomPerSecond) / dt, bearingPerSecond: (a.bearingPerSecond - b.bearingPerSecond) / dt, pitchPerSecond: (a.pitchPerSecond - b.pitchPerSecond) / dt });
}

function choosePredictionWindow(velocity: MotionVelocity): number {
  const speed = Math.hypot(velocity.lngPerSecond, velocity.latPerSecond);
  return speed > 1 ? 500 : speed > 0.1 ? 300 : 150;
}

function validateSample(sample: MotionSample): void {
  if (!Number.isFinite(sample.timeMs) || !Number.isFinite(sample.view.center.lng) || !Number.isFinite(sample.view.center.lat) || !Number.isFinite(sample.view.zoom) || !Number.isFinite(sample.view.bearing) || !Number.isFinite(sample.view.pitch)) throw new RangeError('MotionSample 必须包含有限数值。');
}

function normalizePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`);
  return value;
}

function defaultView(): ViewState {
  return { center: { lng: 0, lat: 0 }, zoom: 0, bearing: 0, pitch: 0 };
}
