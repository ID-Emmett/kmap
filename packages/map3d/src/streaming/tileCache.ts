import type { CanonicalTileKey } from '../types.js';
import { canonicalTileKeyToString } from '../spatial/tileKey.js';
import type { StreamingRenderResource, StreamingTileState, TileStreamingRecordSnapshot } from './types.js';

export interface TileCacheEntry<Payload> {
  key: CanonicalTileKey;
  generation: number;
  state: Extract<StreamingTileState, 'ready' | 'empty' | 'failed'>;
  payload?: Payload;
  resource?: StreamingRenderResource;
  cpuBytes: number;
  gpuBytes: number;
  error?: TileStreamingRecordSnapshot['error'];
  retryAt?: number;
  pinned: boolean;
  lastAccessedAt: number;
}

export interface TileCacheOptions {
  maxEntries?: number;
  maxCpuBytes?: number;
  maxGpuBytes?: number;
}

export interface TileCacheStats {
  entries: number;
  retainedEntries: number;
  retainedReady: number;
  retainedEmpty: number;
  retainedFailed: number;
  readyHits: number;
  emptyHits: number;
  evictions: number;
  pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[];
}

/** 预算约束的 retained cache；in-flight 生命周期不进入 cache。 */
export class TileCache<Payload> {
  readonly #maxEntries: number;
  readonly #maxCpuBytes: number;
  readonly #maxGpuBytes: number;
  readonly #entries = new Map<string, TileCacheEntry<Payload>>();
  #readyHits = 0;
  #emptyHits = 0;
  #evictions = 0;

  constructor(options: TileCacheOptions = {}) {
    this.#maxEntries = normalizePositive(options.maxEntries ?? 256, 'maxEntries');
    this.#maxCpuBytes = normalizePositive(options.maxCpuBytes ?? 128 * 1024 * 1024, 'maxCpuBytes');
    this.#maxGpuBytes = normalizePositive(options.maxGpuBytes ?? 256 * 1024 * 1024, 'maxGpuBytes');
  }

  get(key: CanonicalTileKey, now: number): TileCacheEntry<Payload> | undefined {
    const entry = this.#entries.get(canonicalTileKeyToString(key));
    if (entry === undefined) return undefined;
    entry.lastAccessedAt = now;
    if (entry.state === 'ready') this.#readyHits += 1;
    if (entry.state === 'empty') this.#emptyHits += 1;
    return entry;
  }

  set(entry: TileCacheEntry<Payload>): void {
    const id = canonicalTileKeyToString(entry.key);
    const old = this.#entries.get(id);
    if (old?.resource !== entry.resource) old?.resource?.dispose();
    this.#entries.set(id, entry);
    this.evictToBudget();
  }

  pin(key: CanonicalTileKey, pinned: boolean): void {
    const entry = this.#entries.get(canonicalTileKeyToString(key));
    if (entry !== undefined) entry.pinned = pinned;
  }

  remove(key: CanonicalTileKey): boolean {
    const id = canonicalTileKeyToString(key);
    const entry = this.#entries.get(id);
    if (entry === undefined || entry.pinned) return false;
    this.#entries.delete(id);
    entry.resource?.dispose();
    return true;
  }

  evictToBudget(): readonly ('entries' | 'cpu' | 'gpu')[] {
    const evicted: ('entries' | 'cpu' | 'gpu')[] = [];
    while (this.#entries.size > this.#maxEntries || this.cpuBytes > this.#maxCpuBytes || this.gpuBytes > this.#maxGpuBytes) {
      const candidate = [...this.#entries.values()]
        .filter((entry) => !entry.pinned)
        .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)[0];
      if (candidate === undefined) break;
      this.#entries.delete(canonicalTileKeyToString(candidate.key));
      candidate.resource?.dispose();
      this.#evictions += 1;
      if (this.#entries.size >= this.#maxEntries) evicted.push('entries');
      if (this.cpuBytes > this.#maxCpuBytes) evicted.push('cpu');
      if (this.gpuBytes > this.#maxGpuBytes) evicted.push('gpu');
    }
    return Object.freeze([...new Set(evicted)]);
  }

  clear(): void {
    for (const entry of this.#entries.values()) entry.resource?.dispose();
    this.#entries.clear();
  }

  has(key: CanonicalTileKey): boolean { return this.#entries.has(canonicalTileKeyToString(key)); }
  values(): IterableIterator<TileCacheEntry<Payload>> { return this.#entries.values(); }
  get size(): number { return this.#entries.size; }
  get cpuBytes(): number { return [...this.#entries.values()].reduce((sum, entry) => sum + entry.cpuBytes, 0); }
  get gpuBytes(): number { return [...this.#entries.values()].reduce((sum, entry) => sum + entry.gpuBytes, 0); }
  get maxEntries(): number { return this.#maxEntries; }
  get maxCpuBytes(): number { return this.#maxCpuBytes; }
  get maxGpuBytes(): number { return this.#maxGpuBytes; }

  stats(): TileCacheStats {
    const entries = [...this.#entries.values()];
    const pressureReasons: ('entries' | 'cpu' | 'gpu')[] = [];
    if (this.#entries.size > this.#maxEntries) pressureReasons.push('entries');
    if (this.cpuBytes > this.#maxCpuBytes) pressureReasons.push('cpu');
    if (this.gpuBytes > this.#maxGpuBytes) pressureReasons.push('gpu');
    return {
      entries: entries.length,
      retainedEntries: entries.length,
      retainedReady: entries.filter((entry) => entry.state === 'ready').length,
      retainedEmpty: entries.filter((entry) => entry.state === 'empty').length,
      retainedFailed: entries.filter((entry) => entry.state === 'failed').length,
      readyHits: this.#readyHits,
      emptyHits: this.#emptyHits,
      evictions: this.#evictions,
      pressureReasons: Object.freeze(pressureReasons),
    };
  }
}

function normalizePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`);
  return value;
}
