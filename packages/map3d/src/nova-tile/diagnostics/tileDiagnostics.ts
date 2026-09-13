import { createTileTimeline } from './timeline.js';
import type { TileFrameDiagnostics, TileTimeline } from './types.js';
import type { CacheEvent, CommitEvent, LongTaskEvent, RequestEvent, TileCoverSummary, TileDiagnosticsOptions, UploadEvent, WorkerEvent } from './types.js';

interface FrameBuilder {
  readonly frameId: number;
  readonly planEpoch: number;
  readonly targetCover: TileCoverSummary;
  readonly committedCover: TileCoverSummary;
  readonly coverageComplete: boolean;
  readonly blankArea: number;
  readonly requestStarts: RequestEvent[];
  readonly requestFinishes: RequestEvent[];
  readonly cacheEvents: CacheEvent[];
  readonly workerEvents: WorkerEvent[];
  readonly uploadEvents: UploadEvent[];
  readonly commitEvents: CommitEvent[];
  readonly longTasks: LongTaskEvent[];
  readonly phaseDurations: Record<string, number>;
  cpuBytes: number;
  gpuBytes: number;
  frameTime: number;
}

/** 逐帧收集 Tile Cover、请求、Worker、上传、Commit、资源和长任务证据。 */
export class TileDiagnostics {
  readonly #maxFrames: number;
  readonly #clock: { now(): number };
  readonly #frames: TileFrameDiagnostics[] = [];
  #current: FrameBuilder | undefined;

  constructor(options: TileDiagnosticsOptions = {}) {
    this.#maxFrames = normalizePositive(options.maxFrames ?? 3_600, 'maxFrames');
    this.#clock = options.clock ?? { now: () => performance.now() };
  }

  beginFrame(input: { readonly frameId: number; readonly planEpoch: number; readonly targetCover: TileCoverSummary; readonly committedCover: TileCoverSummary; readonly coverageComplete: boolean; readonly blankArea: number; readonly cpuBytes?: number; readonly gpuBytes?: number; readonly frameTime?: number; readonly phaseDurations?: Readonly<Record<string, number>> }): void {
    if (this.#current !== undefined) throw new Error('上一帧诊断尚未结束。');
    if (!Number.isSafeInteger(input.frameId) || input.frameId < 0 || !Number.isSafeInteger(input.planEpoch) || input.planEpoch < 0 || !Number.isFinite(input.blankArea) || input.blankArea < 0) throw new RangeError('Frame diagnostics 基础字段无效。');
    this.#current = { frameId: input.frameId, planEpoch: input.planEpoch, targetCover: freezeCover(input.targetCover), committedCover: freezeCover(input.committedCover), coverageComplete: input.coverageComplete, blankArea: input.blankArea, requestStarts: [], requestFinishes: [], cacheEvents: [], workerEvents: [], uploadEvents: [], commitEvents: [], longTasks: [], phaseDurations: { ...(input.phaseDurations ?? {}) }, cpuBytes: input.cpuBytes ?? 0, gpuBytes: input.gpuBytes ?? 0, frameTime: input.frameTime ?? 0 };
  }

  recordRequest(event: RequestEvent): void { this.current().requestStarts.push(freezeEvent(event)); }
  recordRequestFinish(event: RequestEvent): void { this.current().requestFinishes.push(freezeEvent(event)); }
  recordCache(event: CacheEvent): void { this.current().cacheEvents.push(freezeEvent(event)); }
  recordWorker(event: WorkerEvent): void { this.current().workerEvents.push(freezeEvent(event)); }
  recordUpload(event: UploadEvent): void { this.current().uploadEvents.push(freezeEvent(event)); }
  recordCommit(event: CommitEvent): void { this.current().commitEvents.push(freezeEvent(event)); }
  recordLongTask(event: LongTaskEvent): void { if (!Number.isFinite(event.startTime) || !Number.isFinite(event.durationMs) || event.durationMs < 0) throw new RangeError('LongTaskEvent 无效。'); this.current().longTasks.push(freezeEvent(event)); }

  endFrame(input: { readonly cpuBytes?: number; readonly gpuBytes?: number; readonly frameTime?: number; readonly phaseDurations?: Readonly<Record<string, number>> } = {}): TileFrameDiagnostics {
    const current = this.current();
    current.cpuBytes = input.cpuBytes ?? current.cpuBytes;
    current.gpuBytes = input.gpuBytes ?? current.gpuBytes;
    current.frameTime = input.frameTime ?? current.frameTime;
    if (input.phaseDurations !== undefined) Object.assign(current.phaseDurations, input.phaseDurations);
    const frame: TileFrameDiagnostics = Object.freeze({ frameId: current.frameId, planEpoch: current.planEpoch, targetCover: current.targetCover, committedCover: current.committedCover, coverageComplete: current.coverageComplete, blankArea: current.blankArea, requestStarts: Object.freeze([...current.requestStarts]), requestFinishes: Object.freeze([...current.requestFinishes]), cacheEvents: Object.freeze([...current.cacheEvents]), workerEvents: Object.freeze([...current.workerEvents]), uploadEvents: Object.freeze([...current.uploadEvents]), commitEvents: Object.freeze([...current.commitEvents]), cpuBytes: current.cpuBytes, gpuBytes: current.gpuBytes, frameTime: current.frameTime, longTasks: Object.freeze([...current.longTasks]), phaseDurations: Object.freeze({ ...current.phaseDurations }) });
    this.#frames.push(frame);
    while (this.#frames.length > this.#maxFrames) this.#frames.shift();
    this.#current = undefined;
    return frame;
  }

  discardFrame(): void { this.#current = undefined; }
  get frameCount(): number { return this.#frames.length; }
  get frames(): readonly TileFrameDiagnostics[] { return Object.freeze([...this.#frames]); }
  get timeline(): TileTimeline { return createTileTimeline(this.#frames, this.#clock.now()); }
  toJSON(): string { return JSON.stringify(this.timeline); }

  private current(): FrameBuilder { if (this.#current === undefined) throw new Error('请先 beginFrame。'); return this.#current; }
}

function freezeCover(cover: TileCoverSummary): TileCoverSummary { if (!Number.isSafeInteger(cover.tileCount) || cover.tileCount < 0 || !Number.isFinite(cover.blankArea) || cover.blankArea < 0) throw new RangeError('TileCoverSummary 无效。'); return Object.freeze({ tileCount: cover.tileCount, keys: Object.freeze([...cover.keys]), complete: cover.complete, blankArea: cover.blankArea }); }
function freezeEvent<T extends object>(event: T): T { return Object.freeze({ ...event }); }
function normalizePositive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
