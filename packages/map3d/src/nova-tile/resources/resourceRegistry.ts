import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';

export type ResourceCacheRole = 'resident' | 'warm' | 'cold';

export interface TileResourceEntry<Resource = unknown> {
  readonly id: string;
  readonly tileKey: CanonicalTileKey;
  readonly resource?: Resource;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly cacheRole: ResourceCacheRole;
  readonly refCount: number;
  readonly lastUsedFrame: number;
  readonly createdFrame: number;
  readonly pendingReleaseFrame?: number;
  readonly dispose?: () => void;
}

export interface ResourceRegistryOptions {
  readonly maxCpuBytes?: number;
  readonly maxGpuBytes?: number;
  readonly maxEntries?: number;
  readonly releaseDelayFrames?: number;
}

export interface ResourceRegistryStats {
  readonly entries: number;
  readonly referencedEntries: number;
  readonly pendingReleaseEntries: number;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly resourceCount: number;
  readonly maxCpuBytes: number;
  readonly maxGpuBytes: number;
  readonly maxEntries: number;
  readonly pressure: boolean;
  readonly pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[];
  readonly releases: number;
}

export type ResourcePressureListener = (event: { readonly reasons: readonly ('entries' | 'cpu' | 'gpu')[]; readonly stats: ResourceRegistryStats }) => void;

/** 统一管理 Tile CPU/GPU ownership、引用计数和延迟释放。 */
export class TileResourceRegistry<Resource = unknown> {
  readonly #maxCpuBytes: number;
  readonly #maxGpuBytes: number;
  readonly #maxEntries: number;
  readonly #releaseDelayFrames: number;
  readonly #entries = new Map<string, TileResourceEntry<Resource>>();
  readonly #listeners = new Set<ResourcePressureListener>();
  #releases = 0;
  #frame = 0;

  constructor(options: ResourceRegistryOptions = {}) {
    this.#maxCpuBytes = nonNegative(options.maxCpuBytes ?? 128 * 1024 * 1024, 'maxCpuBytes');
    this.#maxGpuBytes = nonNegative(options.maxGpuBytes ?? 256 * 1024 * 1024, 'maxGpuBytes');
    this.#maxEntries = positive(options.maxEntries ?? 256, 'maxEntries');
    this.#releaseDelayFrames = nonNegativeInteger(options.releaseDelayFrames ?? 2, 'releaseDelayFrames');
  }

  onPressure(listener: ResourcePressureListener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  register(input: { readonly id?: string; readonly tileKey: CanonicalTileKey; readonly resource?: Resource; readonly cpuBytes: number; readonly gpuBytes: number; readonly cacheRole?: ResourceCacheRole; readonly frameId?: number; readonly dispose?: () => void }): TileResourceEntry<Resource> {
    validateBytes(input.cpuBytes, 'cpuBytes'); validateBytes(input.gpuBytes, 'gpuBytes');
    const id = input.id ?? canonicalTileKeyToString(input.tileKey);
    const frameId = input.frameId ?? this.#frame;
    const old = this.#entries.get(id);
    if (old !== undefined) this.remove(id, true);
    const entry: TileResourceEntry<Resource> = Object.freeze({ id, tileKey: input.tileKey, ...(input.resource === undefined ? {} : { resource: input.resource }), cpuBytes: input.cpuBytes, gpuBytes: input.gpuBytes, cacheRole: input.cacheRole ?? 'resident', refCount: 0, lastUsedFrame: frameId, createdFrame: frameId, ...(input.dispose === undefined ? {} : { dispose: input.dispose }) });
    this.#entries.set(id, entry);
    this.emitPressureIfNeeded();
    return entry;
  }

  retain(id: string, frameId = this.#frame): TileResourceEntry<Resource> | undefined { return this.updateReference(id, 1, frameId); }
  release(id: string, frameId = this.#frame): TileResourceEntry<Resource> | undefined { return this.updateReference(id, -1, frameId); }

  updateReference(id: string, delta: number, frameId = this.#frame): TileResourceEntry<Resource> | undefined {
    if (!Number.isSafeInteger(delta) || delta === 0) throw new RangeError('refCount delta 必须是非零安全整数。');
    const entry = this.#entries.get(id); if (entry === undefined) return undefined;
    const refCount = Math.max(0, entry.refCount + delta);
    const pendingReleaseFrame = refCount === 0 ? frameId + this.#releaseDelayFrames : undefined;
    const { pendingReleaseFrame: _pendingReleaseFrame, ...withoutPendingRelease } = entry;
    const updated = Object.freeze({ ...withoutPendingRelease, refCount, lastUsedFrame: frameId, ...(pendingReleaseFrame === undefined ? {} : { pendingReleaseFrame }) });
    this.#entries.set(id, updated); return updated;
  }

  markUsed(id: string, frameId = this.#frame): boolean { const entry = this.#entries.get(id); if (entry === undefined) return false; this.#entries.set(id, Object.freeze({ ...entry, lastUsedFrame: frameId })); return true; }
  setCacheRole(id: string, cacheRole: ResourceCacheRole): boolean { const entry = this.#entries.get(id); if (entry === undefined) return false; this.#entries.set(id, Object.freeze({ ...entry, cacheRole })); return true; }

  advanceFrame(frameId: number): readonly string[] {
    if (!Number.isSafeInteger(frameId) || frameId < this.#frame) throw new RangeError('frameId 必须单调递增。');
    this.#frame = frameId;
    const released: string[] = [];
    for (const [id, entry] of this.#entries) {
      if (entry.refCount === 0 && entry.pendingReleaseFrame !== undefined && entry.pendingReleaseFrame <= frameId) {
        this.remove(id, true); released.push(id);
      }
    }
    this.emitPressureIfNeeded();
    return Object.freeze(released);
  }

  remove(id: string, force = false): boolean {
    const entry = this.#entries.get(id); if (entry === undefined || (!force && entry.refCount > 0)) return false;
    this.#entries.delete(id); entry.dispose?.(); this.#releases += 1; return true;
  }

  clear(): void { for (const id of [...this.#entries.keys()]) this.remove(id, true); this.#entries.clear(); }
  get(id: string): TileResourceEntry<Resource> | undefined { return this.#entries.get(id); }
  entries(): readonly TileResourceEntry<Resource>[] { return Object.freeze([...this.#entries.values()]); }
  get stats(): ResourceRegistryStats { return this.getStats(); }
  getStats(): ResourceRegistryStats {
    let cpuBytes = 0; let gpuBytes = 0; let referencedEntries = 0; let pendingReleaseEntries = 0;
    for (const entry of this.#entries.values()) { cpuBytes += entry.cpuBytes; gpuBytes += entry.gpuBytes; if (entry.refCount > 0) referencedEntries += 1; if (entry.pendingReleaseFrame !== undefined) pendingReleaseEntries += 1; }
    const reasons: ('entries' | 'cpu' | 'gpu')[] = []; if (this.#entries.size > this.#maxEntries) reasons.push('entries'); if (cpuBytes > this.#maxCpuBytes) reasons.push('cpu'); if (gpuBytes > this.#maxGpuBytes) reasons.push('gpu');
    return Object.freeze({ entries: this.#entries.size, referencedEntries, pendingReleaseEntries, cpuBytes, gpuBytes, resourceCount: this.#entries.size, maxCpuBytes: this.#maxCpuBytes, maxGpuBytes: this.#maxGpuBytes, maxEntries: this.#maxEntries, pressure: reasons.length > 0, pressureReasons: Object.freeze(reasons), releases: this.#releases });
  }

  private emitPressureIfNeeded(): void { const stats = this.getStats(); if (!stats.pressure) return; const event = Object.freeze({ reasons: stats.pressureReasons, stats }); for (const listener of [...this.#listeners]) listener(event); }
}

function validateBytes(value: number, name: string): void { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负有限数值。`); }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负有限数值。`); return value; }
function nonNegativeInteger(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} 必须是非负安全整数。`); return value; }
