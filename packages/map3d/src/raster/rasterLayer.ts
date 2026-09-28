import { Scene, SRGBColorSpace, Texture, type PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import type { MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import type { RasterTileSourceOptions, ViewportSize, ViewState } from '../types.js';
import { keyOf, requestUrl, type Address } from '../streaming/address.js';
import { selectTiles, type Selection } from '../streaming/coveringTiles.js';
import { resolveRenderCover, type RenderCover } from '../streaming/renderCover.js';
import { isMissingRasterTile, rasterTargetZoom } from './rasterMath.js';
import { configureRasterTexture, createRasterDraw, placeRasterDraw, releaseRasterDraw, type RasterDraw } from './rasterSurface.js';

type RasterState = 'queued' | 'loading' | 'ready' | 'missing' | 'failed';
interface RasterEntry {
  address: Address;
  key: string;
  state: RasterState;
  priority: number;
  lastUsed: number;
  attempts: number;
  retryAt: number;
  controller?: AbortController;
  bitmap?: ImageBitmap;
  texture?: Texture;
}

const MAX_REQUESTS = 8;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8000;

/** 栅格影像独立于 MVT 规划与渲染；已就绪祖先在子级上传前保持地面覆盖。 */
export class RasterLayer {
  readonly entries = new Map<string, RasterEntry>();
  readonly draws = new Map<string, RasterDraw>();
  readonly wanted = new Set<string>();
  selection: Selection | undefined;
  cover: RenderCover = { patches: [], missing: 0, uncovered: 0, maxGap: 0 };
  starts = 0; errors = 0; cancels = 0; missing = 0; active = 0; evictions = 0;
  private enabled = false;
  private disposed = false;
  private viewDirty = true;
  private coverDirty = true;
  private lastPlan = -Infinity;
  private originX = NaN;
  private originY = NaN;
  private readonly maxEntries: number;

  constructor(readonly scene: Scene, readonly renderer: WebGPURenderer, readonly source: RasterTileSourceOptions,
    readonly onError: (key: string, error: unknown) => void = () => {}) {
    this.maxEntries = Math.max(16, source.maxTileEntries ?? 192);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.viewDirty = true;
    this.coverDirty = true;
    this.lastPlan = -Infinity;
    if (enabled) return;
    this.wanted.clear();
    for (const entry of this.entries.values()) if (entry.state === 'loading') {
      entry.controller?.abort(); this.cancels++;
    }
    for (const draw of this.draws.values()) releaseRasterDraw(draw);
    this.draws.clear();
    this.cover = { patches: [], missing: 0, uncovered: 0, maxGap: 0 };
  }

  invalidate(): void { this.viewDirty = true; }

  update(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    if (!this.enabled || this.disposed) return;
    if (this.viewDirty && now - this.lastPlan >= 16) {
      this.plan(camera, frame, origin, view, viewport, now);
      this.lastPlan = now; this.viewDirty = false;
    }
    if (this.coverDirty && this.selection) this.commit(origin);
    if (origin.meters.x !== this.originX || origin.meters.y !== this.originY) {
      for (const draw of this.draws.values()) placeRasterDraw(draw, origin);
      this.originX = origin.meters.x; this.originY = origin.meters.y;
    }
    this.pump(now);
  }

  private plan(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    const target = rasterTargetZoom(view.zoom, viewport.pixelRatio ?? 1, this.source);
    const roots = 2 ** this.source.minZoom;
    const rootCount = roots * roots;
    const preloadRoots = rootCount <= Math.min(64, Math.floor(this.maxEntries / 2));
    const maxLeaves = Math.min(128, Math.max(1, this.maxEntries - (preloadRoots ? rootCount : 0) - 8));
    this.selection = selectTiles(camera, frame, origin, view, viewport, this.source.minZoom, this.source.maxZoom, 1, maxLeaves, target);
    this.wanted.clear();
    // 全球有效根层常驻；首次覆盖建立后任意缩小和平移都有影像祖先可用。
    if (preloadRoots) for (let y = 0; y < roots; y++) for (let x = 0; x < roots; x++) {
      this.want({ z: this.source.minZoom, x, y }, 0, now);
    }
    const overview = selectTiles(camera, frame, origin, view, viewport, this.source.minZoom, this.source.maxZoom,
      1, 8, Math.max(this.source.minZoom, target - 3));
    for (const address of overview.leaves) this.want(address, 10, now);
    for (const address of this.selection.leaves) {
      this.want(address, 100 + (this.selection.priorities.get(keyOf(address)) ?? 0), now);
    }
    for (const entry of this.entries.values()) {
      if (this.wanted.has(entry.key) || entry.state !== 'loading') continue;
      entry.controller?.abort(); this.cancels++;
    }
    this.coverDirty = true;
    this.pruneOrphaned();
    this.prune();
  }

  private want(address: Address, priority: number, now: number): void {
    const key = keyOf(address);
    this.wanted.add(key);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { address, key, state: 'queued', priority, lastUsed: now, attempts: 0, retryAt: 0 };
      this.entries.set(key, entry);
    } else {
      entry.priority = Math.min(entry.priority, priority);
      entry.lastUsed = now;
      if (entry.state === 'failed' && now >= entry.retryAt) entry.state = 'queued';
    }
  }

  private pump(now: number): void {
    if (this.active >= MAX_REQUESTS) return;
    for (const entry of this.entries.values()) if (this.wanted.has(entry.key) && entry.state === 'failed' && entry.retryAt <= now) {
      entry.state = 'queued';
    }
    const queue = [...this.entries.values()].filter(entry => this.wanted.has(entry.key) && entry.state === 'queued' && entry.retryAt <= now)
      .sort((a, b) => a.priority - b.priority);
    for (const entry of queue) {
      if (this.active >= MAX_REQUESTS) break;
      void this.load(entry);
    }
  }

  private async load(entry: RasterEntry): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller; entry.state = 'loading'; entry.attempts++; this.active++; this.starts++;
    const timeout = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    let bitmap: ImageBitmap | undefined;
    let texture: Texture | undefined;
    try {
      const url = requestUrl(entry.address, this.source.tiles);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (response.status === 204) { this.markMissing(entry); return; }
      const type = response.headers.get('content-type') ?? 'image/jpeg';
      if (!type.startsWith('image/')) throw new Error(`影像 Content-Type 无效：${type}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_BODY_BYTES) throw new Error('影像瓦片超过响应大小上限。');
      controller.signal.throwIfAborted();
      if (this.disposed || !this.enabled) return;
      if (await isMissingRasterTile(bytes, this.source.missingTileHashes)) { this.markMissing(entry); return; }
      bitmap = await createImageBitmap(new Blob([bytes], { type }), { imageOrientation: 'flipY' });
      if (bitmap.width !== this.source.tileSize || bitmap.height !== this.source.tileSize) {
        throw new Error(`影像瓦片尺寸不匹配：${bitmap.width}×${bitmap.height}`);
      }
      controller.signal.throwIfAborted();
      if (this.disposed || this.entries.get(entry.key) !== entry || !this.enabled) {
        return;
      }
      texture = new Texture(bitmap);
      texture.colorSpace = SRGBColorSpace;
      configureRasterTexture(texture);
      this.renderer.initTexture(texture);
      entry.bitmap = bitmap; entry.texture = texture; entry.state = 'ready'; entry.lastUsed = performance.now();
      bitmap = undefined; texture = undefined;
      this.coverDirty = true;
      this.prune();
    } catch (error) {
      if ((controller.signal.aborted && controller.signal.reason !== 'timeout') || this.disposed || this.entries.get(entry.key) !== entry) {
        if (!this.disposed && this.entries.get(entry.key) === entry) entry.state = 'queued';
      } else {
        this.errors++; entry.state = 'failed'; entry.retryAt = performance.now() + Math.min(30_000, 500 * 2 ** entry.attempts);
        this.onError(entry.key, error);
      }
    } finally {
      clearTimeout(timeout);
      texture?.dispose(); bitmap?.close();
      if (entry.controller === controller) delete entry.controller;
      this.active--;
    }
  }

  private markMissing(entry: RasterEntry): void {
    this.missing++;
    entry.state = 'missing';
    this.coverDirty = true;
  }

  private commit(origin: MapOrigin): void {
    const selection = this.selection;
    if (!selection) return;
    const ready = new Set([...this.entries.values()].filter(entry => entry.state === 'ready').map(entry => entry.key));
    this.cover = resolveRenderCover(selection.leaves, ready, this.source.minZoom, selection.visible);
    const desired = new Set<string>();
    for (const patch of this.cover.patches) {
      const id = `${keyOf(patch.cell)}<-${keyOf(patch.source)}`;
      desired.add(id);
      const entry = this.entries.get(patch.key);
      if (!entry?.texture || this.draws.has(id)) continue;
      this.draws.set(id, createRasterDraw(this.scene, id, patch.source, patch.cell, entry.texture, origin));
    }
    for (const [id, draw] of this.draws) if (!desired.has(id)) {
      releaseRasterDraw(draw); this.draws.delete(id);
    }
    this.coverDirty = false;
    this.prune();
  }

  private prune(): void {
    if (this.entries.size <= this.maxEntries) return;
    const protectedKeys = new Set([...this.wanted, ...[...this.draws.values()].map(draw => keyOf(draw.source))]);
    const candidates = [...this.entries.values()].filter(entry => !protectedKeys.has(entry.key) && entry.state !== 'loading')
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of candidates) {
      if (this.entries.size <= this.maxEntries) break;
      this.release(entry); this.evictions++;
    }
  }

  /** 快速跨区时丢弃已取消的无用排队条目，保留就绪影像供返回视角复用。 */
  private pruneOrphaned(): void {
    for (const entry of [...this.entries.values()]) {
      if (this.wanted.has(entry.key) || entry.state !== 'queued' && entry.state !== 'failed') continue;
      this.release(entry); this.evictions++;
    }
  }

  private release(entry: RasterEntry): void {
    entry.controller?.abort();
    entry.texture?.dispose(); entry.bitmap?.close();
    this.entries.delete(entry.key);
  }

  getBytes(): { cpuBytes: number; gpuBytes: number } {
    let ready = 0;
    for (const entry of this.entries.values()) if (entry.texture) ready++;
    const base = ready * this.source.tileSize ** 2 * 4;
    return { cpuBytes: base, gpuBytes: base * 4 / 3 };
  }

  getDiagnostics() {
    const states = [...this.entries.values()];
    const bytes = this.getBytes();
    return { enabled: this.enabled, sourceId: this.source.id, targetZoom: this.selection?.leaves[0]?.z ?? 0,
      target: this.selection?.leaves.length ?? 0, entries: states.length, maxEntries: this.maxEntries,
      ready: states.filter(entry => entry.state === 'ready').length,
      loading: this.active, missing: this.missing, failed: states.filter(entry => entry.state === 'failed').length,
      starts: this.starts, errors: this.errors, cancels: this.cancels, evictions: this.evictions,
      patches: this.cover.patches.length, uncovered: this.cover.uncovered, drawCalls: this.draws.size,
      cpuBytes: bytes.cpuBytes, gpuBytes: bytes.gpuBytes,
      levels: Object.fromEntries([...new Set(this.cover.patches.map(patch => patch.source.z))].map(z => [z, this.cover.patches.filter(patch => patch.source.z === z).length])) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const draw of this.draws.values()) releaseRasterDraw(draw);
    this.draws.clear();
    for (const entry of [...this.entries.values()]) this.release(entry);
    this.wanted.clear();
  }
}
