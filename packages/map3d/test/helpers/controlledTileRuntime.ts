import type { TileCoverageEntry } from '../../src/spatial/tileCoverage.js';
import type { CanonicalTileKey } from '../../src/types.js';
import type {
  TileRuntimeFetchResult,
  TileRuntimeRenderAdapter,
  TileRuntimeRenderInput,
  TileRuntimeSourceAdapter,
  TileRuntimeWorkerAdapter,
  TileRuntimeWorkerInput,
} from '../../src/runtime/tileRuntimeTypes.js';
import type {
  TileRuntimeJob,
  TileRuntimeResource,
} from '../../src/runtime/tileRecord.js';

export class FakeTileRuntimeClock {
  value = 0;

  now(): number {
    return this.value;
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

interface SourceCall {
  key: CanonicalTileKey;
  signal: AbortSignal;
  deferred: Deferred<TileRuntimeFetchResult>;
  onProgress: ((loadedBytes: number, totalBytes?: number) => void) | undefined;
}

export class ControlledTileSource implements TileRuntimeSourceAdapter {
  readonly calls: SourceCall[] = [];
  disposeCount = 0;
  readonly #respectAbort: boolean;
  readonly #onDispose: (() => void) | undefined;

  constructor(options: { respectAbort?: boolean; onDispose?: () => void } = {}) {
    this.#respectAbort = options.respectAbort ?? true;
    this.#onDispose = options.onDispose;
  }

  fetch(
    key: CanonicalTileKey,
    options: {
      signal: AbortSignal;
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    },
  ): Promise<TileRuntimeFetchResult> {
    const deferred = new Deferred<TileRuntimeFetchResult>();
    const call = {
      key,
      signal: options.signal,
      deferred,
      onProgress: options.onProgress,
    };
    this.calls.push(call);
    if (this.#respectAbort) {
      options.signal.addEventListener(
        'abort',
        () => deferred.reject(options.signal.reason),
        { once: true },
      );
    }
    return deferred.promise;
  }

  resolve(key: CanonicalTileKey, result: TileRuntimeFetchResult): void {
    this.#pending(key).deferred.resolve(result);
  }

  reject(key: CanonicalTileKey, error: unknown): void {
    this.#pending(key).deferred.reject(error);
  }

  reportProgress(
    key: CanonicalTileKey,
    loadedBytes: number,
    totalBytes?: number,
  ): void {
    this.#pending(key).onProgress?.(loadedBytes, totalBytes);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.#onDispose?.();
  }

  #pending(key: CanonicalTileKey): SourceCall {
    const call = [...this.calls]
      .reverse()
      .find((candidate) => sameKey(candidate.key, key) && !candidate.deferred.settled);
    if (call === undefined) {
      throw new Error('未找到待处理的 Source call。');
    }
    return call;
  }
}

interface WorkerCall<Payload> {
  input: TileRuntimeWorkerInput;
  deferred: Deferred<Payload>;
  cancelCount: number;
}

export class ControlledTileWorker<Payload>
implements TileRuntimeWorkerAdapter<Payload> {
  readonly calls: WorkerCall<Payload>[] = [];
  disposeCount = 0;
  readonly #respectCancel: boolean;
  readonly #onDispose: (() => void) | undefined;

  constructor(
    options: { respectCancel?: boolean; onDispose?: () => void } = {},
  ) {
    this.#respectCancel = options.respectCancel ?? true;
    this.#onDispose = options.onDispose;
  }

  enqueue(input: TileRuntimeWorkerInput): TileRuntimeJob<Payload> {
    const deferred = new Deferred<Payload>();
    const call: WorkerCall<Payload> = {
      input,
      deferred,
      cancelCount: 0,
    };
    this.calls.push(call);
    return {
      result: deferred.promise,
      cancel: (reason = new DOMException('测试 Worker 取消。', 'AbortError')) => {
        call.cancelCount += 1;
        if (this.#respectCancel) {
          deferred.reject(reason);
        }
      },
    };
  }

  resolve(key: CanonicalTileKey, payload: Payload): void {
    this.#pending(key).deferred.resolve(payload);
  }

  reject(key: CanonicalTileKey, error: unknown): void {
    this.#pending(key).deferred.reject(error);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.#onDispose?.();
  }

  #pending(key: CanonicalTileKey): WorkerCall<Payload> {
    const call = [...this.calls]
      .reverse()
      .find((candidate) => sameKey(candidate.input.key, key) && !candidate.deferred.settled);
    if (call === undefined) {
      throw new Error('未找到待处理的 Worker call。');
    }
    return call;
  }
}

interface RenderCall<Payload> {
  input: TileRuntimeRenderInput<Payload>;
  deferred: Deferred<TileRuntimeResource>;
}

export class ControlledTileRender<Payload>
implements TileRuntimeRenderAdapter<Payload> {
  readonly calls: RenderCall<Payload>[] = [];
  disposeCount = 0;
  readonly #onDispose: (() => void) | undefined;

  constructor(onDispose?: () => void) {
    this.#onDispose = onDispose;
  }

  upload(input: TileRuntimeRenderInput<Payload>): Promise<TileRuntimeResource> {
    const deferred = new Deferred<TileRuntimeResource>();
    this.calls.push({ input, deferred });
    return deferred.promise;
  }

  resolve(key: CanonicalTileKey, resource: TileRuntimeResource): void {
    this.#pending(key).deferred.resolve(resource);
  }

  reject(key: CanonicalTileKey, error: unknown): void {
    this.#pending(key).deferred.reject(error);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.#onDispose?.();
  }

  #pending(key: CanonicalTileKey): RenderCall<Payload> {
    const call = [...this.calls]
      .reverse()
      .find((candidate) => sameKey(candidate.input.key, key) && !candidate.deferred.settled);
    if (call === undefined) {
      throw new Error('未找到待处理的 Render call。');
    }
    return call;
  }
}

export class FakeTileResource implements TileRuntimeResource {
  disposeCount = 0;

  constructor(
    readonly cpuBytes: number,
    readonly gpuBytes: number,
    readonly stats = {
      batches: 1,
      features: 1,
      vertices: 3,
      indices: 3,
      objects: 2,
    },
    readonly onDispose?: () => void,
  ) {}

  dispose(): void {
    this.disposeCount += 1;
    this.onDispose?.();
  }
}

export function createCoverageEntry(
  key: CanonicalTileKey,
  options: {
    wrap?: number;
    kind?: 'visible' | 'prefetch';
    role?: TileCoverageEntry['priority']['role'];
    screenDistance?: number;
    coverageRank?: number;
    notBefore?: number;
  } = {},
): TileCoverageEntry {
  const kind = options.kind ?? 'visible';
  return {
    key: { canonical: key, wrap: options.wrap ?? 0 },
    kind,
    priority: {
      role: options.role ?? (kind === 'visible' ? 'coverage' : 'prefetch'),
      visible: kind === 'visible',
      screenDistance: options.screenDistance ?? 0,
      ...(options.coverageRank === undefined
        ? {}
        : { coverageRank: options.coverageRank }),
      ...(options.notBefore === undefined
        ? {}
        : { notBefore: options.notBefore }),
    },
  };
}

export async function flushTileRuntime(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  settled = false;
  #resolve!: (value: Value) => void;
  #reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  resolve(value: Value): void {
    if (!this.settled) {
      this.settled = true;
      this.#resolve(value);
    }
  }

  reject(reason: unknown): void {
    if (!this.settled) {
      this.settled = true;
      this.#reject(reason);
    }
  }
}

function sameKey(left: CanonicalTileKey, right: CanonicalTileKey): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.z === right.z &&
    left.x === right.x &&
    left.y === right.y
  );
}
