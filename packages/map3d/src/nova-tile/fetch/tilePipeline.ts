import type { CanonicalTileKey } from '../tileAddress.js';
import type { PlanEpoch, TileGeneration } from '../epoch.js';
import { TileFetchPipeline, type TileFetchResult } from './fetchPipeline.js';
import { TileWorkerBridge, type WorkerAdapter, type WorkerJobResult } from '../worker/index.js';

export type NovaTilePipelineResult<Payload> =
  | { readonly type: 'empty'; readonly key: CanonicalTileKey; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly attempts: number }
  | { readonly type: 'ready'; readonly key: CanonicalTileKey; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly attempts: number; readonly payload: Payload };

/** Fetch → Worker 的单 canonical key 数据管线；并发调用共享同一 Promise。 */
export class NovaTilePipeline<Input, Payload> {
  readonly #fetch: TileFetchPipeline;
  readonly #worker: TileWorkerBridge<Input, Payload>;
  readonly #inflight = new Map<string, Promise<NovaTilePipelineResult<Payload>>>();

  constructor(options: { fetch?: TileFetchPipeline; worker: WorkerAdapter<Input, Payload> }) {
    this.#fetch = options.fetch ?? new TileFetchPipeline();
    this.#worker = new TileWorkerBridge(options.worker);
  }

  run(input: { readonly key: CanonicalTileKey; readonly url: string; readonly dataInput: Input; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly signal?: AbortSignal; readonly current?: () => { planEpoch: number; generation: number } }): Promise<NovaTilePipelineResult<Payload>> {
    const id = `${input.key.sourceId}/${input.key.sourceRevision}/${input.key.z}/${input.key.x}/${input.key.y}`;
    const existing = this.#inflight.get(id);
    if (existing !== undefined) return existing;
    const task = this.#run(input);
    this.#inflight.set(id, task);
    void task.finally(() => this.#inflight.delete(id)).catch(() => undefined);
    return task;
  }

  dispose(): void { this.#worker.dispose(); this.#fetch.clear(); this.#inflight.clear(); }
  get workerActiveJobs(): number { return this.#worker.activeJobs; }

  async #run(input: Parameters<NovaTilePipeline<Input, Payload>['run']>[0]): Promise<NovaTilePipelineResult<Payload>> {
    const fetched: TileFetchResult = await this.#fetch.fetch(input.key, input.url, input.signal === undefined ? {} : { signal: input.signal });
    if (fetched.status === 'empty') return Object.freeze({ type: 'empty' as const, key: input.key, planEpoch: input.planEpoch, generation: input.generation, attempts: fetched.attempts });
    const workerInput = input.signal === undefined
      ? { key: input.key, data: fetched.data, input: input.dataInput, planEpoch: input.planEpoch, generation: input.generation }
      : { key: input.key, data: fetched.data, input: input.dataInput, planEpoch: input.planEpoch, generation: input.generation, signal: input.signal };
    const job = this.#worker.enqueue(workerInput, input.current);
    const result: WorkerJobResult<Payload> = await job.result;
    return Object.freeze({ type: 'ready' as const, key: result.key, planEpoch: result.planEpoch, generation: result.generation, attempts: fetched.attempts, payload: result.payload });
  }
}
