import type { WebGPURenderer } from 'three/webgpu';
import type { Map3DOptions, MapError } from '../types.js';
import { requestUrl } from './address.js';
import { PaintWorkers } from './workers.js';
import { Samples } from './samples.js';
import { TILE_LIMITS } from './limits.js';
import { resultBytes, TileStore, type TileEntry } from './tileStore.js';
import { lineBytes } from './lines.js';

/** 网络、Worker 和上传分别准入，已解码数据可在 CPU 等待新的可见需求。 */
export class TilePipeline {
  readonly workers = new PaintWorkers();
  readonly workerTime = new Samples(); readonly uploadTime = new Samples(); readonly httpTime = new Samples(); readonly requestTime = new Samples();
  starts = 0; cancels = 0; queueCancels = 0; retries = 0; errors = 0; bytes = 0; active = 0; discardedBytes = 0;
  disposed = false; private dispatch = 0; private buildDispatch = 0; private uploadDispatch = 0;
  predictionUrgentUntil = 0;
  readonly recentErrors: { at: number; key: string; phase: 'request' | 'build'; message: string; attempt: number }[] = [];
  constructor(readonly store: TileStore, readonly options: Map3DOptions, readonly renderer: WebGPURenderer, readonly background: string,
    readonly changed: () => void, readonly log: (type: string, key: string) => void, readonly onError: (error: MapError) => void) {}
  private alive(entry: TileEntry): boolean { return !this.disposed && this.store.entries.get(entry.key) === entry; }
  pump(now: number): void {
    const entries = [...this.store.entries.values()];
    for (const e of entries) {
      if (Number.isFinite(e.priority) || this.store.protectedKeys.has(e.key)) continue;
      if (e.state === 'queued') { this.store.release(e); this.queueCancels++; }
      else if (e.state === 'upload') {
        this.discardedBytes += resultBytes(e.result); this.store.release(e); this.log('discard-upload', e.key);
      }
      else if (e.state === 'fetching' && now - e.lastWanted > 250 && !e.controller?.signal.aborted) { e.controller?.abort(); this.cancels++; this.log('abort', e.key); }
    }
    const jobs = this.workers.getStats();
    const uploads = entries.filter(e => e.state === 'upload' && Number.isFinite(e.priority)).length;
    const decoded = entries.filter(e => e.state === 'decoded' && Number.isFinite(e.priority)).sort((a, b) => a.priority - b.priority);
    const slots = Math.max(0, Math.min(TILE_LIMITS.workers - jobs.active, TILE_LIMITS.uploads - uploads - jobs.active));
    for (let i = 0; i < slots && decoded.length; i++) {
      const kind = demandSlot(this.buildDispatch++, now < this.predictionUrgentUntil);
      const index = decoded.findIndex(e => e.kind === kind);
      void this.paint(decoded.splice(index < 0 ? 0 : index, 1)[0]!);
    }
    const pending = entries.filter(e => e.state === 'queued' && e.retryAt <= now && Number.isFinite(e.priority)).sort((a, b) => a.priority - b.priority);
    const processing = entries.filter(e => e.state === 'decoded' && Number.isFinite(e.priority)).length + this.workers.getStats().active + uploads;
    while (this.active < TILE_LIMITS.network && this.active + processing < TILE_LIMITS.network + TILE_LIMITS.decoded && pending.length) {
      // 当前细节、必要覆盖和预测在各阶段分别获得有界调度机会。
      const kind = demandSlot(this.dispatch++, now < this.predictionUrgentUntil);
      let index = pending.findIndex(e => e.kind === kind); if (index < 0) index = 0;
      void this.fetch(pending.splice(index, 1)[0]!);
    }
  }
  private async fetch(entry: TileEntry): Promise<void> {
    entry.startedAt = performance.now();
    entry.state = 'fetching'; entry.attempts++; entry.controller = new AbortController();
    const controller = entry.controller; const started = performance.now(); this.active++; this.starts++; this.log('fetch', entry.key);
    const timeout = setTimeout(() => controller.abort('timeout'), 8000);
    try {
      const templates = [...this.options.source.tiles];
      if (entry.attempts > 1) templates.push(...templates.splice(0, (entry.attempts - 1) % templates.length));
      const response = await fetch(requestUrl(entry.address, templates), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = response.status === 204 ? new ArrayBuffer(0) : await readTileBody(response, TILE_LIMITS.requestBytes, bytes => {
        const reserve = bytes * 2;
        if (!this.alive(entry) || !this.store.makeRoom(reserve - entry.reservedBytes, 0, 0, entry.priority, entry.key)) throw new CapacityError();
        entry.reservedBytes = reserve;
      });
      this.httpTime.add(performance.now() - started); this.bytes += buffer.byteLength;
      if (!this.alive(entry)) return;
      entry.reservedBytes = 0;
      if (!buffer.byteLength) { entry.empty = true; entry.state = 'ready'; this.changed(); this.log('empty', entry.key); return; }
      if (!this.store.makeRoom(buffer.byteLength, 0, 0, entry.priority, entry.key)) {
        this.discardedBytes += buffer.byteLength; entry.state = 'queued'; entry.retryAt = performance.now() + 250; return;
      }
      entry.buffer = buffer; entry.state = 'decoded'; entry.touched = performance.now();
    } catch (error) {
      if (!this.alive(entry)) return;
      if (error instanceof CapacityError) { entry.state = 'queued'; entry.retryAt = performance.now() + 250; entry.attempts--; }
      else if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
        entry.state = 'queued'; entry.attempts = Math.max(0, entry.attempts - 1);
      } else this.fail(entry, error, 'request');
    } finally { entry.reservedBytes = 0; clearTimeout(timeout); this.active--; if (entry.controller === controller) delete entry.controller; }
  }
  private async paint(entry: TileEntry): Promise<void> {
    const reservation = Math.max(TILE_LIMITS.buildBytes, entry.buffer!.byteLength * 4);
    if (!this.store.makeRoom(reservation, 0, 0, entry.priority, entry.key)) return;
    entry.reservedBytes = reservation;
    const buffer = entry.buffer!; delete entry.buffer; entry.state = 'painting';
    try {
      const result = await this.workers.run({ address: entry.address, buffer, layers: this.options.layers,
        size: entry.address.z >= this.options.source.maxZoom - 2 ? 512 : 256, background: this.background });
      if (!this.alive(entry)) { result.bitmap?.close(); return; }
      if (!Number.isFinite(entry.priority)) {
        this.discardedBytes += resultBytes(result); result.bitmap?.close(); this.store.release(entry); this.log('discard-build', entry.key); return;
      }
      entry.reservedBytes = 0; this.workerTime.add(result.paintMs);
      if (!this.store.makeRoom(resultBytes(result), 0, 0, entry.priority, entry.key)) {
        result.bitmap?.close(); entry.state = 'queued'; entry.retryAt = performance.now() + 250; return;
      }
      entry.features = result.features; entry.result = result; entry.state = 'upload'; entry.touched = performance.now(); this.log('built', entry.key);
    } catch (error) { if (this.alive(entry)) this.fail(entry, error, 'build'); }
    finally { entry.reservedBytes = 0; }
  }
  upload(now: number): void {
    const start = performance.now(); let bytes = 0; let count = 0;
    const queue = [...this.store.entries.values()].filter(e => e.state === 'upload' && Number.isFinite(e.priority))
      .sort((a, b) => a.priority - b.priority);
    const preferred = queue.findIndex(e => e.kind === demandSlot(this.uploadDispatch, now < this.predictionUrgentUntil));
    if (preferred > 0) queue.unshift(queue.splice(preferred, 1)[0]!);
    for (const entry of queue) {
      const result = entry.result; if (!result?.bitmap) continue;
      const gpu = Math.ceil(result.bitmap.width * result.bitmap.height * 4 * 4 / 3) + lineBytes(result.lines);
      if (count && (bytes + gpu > TILE_LIMITS.uploadBytes || performance.now() - start >= TILE_LIMITS.uploadMs)) break;
      if (!this.store.makeRoom(0, gpu, 0, entry.priority, entry.key)) continue;
      const time = performance.now();
      const surface = this.store.surfaces.create(result.bitmap, entry.address, result.lines);
      this.renderer.initTexture(surface.map);
      entry.surface = surface; this.store.available.add(entry.key); delete entry.result; entry.state = 'ready'; entry.touched = now;
      this.uploadTime.add(performance.now() - time); this.requestTime.add(performance.now() - entry.startedAt); this.changed(); this.log('ready', entry.key);
      bytes += gpu; count++; this.uploadDispatch++;
      // 一次上传中的几何初始化也在该帧渲染阶段计入 CPU 与 GPU 成本。
      if (count >= 1) break;
    }
  }
  private fail(entry: TileEntry, error: unknown, phase: 'request' | 'build'): void {
    this.errors++; entry.state = 'failed'; entry.retryAt = performance.now() + 500 * 2 ** entry.attempts;
    this.recentErrors.push({ at: performance.now(), key: entry.key, phase, message: String(error), attempt: entry.attempts });
    if (this.recentErrors.length > 32) this.recentErrors.shift();
    this.log('error', entry.key);
    this.onError({ code: phase === 'build' ? 'WORKER_ERROR' : 'NETWORK_ERROR', phase, message: String(error),
      recoverable: entry.attempts < 3, tileKey: { sourceId: this.options.source.id, ...entry.address }, cause: error });
    if (entry.attempts < 3) { entry.state = 'queued'; this.retries++; }
  }
  dispose(): void { this.disposed = true; this.workers.dispose(); for (const e of this.store.entries.values()) e.controller?.abort(); }
}

/** 限制解压后的 MVT 响应体，流读取期间由条目预留上限预算。 */
class CapacityError extends Error {}
function demandSlot(index: number, urgent: boolean) {
  return urgent ? (['fallback', 'visible', 'predicted'] as const)[index % 3]!
    : index % 6 === 0 ? 'fallback' : index % 6 === 5 ? 'predicted' : 'visible';
}
async function readTileBody(response: Response, limit: number, reserve: (bytes: number) => void): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error(`MVT 响应超过 ${limit} 字节预算。`); }
      reserve(total);
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
}
