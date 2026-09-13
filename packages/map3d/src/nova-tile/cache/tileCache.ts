import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';

export type CacheRole = 'resident' | 'warm' | 'cold';
export type CacheRecordState = 'ready' | 'empty' | 'negative' | 'retryable';

export interface TileCacheEntry<Payload = unknown> {
  readonly key: CanonicalTileKey;
  readonly generation: number;
  readonly state: CacheRecordState;
  readonly payload?: Payload;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly role: CacheRole;
  readonly pinned: boolean;
  readonly lastAccessedAt: number;
  readonly retryAt?: number;
  readonly error?: unknown;
}

export interface TileCacheOptions {
  readonly maxEntries?: number;
  readonly maxCpuBytes?: number;
  readonly maxGpuBytes?: number;
}

export interface TileCacheStats {
  readonly entries: number;
  readonly resident: number;
  readonly warm: number;
  readonly cold: number;
  readonly ready: number;
  readonly empty: number;
  readonly negative: number;
  readonly retryable: number;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly maxEntries: number;
  readonly maxCpuBytes: number;
  readonly maxGpuBytes: number;
  readonly readyHits: number;
  readonly emptyHits: number;
  readonly negativeHits: number;
  readonly evictions: number;
  readonly pressure: boolean;
  readonly pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[];
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_CPU = 128 * 1024 * 1024;
const DEFAULT_MAX_GPU = 256 * 1024 * 1024;

/** 四层缓存的内存层：Resident/Warm/Cold 由 role 表示，Persistent 由独立 store 提供。 */
export class TileCache<Payload = unknown> {
  readonly #maxEntries: number;
  readonly #maxCpuBytes: number;
  readonly #maxGpuBytes: number;
  readonly #entries = new Map<string, TileCacheEntry<Payload>>();
  #cpuBytes = 0;
  #gpuBytes = 0;
  #readyHits = 0;
  #emptyHits = 0;
  #negativeHits = 0;
  #evictions = 0;
  #pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[] = Object.freeze([]);

  constructor(options: TileCacheOptions = {}) {
    this.#maxEntries = positive(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 'maxEntries');
    this.#maxCpuBytes = nonNegative(options.maxCpuBytes ?? DEFAULT_MAX_CPU, 'maxCpuBytes');
    this.#maxGpuBytes = nonNegative(options.maxGpuBytes ?? DEFAULT_MAX_GPU, 'maxGpuBytes');
  }

  get(key: CanonicalTileKey, now = Date.now()): TileCacheEntry<Payload> | undefined {
    const id = canonicalTileKeyToString(key);
    const entry = this.#entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.state === 'ready') this.#readyHits += 1;
    else if (entry.state === 'empty') this.#emptyHits += 1;
    else if (entry.state === 'negative') this.#negativeHits += 1;
    const accessed = { ...entry, lastAccessedAt: now };
    this.#entries.set(id, accessed);
    return accessed;
  }

  peek(key: CanonicalTileKey): TileCacheEntry<Payload> | undefined { return this.#entries.get(canonicalTileKeyToString(key)); }

  set(entry: TileCacheEntry<Payload>): readonly CanonicalTileKey[] {
    validateEntry(entry);
    const id = canonicalTileKeyToString(entry.key);
    const previous = this.#entries.get(id);
    if (previous !== undefined) { this.#cpuBytes -= previous.cpuBytes; this.#gpuBytes -= previous.gpuBytes; }
    this.#entries.set(id, Object.freeze({ ...entry }));
    this.#cpuBytes += entry.cpuBytes; this.#gpuBytes += entry.gpuBytes;
    return this.evictToBudget();
  }

  remove(key: CanonicalTileKey): boolean {
    const id = canonicalTileKeyToString(key);
    const entry = this.#entries.get(id);
    if (entry === undefined) return false;
    this.#entries.delete(id); this.#cpuBytes -= entry.cpuBytes; this.#gpuBytes -= entry.gpuBytes; return true;
  }

  promote(key: CanonicalTileKey, role: CacheRole, pinned = false, now = Date.now()): boolean {
    const id = canonicalTileKeyToString(key); const entry = this.#entries.get(id); if (entry === undefined) return false;
    this.#entries.set(id, Object.freeze({ ...entry, role, pinned, lastAccessedAt: now })); return true;
  }

  clear(): void { this.#entries.clear(); this.#cpuBytes = 0; this.#gpuBytes = 0; this.#pressureReasons = Object.freeze([]); }
  has(key: CanonicalTileKey): boolean { return this.#entries.has(canonicalTileKeyToString(key)); }
  entries(): readonly TileCacheEntry<Payload>[] { return Object.freeze([...this.#entries.values()]); }
  get size(): number { return this.#entries.size; }
  get stats(): TileCacheStats { return this.getStats(); }

  getStats(): TileCacheStats {
    let resident = 0; let warm = 0; let cold = 0; let ready = 0; let empty = 0; let negative = 0; let retryable = 0;
    for (const entry of this.#entries.values()) { if (entry.role === 'resident') resident += 1; else if (entry.role === 'warm') warm += 1; else cold += 1; if (entry.state === 'ready') ready += 1; else if (entry.state === 'empty') empty += 1; else if (entry.state === 'negative') negative += 1; else retryable += 1; }
    return Object.freeze({ entries: this.#entries.size, resident, warm, cold, ready, empty, negative, retryable, cpuBytes: this.#cpuBytes, gpuBytes: this.#gpuBytes, maxEntries: this.#maxEntries, maxCpuBytes: this.#maxCpuBytes, maxGpuBytes: this.#maxGpuBytes, readyHits: this.#readyHits, emptyHits: this.#emptyHits, negativeHits: this.#negativeHits, evictions: this.#evictions, pressure: this.#pressureReasons.length > 0, pressureReasons: this.#pressureReasons });
  }

  private evictToBudget(): readonly CanonicalTileKey[] {
    const evicted: CanonicalTileKey[] = [];
    while (this.#entries.size > this.#maxEntries || this.#cpuBytes > this.#maxCpuBytes || this.#gpuBytes > this.#maxGpuBytes) {
      const candidate = [...this.#entries.values()].filter((entry) => !entry.pinned && entry.role !== 'resident').sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0];
      if (candidate === undefined) break;
      this.remove(candidate.key); this.#evictions += 1; evicted.push(candidate.key);
    }
    const reasons: ('entries' | 'cpu' | 'gpu')[] = [];
    if (this.#entries.size > this.#maxEntries) reasons.push('entries');
    if (this.#cpuBytes > this.#maxCpuBytes) reasons.push('cpu');
    if (this.#gpuBytes > this.#maxGpuBytes) reasons.push('gpu');
    this.#pressureReasons = Object.freeze(reasons);
    return Object.freeze(evicted);
  }
}

function validateEntry<Payload>(entry: TileCacheEntry<Payload>): void {
  if (!Number.isSafeInteger(entry.generation) || entry.generation < 0 || !Number.isFinite(entry.cpuBytes) || entry.cpuBytes < 0 || !Number.isFinite(entry.gpuBytes) || entry.gpuBytes < 0 || !Number.isFinite(entry.lastAccessedAt)) throw new RangeError('TileCacheEntry 数值字段无效。');
}
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负有限数值。`); return value; }
