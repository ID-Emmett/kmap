import type { Map3DOptions } from '../types.js';
import { canonical, canonicalKey, type Address } from './address.js';
import type { PaintResponse } from './protocol.js';
import { lineBytes } from './lines.js';
import { buildingBytes } from './buildings.js';
import { fillBytes } from './fills.js';
import type { Surface, TileSurfaces } from './surface.js';
import { TileAvailability } from './availability.js';
import { TILE_LIMITS } from './limits.js';
import { labelBytes } from '../labels/candidates.js';

export type DemandKind = 'visible' | 'fallback' | 'predicted';
export interface TileEntry {
  address: Address; key: string; state: 'queued' | 'fetching' | 'decoded' | 'painting' | 'upload' | 'ready' | 'failed';
  priority: number; kind: DemandKind; touched: number; lastWanted: number; attempts: number; retryAt: number;
  buffer?: ArrayBuffer; result?: PaintResponse; surface?: Surface; controller?: AbortController;
  features: number; empty: boolean; reservedBytes: number; startedAt: number;
}
export const resultBytes = (result?: PaintResponse): number => result?.bitmap
  ? result.bitmap.width * result.bitmap.height * 4 + lineBytes(result.lines) + fillBytes(result.fills) + buildingBytes(result.buildings) + labelBytes(result.labels) : 0;

/** canonical 数据、CPU 产物和 GPU 资源独立登记，显示依赖由协调器提供。 */
export class TileStore {
  readonly available = new TileAvailability();
  readonly entries = new Map<string, TileEntry>();
  readonly maxEntries: number; readonly maxCpuBytes: number; readonly maxGpuBytes: number;
  evictions = 0;
  constructor(readonly surfaces: TileSurfaces, options: Map3DOptions['cache'], readonly protectedKeys: ReadonlySet<string>) {
    this.maxEntries = options?.maxTileEntries ?? TILE_LIMITS.entries;
    this.maxCpuBytes = options?.maxCpuBytes ?? TILE_LIMITS.cpuBytes;
    this.maxGpuBytes = options?.maxGpuBytes ?? TILE_LIMITS.gpuBytes;
  }
  get cpuBytes(): number {
    let total = this.surfaces.geometryBytes ?? 0;
    for (const e of this.entries.values()) total += (e.surface?.cpuBytes ?? 0) + (e.buffer?.byteLength ?? 0) + resultBytes(e.result) + e.reservedBytes;
    return total;
  }
  get gpuBytes(): number { let total = this.surfaces.geometryBytes ?? 0; for (const e of this.entries.values()) total += e.surface?.bytes ?? 0; return total; }
  create(address: Address, kind: DemandKind, priority: number, now: number): TileEntry | undefined {
    const key = canonicalKey(address); const existing = this.entries.get(key); if (existing) return existing;
    if (this.entries.size >= this.maxEntries && !this.makeRoom(0, 0, 1, priority)) return;
    const entry: TileEntry = { address: canonical(address), key, kind, priority, state: 'queued', touched: now, lastWanted: now, attempts: 0, retryAt: 0, features: 0, empty: false, reservedBytes: 0, startedAt: 0 };
    this.entries.set(key, entry); return entry;
  }
  makeRoom(cpu = 0, gpu = 0, slots = 0, priority = -Infinity, exclude?: string): boolean {
    let cpuTotal = this.cpuBytes; let gpuTotal = this.gpuBytes;
    const enough = () => cpuTotal + cpu <= this.maxCpuBytes && gpuTotal + gpu <= this.maxGpuBytes && this.entries.size + slots <= this.maxEntries;
    if (enough()) return true;
    const candidates = [...this.entries.values()].filter(e => e.key !== exclude && !this.protectedKeys.has(e.key)
      && (!e.empty || this.entries.size + slots > this.maxEntries)
      && e.state !== 'fetching' && e.state !== 'painting' && e.priority > priority)
      .sort((a, b) => b.priority - a.priority || a.touched - b.touched);
    for (const entry of candidates) {
      cpuTotal -= (entry.surface?.cpuBytes ?? 0) + (entry.buffer?.byteLength ?? 0) + resultBytes(entry.result);
      gpuTotal -= entry.surface?.bytes ?? 0; this.release(entry); this.evictions++;
      if (enough()) return true;
    }
    return enough();
  }
  release(entry: TileEntry): void {
    this.available.delete(entry.key); entry.controller?.abort(); entry.result?.bitmap?.close();
    if (entry.surface) this.surfaces.release(entry.surface);
    entry.reservedBytes = 0; delete entry.result; delete entry.buffer; delete entry.surface;
    this.entries.delete(entry.key);
  }
  dispose(): void { for (const entry of this.entries.values()) this.release(entry); }
}
