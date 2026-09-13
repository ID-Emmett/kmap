import type { PlanEpoch, TileGeneration } from './epoch.js';
import type { CanonicalTileKey, RenderTileKey } from './keys.js';
import type { TileLifecycleState, TileRenderRole, TileCacheRole } from './state.js';

/** NTE 异步结果共享的身份字段。 */
export interface TileAsyncIdentity {
  readonly jobId: number;
  readonly planEpoch: PlanEpoch;
  readonly generation: TileGeneration;
  readonly key: CanonicalTileKey;
  readonly renderKey?: RenderTileKey;
}

/** 成功的异步结果。 */
export interface TileAsyncSuccess<Payload> extends TileAsyncIdentity {
  readonly type: 'success';
  readonly payload: Payload;
}

/** 失败的异步结果；错误仍然携带完整身份以便丢弃迟到结果。 */
export interface TileAsyncFailure extends TileAsyncIdentity {
  readonly type: 'error';
  readonly error: NovaTileError;
}

/** 主动取消或 epoch 失效的异步结果。 */
export interface TileAsyncCancellation extends TileAsyncIdentity {
  readonly type: 'cancelled' | 'stale';
  readonly reason?: unknown;
}

export type TileAsyncResult<Payload> =
  | TileAsyncSuccess<Payload>
  | TileAsyncFailure
  | TileAsyncCancellation;

/** NTE 对外报告的结构化错误。 */
export interface NovaTileError {
  readonly code:
    | 'INVALID_ARGUMENT'
    | 'SOURCE_ERROR'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR'
    | 'DECODE_ERROR'
    | 'GEOMETRY_ERROR'
    | 'WORKER_ERROR'
    | 'UPLOAD_ERROR'
    | 'RESOURCE_LIMIT'
    | 'STALE_RESULT';
  readonly message: string;
  readonly phase: 'plan' | 'request' | 'decode' | 'build' | 'upload' | 'commit' | 'cache';
  readonly recoverable: boolean;
  readonly key?: CanonicalTileKey;
  readonly cause?: unknown;
}

export interface TileStateChangeEvent {
  readonly key: CanonicalTileKey;
  readonly planEpoch: PlanEpoch;
  readonly generation: TileGeneration;
  readonly from: TileLifecycleState;
  readonly to: TileLifecycleState;
  readonly renderRole: TileRenderRole;
  readonly cacheRole: TileCacheRole;
}

export interface TilePlanEvent {
  readonly planEpoch: PlanEpoch;
  readonly view: Readonly<{ center: { lng: number; lat: number }; zoom: number; bearing: number; pitch: number }>;
  readonly targetKeys: readonly CanonicalTileKey[];
}

export interface TileStats {
  readonly planEpoch: PlanEpoch;
  readonly generation: TileGeneration;
  readonly planned: number;
  readonly inFlight: number;
  readonly ready: number;
  readonly committed: number;
  readonly retained: number;
  readonly failed: number;
  readonly empty: number;
}

export interface NovaTileEventMap<Payload = unknown> {
  plan: TilePlanEvent;
  statechange: TileStateChangeEvent;
  result: TileAsyncResult<Payload>;
  error: NovaTileError;
  stats: TileStats;
  idle: { readonly stats: TileStats };
}

/** 独立于 DOM 的 typed event emitter。 */
export class NovaTileEventEmitter<EventMap extends object> {
  readonly #listeners = new Map<keyof EventMap, Set<(event: never) => void>>();

  on<Type extends keyof EventMap>(type: Type, listener: (event: EventMap[Type]) => void): () => void {
    let listeners = this.#listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    const stored = listener as (event: never) => void;
    listeners.add(stored);
    return () => {
      listeners?.delete(stored);
      if (listeners?.size === 0) {
        this.#listeners.delete(type);
      }
    };
  }

  emit<Type extends keyof EventMap>(type: Type, event: EventMap[Type]): void {
    const listeners = this.#listeners.get(type);
    if (listeners === undefined) {
      return;
    }
    for (const listener of [...listeners]) {
      (listener as (value: EventMap[Type]) => void)(event);
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
