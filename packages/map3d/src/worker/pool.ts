import type { TileBuildPayloadV1, TileLayerRecipeV1 } from '../geometry/types.js';
import type { CanonicalTileKey } from '../types.js';
import { getAbortReason } from '../source/errors.js';
import { TILE_BUILD_PROTOCOL_VERSION } from './protocol.js';
import type {
  SerializedTileWorkerError,
  TileBuildMessageV1,
  TileWorkerRequestV1,
} from './protocol.js';
import {
  getWorkerResponseEnvelope,
  isTileBuildPayloadV1,
  isTileWorkerResponseEnvelopeV1,
} from './validation.js';

export interface TileBuildWorkerAdapter {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: TileWorkerRequestV1, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface TileWorkerPoolOptions {
  size?: number;
  createWorker?: () => TileBuildWorkerAdapter;
}

export interface TileBuildJobInput {
  key: CanonicalTileKey;
  generation: number;
  data: ArrayBuffer;
  layers: readonly TileLayerRecipeV1[];
}

export interface TileBuildJobOptions {
  signal?: AbortSignal;
  isGenerationCurrent?: (generation: number) => boolean;
}

export interface TileBuildJob {
  jobId: number;
  result: Promise<TileBuildPayloadV1>;
  cancel(reason?: unknown): void;
}

export interface TileWorkerPoolStats {
  active: number;
  queued: number;
}

/** Worker 返回的序列化构建错误。 */
export class TileWorkerBuildError extends Error {
  readonly workerError: SerializedTileWorkerError;

  constructor(error: SerializedTileWorkerError) {
    super(error.message);
    this.name = 'TileWorkerBuildError';
    this.workerError = error;
  }
}

/** generation 已失效或 consumer 已销毁。 */
export class StaleTileBuildError extends Error {
  constructor() {
    super('Tile build generation 已失效。');
    this.name = 'StaleTileBuildError';
  }
}

interface PoolJob {
  jobId: number;
  input: TileBuildJobInput;
  options: TileBuildJobOptions;
  resolve: (payload: TileBuildPayloadV1) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
  cancelled: boolean;
  abortListener: (() => void) | undefined;
}

interface WorkerSlot {
  worker: TileBuildWorkerAdapter;
  active: PoolJob | undefined;
}

/** 管理 version 1 Tile build job、transferable 和 generation 验证。 */
export class TileWorkerPool {
  readonly #slots: WorkerSlot[];
  readonly #queue: PoolJob[] = [];
  #nextJobId = 1;
  #disposed = false;

  constructor(options: TileWorkerPoolOptions = {}) {
    const size = normalizeWorkerCount(options.size);
    const createWorker = options.createWorker ?? createBrowserWorker;
    this.#slots = Array.from({ length: size }, () => {
      const slot: WorkerSlot = { worker: createWorker(), active: undefined };
      slot.worker.onmessage = (event) => this.#handleMessage(slot, event.data);
      slot.worker.onerror = (event) => this.#handleWorkerError(slot, event);
      return slot;
    });
  }

  /** 入队 Tile build；实际发送时输入 ArrayBuffer 所有权转移给 Worker。 */
  enqueue(
    input: TileBuildJobInput,
    options: TileBuildJobOptions = {},
  ): TileBuildJob {
    if (this.#disposed) {
      throw new Error('TileWorkerPool 已销毁。');
    }
    if (!Number.isSafeInteger(input.generation) || input.generation < 0) {
      throw new RangeError('generation 必须是非负安全整数。');
    }
    const jobId = this.#nextJobId;
    this.#nextJobId += 1;

    if (options.signal?.aborted === true) {
      const reason = getAbortReason(options.signal);
      return {
        jobId,
        result: Promise.reject(reason),
        cancel() {},
      };
    }

    let resolveResult!: (payload: TileBuildPayloadV1) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<TileBuildPayloadV1>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const job: PoolJob = {
      jobId,
      input,
      options,
      resolve: resolveResult,
      reject: rejectResult,
      settled: false,
      cancelled: false,
      abortListener: undefined,
    };

    if (options.signal !== undefined) {
      const abortListener = (): void => {
        this.#cancelJob(job, getAbortReason(options.signal!));
      };
      job.abortListener = abortListener;
      options.signal.addEventListener('abort', abortListener, { once: true });
    }

    this.#queue.push(job);
    this.#dispatch();

    return {
      jobId,
      result,
      cancel: (reason = new DOMException('Worker job 已取消。', 'AbortError')) => {
        this.#cancelJob(job, reason);
      },
    };
  }

  getStats(): TileWorkerPoolStats {
    return {
      active: this.#slots.filter((slot) => slot.active !== undefined).length,
      queued: this.#queue.length,
    };
  }

  /** 终止全部 Worker，所有在途和排队 job 均不再挂载结果。 */
  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    const reason = new Error('TileWorkerPool 已销毁。');

    for (const job of this.#queue.splice(0)) {
      this.#rejectJob(job, reason);
    }

    for (const slot of this.#slots) {
      if (slot.active !== undefined) {
        this.#rejectJob(slot.active, reason);
        slot.active = undefined;
      }
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    }
  }

  #dispatch(): void {
    if (this.#disposed) {
      return;
    }

    for (const slot of this.#slots) {
      while (slot.active === undefined) {
        const job = this.#queue.shift();

        if (job === undefined) {
          return;
        }

        slot.active = job;
        const message: TileBuildMessageV1 = {
          type: 'build',
          protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
          jobId: job.jobId,
          generation: job.input.generation,
          key: job.input.key,
          data: job.input.data,
          layers: job.input.layers,
        };

        try {
          slot.worker.postMessage(message, [job.input.data]);
        } catch (error) {
          this.#rejectJob(job, error);
          slot.active = undefined;
        }
      }
    }
  }

  #handleMessage(slot: WorkerSlot, data: unknown): void {
    const job = slot.active;

    if (job === undefined) {
      return;
    }

    const envelope = getWorkerResponseEnvelope(data);

    if (envelope.protocolVersion !== TILE_BUILD_PROTOCOL_VERSION) {
      this.#rejectJob(
        job,
        new TileWorkerBuildError({
          code: 'PROTOCOL_VERSION_MISMATCH',
          message: `Worker 返回不支持的 protocolVersion ${String(envelope.protocolVersion)}。`,
          phase: 'protocol',
          recoverable: false,
          details: { expected: TILE_BUILD_PROTOCOL_VERSION },
        }),
      );
      this.#finishSlot(slot);
      return;
    }

    if (!isTileWorkerResponseEnvelopeV1(data)) {
      this.#rejectJob(
        job,
        new TileWorkerBuildError({
          code: 'WORKER_ERROR',
          message: 'Worker 返回无效响应。',
          phase: 'protocol',
          recoverable: false,
        }),
      );
      this.#finishSlot(slot);
      return;
    }

    if (data.jobId !== job.jobId) {
      // 已取消、失败或过期 job 的迟到响应不得影响当前在途 job。
      return;
    }

    if (job.cancelled || this.#disposed) {
      this.#finishSlot(slot);
      return;
    }

    if (data.type === 'error') {
      this.#rejectJob(job, new TileWorkerBuildError(data.error));
      this.#finishSlot(slot);
      return;
    }

    const payloadVersion = getWorkerResponseEnvelope(data.payload).protocolVersion;

    if (payloadVersion !== TILE_BUILD_PROTOCOL_VERSION) {
      this.#rejectJob(
        job,
        new TileWorkerBuildError({
          code: 'PROTOCOL_VERSION_MISMATCH',
          message: `Worker payload 使用不支持的 protocolVersion ${String(payloadVersion)}。`,
          phase: 'protocol',
          recoverable: false,
          details: { expected: TILE_BUILD_PROTOCOL_VERSION },
        }),
      );
      this.#finishSlot(slot);
      return;
    }

    if (!isTileBuildPayloadV1(data.payload)) {
      this.#rejectJob(
        job,
        new TileWorkerBuildError({
          code: 'WORKER_ERROR',
          message: 'Worker 返回无效 payload。',
          phase: 'protocol',
          recoverable: false,
        }),
      );
      this.#finishSlot(slot);
      return;
    }

    if (
      data.generation !== job.input.generation ||
      job.options.isGenerationCurrent?.(data.generation) === false
    ) {
      this.#rejectJob(job, new StaleTileBuildError());
      this.#finishSlot(slot);
      return;
    }

    this.#resolveJob(job, data.payload);
    this.#finishSlot(slot);
  }

  #handleWorkerError(slot: WorkerSlot, event: ErrorEvent): void {
    if (slot.active !== undefined) {
      this.#rejectJob(
        slot.active,
        event.error ?? new Error(event.message || 'Worker 运行失败。'),
      );
    }
    this.#finishSlot(slot);
  }

  #cancelJob(job: PoolJob, reason: unknown): void {
    if (job.settled || job.cancelled) {
      return;
    }

    job.cancelled = true;
    const queueIndex = this.#queue.indexOf(job);

    if (queueIndex >= 0) {
      this.#queue.splice(queueIndex, 1);
      this.#rejectJob(job, reason);
      return;
    }

    const slot = this.#slots.find((candidate) => candidate.active === job);

    if (slot !== undefined) {
      this.#rejectJob(job, reason);
      try {
        slot.worker.postMessage({
          type: 'cancel',
          protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
          jobId: job.jobId,
        });
      } catch {
        // Worker 终止或消息通道关闭时，主线程取消语义仍已完成。
      }
    }
  }

  #resolveJob(job: PoolJob, payload: TileBuildPayloadV1): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.#removeAbortListener(job);
    job.resolve(payload);
  }

  #rejectJob(job: PoolJob, reason: unknown): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.#removeAbortListener(job);
    job.reject(reason);
  }

  #removeAbortListener(job: PoolJob): void {
    if (job.abortListener !== undefined && job.options.signal !== undefined) {
      job.options.signal.removeEventListener('abort', job.abortListener);
      job.abortListener = undefined;
    }
  }

  #finishSlot(slot: WorkerSlot): void {
    slot.active = undefined;
    this.#dispatch();
  }
}

function createBrowserWorker(): TileBuildWorkerAdapter {
  if (typeof Worker === 'undefined') {
    throw new Error('当前环境不提供 Worker；测试必须注入 adapter。');
  }

  return new Worker(new URL('./tileBuild.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as TileBuildWorkerAdapter;
}

function normalizeWorkerCount(value: number | undefined): number {
  const defaultCount = Math.min(
    4,
    Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1),
  );
  const count = value ?? defaultCount;

  if (!Number.isSafeInteger(count) || count < 1 || count > 4) {
    throw new RangeError('Worker 数量必须是 1 到 4 的整数。');
  }

  return count;
}
