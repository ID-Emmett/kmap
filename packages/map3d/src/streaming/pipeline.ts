import { surfaceStateBytes } from './surfaceBytes.js';
import type { Camera, WebGPURenderer } from 'three/webgpu';
import type { Map3DOptions, MapError } from '../types.js';
import { requestTile } from './tileRequest.js';
import { PaintWorkers } from './workers.js';
import { Samples } from './samples.js';
import { TILE_LIMITS } from './limits.js';
import { REVISIT_PROTECT_MS, resultBytes, TileStore, type TileEntry, type TileState } from './tileStore.js';
import { lineBytes } from './lines.js';
import { buildingBytes } from './buildings.js';
import { fillBytes } from './fills.js';
import { OverlayCache, ResponseCapacityError } from './overlayCache.js';

/** 网络、Worker 和上传分别准入，已解码数据可在 CPU 等待新的可见需求。 */
export class TilePipeline {
  readonly overlays = new OverlayCache();
  readonly workers = new PaintWorkers();
  readonly workerTime = new Samples(); readonly uploadTime = new Samples(); readonly httpTime = new Samples(); readonly requestTime = new Samples();
  httpStarts = 0;
  starts = 0; cancels = 0; queueCancels = 0; retries = 0; errors = 0; bytes = 0; active = 0; discardedBytes = 0;
  disposed = false; private dispatch = 0; private buildDispatch = 0; private uploadDispatch = 0;
  predictionUrgentUntil = 0;
  /** 上传阶段最近一次的创建与编译耗时；同一对象复用。 */
  readonly uploadPhases = { create: 0, compile: 0 };
  private dirty = true; private nextPump = 0;
  invalidate(): void { this.dirty = true; }
  readonly recentErrors: { at: number; key: string; phase: 'request' | 'build'; message: string; attempt: number }[] = [];
  constructor(readonly store: TileStore, readonly options: Map3DOptions, readonly renderer: WebGPURenderer, readonly background: string,
    readonly changed: () => void, readonly log: (type: string, key: string) => void, readonly onError: (error: MapError) => void) {}
  private alive(entry: TileEntry): boolean { return !this.disposed && this.store.entries.get(entry.key) === entry; }
  /** 仅对指定阶段内仍在需求中的条目排序，避免每帧扫描全部条目。 */
  private ranked(state: TileState): TileEntry[] {
    const items: TileEntry[] = [];
    for (const entry of this.store.bucket(state) ?? []) if (Number.isFinite(entry.priority)) items.push(entry);
    return items.sort((a, b) => a.priority - b.priority);
  }
  private countRanked(state: TileState): number {
    let count = 0;
    for (const entry of this.store.bucket(state) ?? []) if (Number.isFinite(entry.priority)) count++;
    return count;
  }
  pump(now: number): void {
    if (!this.dirty && now < this.nextPump) return;
    this.dirty = false; this.nextPump = now + 64;
    // 失去需求的条目按阶段集合清理，队列取消、上传丢弃和中止分别独立计量。
    // 回访保护窗口内的条目即使当前无需求也继续保留：视图抖动或短时间回访不应重复下载。
    for (const entry of [...(this.store.bucket('queued') ?? [])]) {
      if (Number.isFinite(entry.priority) || this.store.protectedKeys.has(entry.key)) continue;
      if (now - entry.lastWanted < REVISIT_PROTECT_MS) continue;
      this.store.release(entry); this.queueCancels++;
    }
    for (const entry of [...(this.store.bucket('upload') ?? [])]) {
      if (Number.isFinite(entry.priority) || this.store.protectedKeys.has(entry.key)) continue;
      if (now - entry.lastWanted < REVISIT_PROTECT_MS) continue;
      this.discardedBytes += resultBytes(entry.result); this.store.release(entry); this.log('discard-upload', entry.key);
    }
    for (const entry of [...(this.store.bucket('fetching') ?? [])]) {
      if (Number.isFinite(entry.priority) || this.store.protectedKeys.has(entry.key)) continue;
      if (now - entry.lastWanted > REVISIT_PROTECT_MS && !entry.controller?.signal.aborted) { entry.controller?.abort(); this.cancels++; this.log('abort', entry.key); }
    }
    const jobs = this.workers.getStats();
    const uploads = this.countRanked('upload');
    const decoded = this.ranked('decoded');
    const slots = Math.max(0, Math.min(TILE_LIMITS.workers - jobs.active, TILE_LIMITS.uploads - uploads - jobs.active));
    for (let i = 0; i < slots && decoded.length; i++) {
      const kind = demandSlot(this.buildDispatch++, now < this.predictionUrgentUntil);
      const index = decoded.findIndex(e => e.kind === kind);
      void this.paint(decoded.splice(index < 0 ? 0 : index, 1)[0]!);
    }
    const pending = this.ranked('queued').filter(entry => entry.retryAt <= now);
    const processing = this.countRanked('decoded') + jobs.active + uploads;
    while (this.active < TILE_LIMITS.network && this.active + processing < TILE_LIMITS.network + TILE_LIMITS.decoded && pending.length) {
      // 当前细节、必要覆盖和预测在各阶段分别获得有界调度机会。
      const kind = demandSlot(this.dispatch++, now < this.predictionUrgentUntil);
      let index = pending.findIndex(e => e.kind === kind); if (index < 0) index = 0;
      void this.fetch(pending.splice(index, 1)[0]!);
    }
  }
  /**
   * 放弃从未产出内容的无需求在途工作：它们没有可复用的解码或绘制结果，
   * 留在队列里只会让新目标的请求排在旧作业之后（层级切换时表现为空窗）。
   */
  dropValueless(): void {
    for (const state of ['queued', 'fetching'] as const) {
      for (const entry of [...(this.store.bucket(state) ?? [])]) {
        if (Number.isFinite(entry.priority) || this.store.protectedKeys.has(entry.key)) continue;
        if (entry.result !== undefined || entry.surface !== undefined) continue;
        if (state === 'fetching') { entry.controller?.abort(); this.cancels++; }
        this.store.release(entry); this.log('drop-stale', entry.key);
      }
    }
  }
  private async fetch(entry: TileEntry): Promise<void> {
    entry.startedAt = performance.now();
    this.store.setState(entry, 'fetching'); entry.attempts++; entry.controller = new AbortController();
    const controller = entry.controller; this.active++; this.starts++; this.log('fetch', entry.key);
    const timeout = setTimeout(() => controller.abort('timeout'), 8000);
    try {
      const { buffer, empty, primaryEmpty } = await requestTile(entry.address, this.options.source, entry.attempts,
        this.overlays, controller.signal, reserve => {
          if (!this.alive(entry) || !this.store.makeRoom(reserve - entry.reservedBytes, 0, 0, entry.priority, entry.key)) throw new CapacityError();
          entry.reservedBytes = reserve; this.store.refreshBytes(entry);
        }, elapsed => { if (elapsed === undefined) this.httpStarts++; else this.httpTime.add(elapsed); }, this.options.layers);
      this.bytes += buffer.byteLength;
      if (!this.alive(entry)) return;
      entry.primaryEmpty = primaryEmpty;
      entry.reservedBytes = 0;
      if (empty) { this.store.markEmpty(entry); this.store.setState(entry, 'ready'); this.store.refreshBytes(entry); this.changed(); this.log('empty', entry.key); return; }
      if (!this.store.makeRoom(buffer.byteLength, 0, 0, entry.priority, entry.key)) {
        this.discardedBytes += buffer.byteLength; this.store.setState(entry, 'queued'); entry.retryAt = performance.now() + 250; return;
      }
      entry.buffer = buffer; this.store.setState(entry, 'decoded'); entry.touched = performance.now();
    } catch (error) {
      if (!this.alive(entry)) return;
      if (error instanceof CapacityError || error instanceof ResponseCapacityError) {
        this.store.setState(entry, 'queued'); entry.retryAt = performance.now() + 250; entry.attempts--;
      } else if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
        this.store.setState(entry, 'queued'); entry.attempts = Math.max(0, entry.attempts - 1);
      } else this.fail(entry, error, 'request');
    } finally { this.dirty = true; entry.reservedBytes = 0; this.store.refreshBytes(entry); clearTimeout(timeout); this.active--; if (entry.controller === controller) delete entry.controller; }
  }
  private async paint(entry: TileEntry): Promise<void> {
    const reservation = Math.max(TILE_LIMITS.buildBytes, entry.buffer!.byteLength * 4);
    if (!this.store.makeRoom(reservation, 0, 0, entry.priority, entry.key)) return;
    entry.reservedBytes = reservation; this.store.refreshBytes(entry);
    const buffer = entry.buffer!; delete entry.buffer; this.store.setState(entry, 'painting');
    try {
      const result = await this.workers.run({ address: entry.address, buffer, spherical: this.store.surfaces.spherical, layers: this.options.layers, background: this.background, overlays: this.options.source.overlays ?? [] });
      if (!this.alive(entry)) { result.bitmap?.close(); return; }
      if (!Number.isFinite(entry.priority)) {
        this.discardedBytes += resultBytes(result); result.bitmap?.close(); this.store.release(entry); this.log('discard-build', entry.key); return;
      }
      entry.reservedBytes = 0; this.workerTime.add(result.paintMs);
      if (!this.store.makeRoom(resultBytes(result), 0, 0, entry.priority, entry.key)) {
        result.bitmap?.close(); this.store.setState(entry, 'queued'); entry.retryAt = performance.now() + 250; return;
      }
      entry.features = result.features; entry.result = result; this.store.setState(entry, 'upload'); entry.touched = performance.now(); this.log('built', entry.key);
    } catch (error) { if (this.alive(entry)) this.fail(entry, error, 'build'); }
    finally { this.dirty = true; entry.reservedBytes = 0; this.store.refreshBytes(entry); }
  }
  upload(now: number, camera: Camera): void {
    // 允许有限并发准备：编译在浏览器侧异步推进，不再阻塞后续几何与纹理创建。
    if ((this.store.bucket('preparing')?.size ?? 0) >= TILE_LIMITS.prepares) return;
    const start = performance.now(); let bytes = 0; let count = 0;
    const queue = this.ranked('upload');
    const preferred = queue.findIndex(e => e.kind === demandSlot(this.uploadDispatch, now < this.predictionUrgentUntil));
    if (preferred > 0) queue.unshift(queue.splice(preferred, 1)[0]!);
    for (const entry of queue) {
      const result = entry.result; if (!result?.bitmap) continue;
      const patchBytes = this.store.surfaces.patchBytes(entry.address);
      const stateBytes = surfaceStateBytes(result.lines, result.buildings);
      // 位图不进入 GPU；预算只登记几何、区域缓冲与状态缓冲。
      const gpu = lineBytes(result.lines) + fillBytes(result.fills) + buildingBytes(result.buildings) + patchBytes + stateBytes;
      if (count && (bytes + gpu > TILE_LIMITS.uploadBytes || performance.now() - start >= TILE_LIMITS.uploadMs)) break;
      if (!this.store.makeRoom(patchBytes + stateBytes, gpu, 0, entry.priority, entry.key)) continue;
      const time = performance.now();
      const surface = this.store.surfaces.create(result.bitmap, entry.address, result.lines, result.fills, result.buildings, result.labels);
      this.uploadPhases.create = performance.now() - time;
      entry.surface = surface; delete entry.result; this.store.setState(entry, 'preparing'); this.store.refreshBytes(entry);
      // 编译全部绘制管线后原子发布，覆盖树只消费 GPU 可绘制资源。
      surface.mesh.visible = true;
      const compileStart = performance.now();
      void this.renderer.compileAsync(surface.mesh, camera, this.store.surfaces.scene).then(() => {
        this.uploadPhases.compile = performance.now() - compileStart;
        surface.mesh.visible = false;
        if (!this.alive(entry)) return;
        this.store.setState(entry, 'ready'); entry.touched = performance.now(); this.store.available.add(entry.key);
        this.requestTime.add(performance.now() - entry.startedAt); this.changed(); this.log('ready', entry.key);
      }).catch(error => {
        if (!this.alive(entry)) return;
        this.store.surfaces.release(surface); delete entry.surface; this.store.refreshBytes(entry); this.fail(entry, error, 'build');
      }).finally(() => { this.dirty = true; });
      this.uploadTime.add(performance.now() - time);
      bytes += gpu; count++; this.uploadDispatch++;
      // 一次上传中的几何初始化也在该帧渲染阶段计入 CPU 与 GPU 成本。
      if (count >= 1) break;
    }
  }
  private fail(entry: TileEntry, error: unknown, phase: 'request' | 'build'): void {
    this.errors++; this.store.setState(entry, 'failed'); entry.retryAt = performance.now() + 500 * 2 ** entry.attempts;
    this.recentErrors.push({ at: performance.now(), key: entry.key, phase, message: String(error), attempt: entry.attempts });
    if (this.recentErrors.length > 32) this.recentErrors.shift();
    this.log('error', entry.key);
    this.onError({ code: phase === 'build' ? 'WORKER_ERROR' : 'NETWORK_ERROR', phase, message: String(error),
      recoverable: entry.attempts < 3, tileKey: { sourceId: this.options.source.id, ...entry.address }, cause: error });
    if (entry.attempts < 3) { this.store.setState(entry, 'queued'); this.retries++; }
  }
  dispose(): void { this.disposed = true; this.workers.dispose(); this.overlays.dispose(); for (const entry of [...this.store.entries.values()]) entry.controller?.abort(); }
}

/** 限制解压后的 MVT 响应体，流读取期间由条目预留上限预算。 */
class CapacityError extends Error {}
function demandSlot(index: number, urgent: boolean) {
  return urgent ? (['fallback', 'visible', 'predicted'] as const)[index % 3]!
    : index % 6 === 0 ? 'fallback' : index % 6 === 5 ? 'predicted' : 'visible';
}
