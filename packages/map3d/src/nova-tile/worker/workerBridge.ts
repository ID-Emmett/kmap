import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';
import type { PlanEpoch, TileGeneration } from '../epoch.js';

export interface WorkerJobInput<PayloadInput> {
  readonly key: CanonicalTileKey;
  readonly data: ArrayBuffer;
  readonly planEpoch: PlanEpoch;
  readonly generation: TileGeneration;
  readonly input: PayloadInput;
  readonly signal?: AbortSignal;
}

export interface WorkerJobResult<Payload> {
  readonly jobId: number;
  readonly key: CanonicalTileKey;
  readonly planEpoch: PlanEpoch;
  readonly generation: TileGeneration;
  readonly payload: Payload;
}

export interface WorkerAdapter<PayloadInput, Payload> {
  run(input: WorkerJobInput<PayloadInput> & { readonly jobId: number }): Promise<Payload>;
  cancel?(jobId: number): void;
  dispose?(): void;
}

/** Worker protocol v1 的主线程桥接；校验 generation/epoch 后才接受结果。 */
export class TileWorkerBridge<PayloadInput, Payload> {
  readonly #adapter: WorkerAdapter<PayloadInput, Payload>;
  readonly #jobs = new Map<number, AbortController>();
  #nextJobId = 1;
  #disposed = false;

  constructor(adapter: WorkerAdapter<PayloadInput, Payload>) { this.#adapter = adapter; }

  enqueue(input: WorkerJobInput<PayloadInput>, current?: () => { planEpoch: number; generation: number }): { readonly jobId: number; readonly result: Promise<WorkerJobResult<Payload>>; readonly cancel: (reason?: unknown) => void } {
    if (this.#disposed) throw new Error('TileWorkerBridge 已销毁。');
    const jobId = this.#nextJobId++;
    const controller = new AbortController();
    this.#jobs.set(jobId, controller);
    const signal = controller.signal;
    if (input.signal !== undefined) {
      if (input.signal.aborted) controller.abort(input.signal.reason);
      else input.signal.addEventListener('abort', () => controller.abort(input.signal?.reason), { once: true });
    }
    const result = this.#adapter.run({ ...input, jobId, signal }).then((payload) => {
      const state = current?.();
      if (state !== undefined && (state.planEpoch !== input.planEpoch || state.generation !== input.generation)) throw new TileWorkerStaleError(jobId, input.key);
      return Object.freeze({ jobId, key: input.key, planEpoch: input.planEpoch, generation: input.generation, payload });
    }).finally(() => this.#jobs.delete(jobId));
    return { jobId, result, cancel: (reason) => { controller.abort(reason); this.#adapter.cancel?.(jobId); } };
  }

  dispose(): void { if (this.#disposed) return; this.#disposed = true; for (const [jobId, controller] of this.#jobs) { controller.abort(); this.#adapter.cancel?.(jobId); } this.#jobs.clear(); this.#adapter.dispose?.(); }
  get activeJobs(): number { return this.#jobs.size; }
}

export class TileWorkerStaleError extends Error {
  readonly jobId: number;
  readonly key: CanonicalTileKey;
  constructor(jobId: number, key: CanonicalTileKey) { super(`Tile Worker job ${jobId} 已过时：${canonicalTileKeyToString(key)}。`); this.name = 'TileWorkerStaleError'; this.jobId = jobId; this.key = key; }
}

/** 收集 TypedArray 的 ArrayBuffer，用于 Worker transferable。 */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const result: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  const visit = (candidate: unknown): void => {
    if (candidate instanceof ArrayBuffer) { if (!seen.has(candidate)) { seen.add(candidate); result.push(candidate); } return; }
    if (ArrayBuffer.isView(candidate)) { visit(candidate.buffer); return; }
    if (Array.isArray(candidate)) { for (const item of candidate) visit(item); return; }
    if (candidate !== null && typeof candidate === 'object') { for (const item of Object.values(candidate)) visit(item); }
  };
  visit(value);
  return result;
}
