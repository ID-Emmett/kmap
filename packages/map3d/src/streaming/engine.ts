import type { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import type { Map3DOptions, MapError, ViewportSize, ViewState } from '../types.js';
import { contains, keyOf, parentOf, requestUrl, tileBounds, type Address } from './address.js';
import { selectTiles, type Selection } from './selection.js';
import { Samples } from './samples.js';
import { TileSurfaces, type Surface } from './surface.js';
import { PaintWorkers } from './workers.js';
import type { PaintResponse } from './protocol.js';

export interface TileEntry {
  address: Address; key: string; state: 'queued' | 'fetching' | 'painting' | 'upload' | 'ready' | 'failed';
  priority: number; touched: number; attempts: number; retryAt: number; controller?: AbortController;
  result?: PaintResponse; surface?: Surface; shownAt?: number; features: number; empty: boolean;
}

/** 视图需求、固定并发、纹理预算、父子覆盖与 LRU 的单实例协调器。 */
export class StreamingEngine {
  readonly entries = new Map<string, TileEntry>();
  readonly workers = new PaintWorkers();
  readonly planTime = new Samples(); readonly coverTime = new Samples(); readonly recycleTime = new Samples();
  readonly workerTime = new Samples(); readonly uploadTime = new Samples(); readonly httpTime = new Samples(); readonly requestTime = new Samples();
  readonly timeline: { at: number; type: string; key: string }[] = [];
  selection: Selection = { leaves: [], priorities: new Map(), cutoff: 1, fogStart: 1, visited: 0, culled: 0 };
  readonly wanted = new Set<string>(); readonly shown = new Set<string>();
  private readonly fading = new Map<string, string>();
  readonly prefetch = new Map<string, { address: Address; until: number; priority: number }>();
  readonly maxEntries: number; readonly maxGpuBytes: number; readonly maxCpuBytes: number;
  starts = 0; cancels = 0; retries = 0; errors = 0; bytes = 0; hits = 0; misses = 0; evictions = 0;
  active = 0; gpuBytes = 0; disposed = false; uncovered = 0; targetMissing = 0; displayZoomGap = 0;
  private viewDirty = true; private lastPlan = -Infinity; private lastEvict = 0; private coverDirty = true;
  private readonly uploads: TileEntry[] = [];
  private groundCenter = { x: 0, y: 0 };
  private previousTargets = new Set<string>();
  private plannedView: ViewState | undefined;
  constructor(readonly options: Map3DOptions, readonly surfaces: TileSurfaces, readonly renderer: WebGPURenderer, readonly background: string, readonly onError: (error: MapError) => void = () => {}) {
    this.maxEntries = options.cache?.maxTileEntries ?? 384;
    this.maxGpuBytes = options.cache?.maxGpuBytes ?? 256 * 1048576;
    this.maxCpuBytes = options.cache?.maxCpuBytes ?? 256 * 1048576;
  }
  invalidate(): void { this.viewDirty = true; }
  addPrefetch(addresses: Address[], ttl = 1600, priority = 65): void {
    for (const address of addresses) {
      const key = keyOf(address); const previous = this.prefetch.get(key);
      this.prefetch.delete(key);
      this.prefetch.set(key, { address, until: Math.max(previous?.until ?? 0, performance.now() + ttl), priority: Math.min(previous?.priority ?? Infinity, priority) });
    }
    if (this.prefetch.size > 150) {
      const discard = [...this.prefetch].sort((a, b) => b[1].priority - a[1].priority || a[1].until - b[1].until).slice(0, this.prefetch.size - 150);
      for (const [key] of discard) this.prefetch.delete(key);
    }
    this.viewDirty = true;
  }
  update(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    if (this.disposed) return;
    const previous = this.plannedView;
    const center = { x: origin.meters.x + frame.target.x, y: origin.meters.y - frame.target.z };
    const sudden = !previous || Math.abs(view.zoom - previous.zoom) > .25 || Math.abs(view.pitch - previous.pitch) > 6
      || Math.abs(((view.bearing - previous.bearing + 540) % 360) - 180) > 12
      || Math.hypot(center.x - this.groundCenter.x, center.y - this.groundCenter.y) > frame.distance * .2;
    if (this.viewDirty && (sudden || now - this.lastPlan >= 45)) {
      const start = performance.now(); this.viewDirty = false; this.lastPlan = now;
      this.selection = selectTiles(camera, frame, origin, view, viewport, this.options.source.minZoom, this.options.source.maxZoom);
      this.groundCenter = center; this.plannedView = view;
      this.plan(now); this.planTime.add(performance.now() - start); this.coverDirty = true;
    }
    this.surfaces.fogCenter.value.set(frame.target.x, frame.target.z);
    this.surfaces.fogStart.value = this.selection.fogStart; this.surfaces.fogEnd.value = this.selection.cutoff;
    this.upload(now);
    if (this.coverDirty) { this.resolveCover(now); this.coverDirty = false; }
    for (const key of this.shown) {
      const entry = this.entries.get(key)!;
      this.surfaces.place(entry.surface!.mesh, entry.address, origin);
      const alpha = Math.min(1, (now - (entry.shownAt ?? now)) / 140);
      if (entry.surface!.mesh.material.opacity < 1 && alpha === 1) this.coverDirty = true;
      const incoming = this.entries.get(this.fading.get(key) ?? '');
      entry.surface!.mesh.material.opacity = incoming ? Math.max(0, 1 - (now - (incoming.shownAt ?? now)) / 140) : alpha;
      if (incoming?.surface) incoming.surface.mesh.material.opacity = 1;
    }
    this.pump(now);
    if (now - this.lastEvict > 200) { this.evict(now); this.lastEvict = now; }
  }
  private plan(now: number): void {
    const previous = new Set(this.wanted); this.wanted.clear();
    const targets = new Set(this.selection.leaves.map(keyOf));
    const demands = new Map<string, { address: Address; priority: number }>();
    const demand = (address: Address, priority: number) => {
      const key = keyOf(address); const previous = demands.get(key);
      if (!previous || priority < previous.priority) demands.set(key, { address, priority });
    };
    const admit = (address: Address, priority: number) => {
      const key = keyOf(address); this.wanted.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { address, key, state: 'queued', priority, touched: now, attempts: 0, retryAt: 0, features: 0, empty: false };
        this.entries.set(key, entry); this.misses++;
      } else {
        entry.priority = Math.min(entry.priority, priority); entry.touched = now;
        if (entry.state === 'ready' && (!previous.has(key) || (targets.has(key) && !this.previousTargets.has(key)))) this.hits++;
        if (entry.state === 'failed' && entry.attempts < 3 && now >= entry.retryAt) entry.state = 'queued';
      }
    };
    for (const entry of this.entries.values()) entry.priority = Infinity;
    for (const leaf of this.selection.leaves) {
      const priority = this.selection.priorities.get(keyOf(leaf)) ?? 0;
      demand(leaf, priority);
      let ancestor = leaf;
      const depth = leaf.z - this.options.source.minZoom;
      for (let level = 1; level <= depth && ancestor.z > this.options.source.minZoom; level++) {
        ancestor = parentOf(ancestor);
        demand(ancestor, priority + (level === 3 ? -20 : level > 3 ? 20 : 40));
        if (level === 3) {
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const neighbor = { z: ancestor.z, x: ancestor.x + dx, y: ancestor.y + dy };
            if (neighbor.y >= 0 && neighbor.y < 2 ** neighbor.z && this.insideCutoff(neighbor)) demand(neighbor, priority + 20);
          }
        }
      }
      // 一圈邻接数据为平移提供确定的提前量。
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const y = leaf.y + dy;
        const address = { z: leaf.z, x: leaf.x + dx, y };
        if (y >= 0 && y < 2 ** leaf.z && this.insideCutoff(address)) demand(address, priority + 100);
      }
    }
    for (const [key, item] of this.prefetch) {
      if (item.until < now) this.prefetch.delete(key); else demand(item.address, item.priority);
    }
    const capacity = Math.min(this.maxEntries - 20, Math.floor(Math.min(this.maxGpuBytes, this.maxCpuBytes * 4 / 3) / (512 * 512 * 4 * 4 / 3)) - 20);
    for (const item of [...demands.values()].sort((a, b) => a.priority - b.priority).slice(0, Math.max(1, capacity))) admit(item.address, item.priority);
    for (const [key, entry] of this.entries) {
      if (!this.wanted.has(key) && entry.state === 'queued') { this.entries.delete(key); this.cancels++; }
      // 已启动的短请求完成后可直接进入缓存，视图刷新只重排尚未启动的工作。
    }
    this.previousTargets = targets;
  }
  private insideCutoff(address: Address): boolean {
    const b = tileBounds(address);
    return Math.hypot(Math.max(b.west - this.groundCenter.x, 0, this.groundCenter.x - b.west - b.span), Math.max(b.north - b.span - this.groundCenter.y, 0, this.groundCenter.y - b.north)) < this.selection.cutoff;
  }
  private pump(now: number): void {
    const workerStats = this.workers.getStats();
    const capacity = Math.min(12 - this.active, 12 - this.active - workerStats.active - workerStats.queued - this.uploads.length);
    if (capacity <= 0) return;
    const queued = [...this.entries.values()].filter(e => e.state === 'queued' && this.wanted.has(e.key) && e.retryAt <= now).sort((a, b) => a.priority - b.priority);
    for (const entry of queued.slice(0, capacity)) void this.load(entry);
  }
  private async load(entry: TileEntry): Promise<void> {
    entry.state = 'fetching'; entry.attempts++; this.starts++; this.active++;
    const start = performance.now(); const controller = new AbortController(); entry.controller = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    this.log('request', entry.key);
    try {
      const response = await fetch(requestUrl(entry.address, this.options.source.tiles), { signal: controller.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = response.status === 204 ? new ArrayBuffer(0) : await response.arrayBuffer();
      this.httpTime.add(performance.now() - start); this.bytes += buffer.byteLength;
      clearTimeout(timer); this.active--; delete entry.controller;
      if (this.disposed) return;
      if (!this.wanted.has(entry.key)) { this.entries.delete(entry.key); return; }
      if (buffer.byteLength === 0) {
        entry.empty = true; entry.state = 'ready'; this.invalidate(); this.coverDirty = true; this.log('empty', entry.key); return;
      }
      entry.state = 'painting';
      const result = await this.workers.run({ address: entry.address, buffer, layers: this.options.layers, size: 512, background: this.background });
      this.workerTime.add(result.paintMs); this.requestTime.add(performance.now() - start);
      if (this.disposed) { result.bitmap?.close(); return; }
      entry.result = result; entry.features = result.features; entry.empty = result.empty; entry.state = 'upload';
      this.uploads.push(entry); this.log('painted', entry.key);
    } catch (error) {
      const phase = entry.state === 'painting' ? 'build' : 'request';
      if (entry.controller) { this.active--; delete entry.controller; }
      if (this.disposed) return;
      entry.state = 'failed'; this.errors++; entry.retryAt = performance.now() + 500 * 2 ** entry.attempts;
      this.log(String(error), entry.key);
      this.onError({ code: phase === 'build' ? 'WORKER_ERROR' : 'NETWORK_ERROR', phase, message: String(error), recoverable: entry.attempts < 3,
        tileKey: { sourceId: this.options.source.id, ...entry.address, x: ((entry.address.x % 2 ** entry.address.z) + 2 ** entry.address.z) % 2 ** entry.address.z }, cause: error });
      if (entry.attempts < 3) { entry.state = 'queued'; this.retries++; }
    } finally { clearTimeout(timer); }
  }
  private upload(now: number): void {
    const start = performance.now();
    this.uploads.sort((a, b) => a.priority - b.priority);
    for (let count = 0; count < 1 && this.uploads.length && performance.now() - start < 3; count++) {
      const entry = this.uploads.shift()!;
      if (!entry.result?.bitmap) continue;
      if (!this.wanted.has(entry.key)) { entry.result.bitmap.close(); this.entries.delete(entry.key); continue; }
      this.evict(now, Math.ceil(512 * 512 * 4 * 4 / 3), entry.priority);
      if (this.gpuBytes + Math.ceil(512 * 512 * 4 * 4 / 3) > this.maxGpuBytes) { this.uploads.unshift(entry); break; }
      const uploadStart = performance.now();
      entry.surface = this.surfaces.create(entry.result.bitmap, entry.address);
      this.renderer.initTexture(entry.surface.map);
      this.gpuBytes += entry.surface.bytes;
      entry.state = 'ready'; entry.touched = now; delete entry.result;
      this.uploadTime.add(performance.now() - uploadStart); this.coverDirty = true; this.log('ready', entry.key);
    }
  }
  private resolveCover(now: number): void {
    const start = performance.now(); const next = new Set<string>(); this.uncovered = 0; this.targetMissing = 0; this.displayZoomGap = 0; this.fading.clear();
    for (const leaf of this.selection.leaves) {
      const exact = this.entries.get(keyOf(leaf));
      if (exact?.state !== 'ready') this.targetMissing++;
      let candidate: Address = leaf; let covered = false;
      while (candidate.z >= this.options.source.minZoom) {
        const entry = this.entries.get(keyOf(candidate));
        if (entry?.state === 'ready' && !entry.empty) {
          if (!covered) this.displayZoomGap = Math.max(this.displayZoomGap, leaf.z - entry.address.z);
          next.add(entry.key); covered = true;
          if (entry.shownAt === undefined || now - entry.shownAt < 140) {
            for (const key of this.shown) if (key !== entry.key && contains(leaf, this.entries.get(key)!.address)) { next.add(key); this.fading.set(key, entry.key); }
          }
          if (entry.shownAt !== undefined && now - entry.shownAt >= 140) break;
        }
        candidate = parentOf(candidate);
      }
      if (!covered) {
        const descendants = [...this.shown].map(key => this.entries.get(key)!).filter(e => contains(leaf, e.address));
        for (const entry of descendants) next.add(entry.key);
        const area = descendants.reduce((sum, entry) => sum + 4 ** (leaf.z - entry.address.z), 0);
        if (area < .999) this.uncovered++;
      }
    }
    for (const key of this.shown) if (!next.has(key)) this.entries.get(key)!.surface!.mesh.visible = false;
    this.shown.clear();
    for (const key of next) {
      const entry = this.entries.get(key)!;
      // 交替淡入需要已有底图；最底层覆盖在进入视锥的首帧完全显示。
      const hasBackdrop = [...next].some(other => other !== key && contains(this.entries.get(other)!.address, entry.address));
      entry.shownAt ??= hasBackdrop ? now : now - 140;
      entry.surface!.mesh.visible = true; entry.touched = now; this.shown.add(key);
    }
    this.coverTime.add(performance.now() - start);
  }
  private evict(now: number, reserve = 0, incomingPriority = Infinity): void {
    const start = performance.now();
    const candidates = [...this.entries.values()].filter(e => e.state === 'ready' && !this.shown.has(e.key) && (!this.wanted.has(e.key) || e.priority > incomingPriority + 10)).sort((a, b) => b.priority - a.priority || a.touched - b.touched);
    for (const entry of candidates) {
      if (this.entries.size <= this.maxEntries && this.gpuBytes + reserve <= this.maxGpuBytes && (this.gpuBytes + reserve) * .75 <= this.maxCpuBytes) break;
      if (entry.surface) { this.surfaces.release(entry.surface); this.gpuBytes -= entry.surface.bytes; }
      this.entries.delete(entry.key); this.evictions++; this.log('evict', entry.key);
    }
    this.recycleTime.add(performance.now() - start);
    if (this.prefetch.size && [...this.prefetch.values()].some(p => p.until < now)) this.invalidate();
  }
  private log(type: string, key: string): void {
    this.timeline.push({ at: performance.now(), type, key });
    if (this.timeline.length > 2048) this.timeline.splice(0, 256);
  }
  dispose(): void {
    this.disposed = true; this.workers.dispose();
    for (const entry of this.entries.values()) { entry.controller?.abort(); entry.result?.bitmap?.close(); if (entry.surface) this.surfaces.release(entry.surface); }
    this.entries.clear(); this.shown.clear(); this.uploads.length = 0; this.prefetch.clear(); this.gpuBytes = 0; this.surfaces.dispose();
  }
}
