import type { Map3DOptions } from '../types.js';
import { bindingBytes } from '../style/palette.js';
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
export type TileState = 'queued' | 'fetching' | 'decoded' | 'painting' | 'upload' | 'preparing' | 'ready' | 'failed';
export interface TileEntry {
  address: Address; key: string; state: TileState;
  priority: number; kind: DemandKind; touched: number; lastWanted: number; attempts: number; retryAt: number;
  buffer?: ArrayBuffer; result?: PaintResponse; surface?: Surface; controller?: AbortController;
  features: number; empty: boolean; reservedBytes: number; startedAt: number;
  primaryEmpty?: boolean;
  /** 已计入预算的 CPU/GPU 字节快照；预算合计只按差值增量维护。 */
  accountedCpu: number; accountedGpu: number;
}
export const resultBytes = (result?: PaintResponse): number => result?.bitmap
  ? result.bitmap.width * result.bitmap.height * 4 + lineBytes(result.lines) + fillBytes(result.fills) + buildingBytes(result.buildings) + labelBytes(result.labels)
    + [result.lines, result.fills, result.buildings].reduce((sum, item) => sum + (item ? bindingBytes(item) : 0), 0) : 0;

/** 回访保护窗口：最近仍有需求的条目在窗口内不被淘汰或释放，短时间回访不产生重载请求。 */
export const REVISIT_PROTECT_MS = 8000;
/** 空内容登记上限；超出后整体重来，避免长期会话无界增长。 */
const RESOLVED_EMPTY_LIMIT = 8192;

/** canonical 数据、CPU 产物和 GPU 资源独立登记，显示依赖由协调器提供。 */
export class TileStore {
  readonly available = new TileAvailability();
  readonly entries = new Map<string, TileEntry>();
  /**
   * 已确认无内容（主源与全部辅助来源均返回空）的 canonical 键登记。
   * 与 available 分离：空区域没有可绘制表面，不能参与覆盖补丁；
   * 但条目淘汰后登记仍保留，回退规划据此跳过已知空区域，回访不再重复请求祖先。
   */
  readonly resolvedEmpty = new Set<string>();
  /** 阶段索引：流水线与诊断按阶段遍历，避免每帧全量扫描并过滤所有条目。 */
  readonly buckets = new Map<TileState, Set<TileEntry>>();
  readonly maxEntries: number; readonly maxCpuBytes: number; readonly maxGpuBytes: number;
  evictions = 0;
  #cpuBytes = 0; #gpuBytes = 0;
  constructor(readonly surfaces: TileSurfaces, options: Map3DOptions['cache'], readonly protectedKeys: ReadonlySet<string>) {
    this.maxEntries = options?.maxTileEntries ?? TILE_LIMITS.entries;
    this.maxCpuBytes = options?.maxCpuBytes ?? TILE_LIMITS.cpuBytes;
    this.maxGpuBytes = options?.maxGpuBytes ?? TILE_LIMITS.gpuBytes;
  }
  /** 条目字节合计为增量维护；表面几何计入共享几何总量。 */
  get cpuBytes(): number { return this.#cpuBytes + this.surfaces.geometryBytes; }
  get gpuBytes(): number { return this.#gpuBytes + this.surfaces.geometryBytes; }
  /** 拥有指定阶段的条目集合；修改条目阶段必须经 setState。 */
  bucket(state: TileState): ReadonlySet<TileEntry> | undefined { return this.buckets.get(state); }
  get pendingWork(): number {
    let pending = 0;
    for (const [state, items] of this.buckets) if (state !== 'ready' && state !== 'failed') pending += items.size;
    return pending;
  }
  /** 仍在需求中的待处理条目数；空闲判定使用该计数。 */
  get requestedWork(): number {
    let pending = 0;
    for (const [state, items] of this.buckets) {
      if (state === 'ready' || state === 'failed') continue;
      for (const entry of items) if (Number.isFinite(entry.priority)) pending++;
    }
    return pending;
  }
  create(address: Address, kind: DemandKind, priority: number, now: number): TileEntry | undefined {
    const key = canonicalKey(address); const existing = this.entries.get(key); if (existing) return existing;
    if (this.entries.size >= this.maxEntries && !this.makeRoom(0, 0, 1, priority)) return;
    const entry: TileEntry = { address: canonical(address), key, kind, priority, state: 'queued', touched: now, lastWanted: now, attempts: 0, retryAt: 0, features: 0, empty: false, reservedBytes: 0, startedAt: 0, accountedCpu: 0, accountedGpu: 0 };
    this.entries.set(key, entry); this.addToBucket(entry); return entry;
  }
  /** 阶段切换同时维护阶段索引；重复设置同一阶段无副作用。 */
  setState(entry: TileEntry, state: TileState): void {
    if (entry.state === state) return;
    this.buckets.get(entry.state)?.delete(entry);
    entry.state = state;
    this.addToBucket(entry);
  }
  /** 任何影响 CPU/GPU 字节的字段变更后调用；只按差值更新合计。 */
  refreshBytes(entry: TileEntry): void {
    const cpu = (entry.buffer?.byteLength ?? 0) + resultBytes(entry.result) + entry.reservedBytes + (entry.surface?.cpuBytes ?? 0);
    const gpu = entry.surface?.bytes ?? 0;
    if (cpu !== entry.accountedCpu) { this.#cpuBytes += cpu - entry.accountedCpu; entry.accountedCpu = cpu; }
    if (gpu !== entry.accountedGpu) { this.#gpuBytes += gpu - entry.accountedGpu; entry.accountedGpu = gpu; }
  }
  /** 空响应登记为已解析事实；条目淘汰后仍保留，回退规划据此跳过重复祖先请求。 */
  markEmpty(entry: TileEntry): void {
    entry.empty = true;
    if (!this.resolvedEmpty.has(entry.key) && this.resolvedEmpty.size >= RESOLVED_EMPTY_LIMIT) this.resolvedEmpty.clear();
    this.resolvedEmpty.add(entry.key);
  }
  /** 条目仍在时以条目为准；条目已淘汰时回落到已解析空登记。 */
  isEmpty(address: Address): boolean {
    const key = canonicalKey(address);
    return this.entries.get(key)?.empty === true || this.resolvedEmpty.has(key);
  }
  makeRoom(cpu = 0, gpu = 0, slots = 0, priority = -Infinity, exclude?: string): boolean {
    const enough = () => this.cpuBytes + cpu <= this.maxCpuBytes && this.gpuBytes + gpu <= this.maxGpuBytes && this.entries.size + slots <= this.maxEntries;
    if (enough()) return true;
    // 第一轮跳过最近仍有需求的条目：回访所需的瓦片不应在失去需求的瞬间被淘汰。
    if (this.evict(enough, slots, priority, exclude, performance.now() - REVISIT_PROTECT_MS)) return true;
    return this.evict(enough, slots, priority, exclude, Infinity);
  }
  /** 淘汰本轮允许的候选，直到预算满足或候选耗尽；protectSince 之后的 lastWanted 受保护。 */
  private evict(enough: () => boolean, slots: number, priority: number, exclude: string | undefined, protectSince: number): boolean {
    const candidates = [...this.entries.values()].filter(e => e.key !== exclude && !this.protectedKeys.has(e.key)
      && (!e.empty || this.entries.size + slots > this.maxEntries)
      && e.state !== 'fetching' && e.state !== 'painting' && e.state !== 'preparing' && e.priority > priority
      && e.lastWanted < protectSince)
      .sort((a, b) => b.priority - a.priority || a.lastWanted - b.lastWanted || a.touched - b.touched);
    for (const entry of candidates) {
      this.release(entry); this.evictions++;
      if (enough()) return true;
    }
    return enough();
  }
  release(entry: TileEntry): void {
    this.available.delete(entry.key); entry.controller?.abort(); entry.result?.bitmap?.close();
    if (entry.surface) this.surfaces.release(entry.surface);
    this.buckets.get(entry.state)?.delete(entry);
    this.#cpuBytes -= entry.accountedCpu; this.#gpuBytes -= entry.accountedGpu;
    entry.accountedCpu = 0; entry.accountedGpu = 0; entry.reservedBytes = 0;
    delete entry.result; delete entry.buffer; delete entry.surface;
    this.entries.delete(entry.key);
  }
  dispose(): void { for (const entry of [...this.entries.values()]) this.release(entry); this.buckets.clear(); this.resolvedEmpty.clear(); }
  private addToBucket(entry: TileEntry): void {
    let items = this.buckets.get(entry.state);
    if (items === undefined) { items = new Set(); this.buckets.set(entry.state, items); }
    items.add(entry);
  }
}
