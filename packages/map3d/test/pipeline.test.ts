import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Color, type WebGPURenderer } from 'three/webgpu';
import { resultBytes, TileStore } from '../src/streaming/tileStore.js';
import { fillBytes } from '../src/streaming/fills.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { readFileSync } from 'node:fs';
import { decodeTileSources } from '../src/streaming/tileSources.js';
const mocks = vi.hoisted(() => ({ run: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/streaming/workers.js', () => ({ PaintWorkers: class {
  run = mocks.run; getStats() { return { active: 0, queued: 0 }; } dispose() {}
} }));
import { TilePipeline } from '../src/streaming/pipeline.js';

afterEach(() => { mocks.run.mockClear(); vi.unstubAllGlobals(); });
describe('阶段队列的可见需求优先与过期释放', () => {
  it('主源 204 时补充省界仍进入 Worker，并按真实 HTTP 请求数计量', async () => {
    const fixture = readFileSync(new URL('./fixtures/kye-kye_admin_pro-z5-26-12.mvt', import.meta.url));
    const fetcher = vi.fn(async (url: string) => url.startsWith('/admin') ? new Response(Uint8Array.from(fixture)) : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const overlay = { tiles: ['/admin/{z}/{x}/{y}'], minZoom: 2, maxZoom: 5, sourceLayer: 'border', targetLayer: 'province_border' };
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff')), store = new TileStore(surfaces, {}, new Set());
    const pipeline = new TilePipeline(store, { canvas: {} as HTMLCanvasElement,
      source: { id: 'fixture', tiles: ['/main/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17, overlays: [overlay] }, layers: [] },
    {} as WebGPURenderer, '#ffffff', () => {}, () => {}, () => {});
    const entry = store.create({ z: 7, x: 105, y: 49 }, 'visible', 0, 0)!;
    pipeline.pump(0);
    await vi.waitFor(() => expect(entry.state).toBe('decoded'));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/main/7/105/49', '/admin/5/26/12']);
    expect(pipeline.starts).toBe(1); expect(pipeline.httpStarts).toBe(2); expect(pipeline.active).toBe(0);
    expect(entry.empty).toBe(false); expect(entry.reservedBytes).toBe(0);
    expect(decodeTileSources(entry.buffer!, entry.address, [overlay]).layers.province_border!.length).toBe(12);
    pipeline.dispose(); store.dispose(); surfaces.dispose(); expect(store.cpuBytes).toBe(0);
  });
  it('面几何从上传产物转为驻留资源后字节守恒，并服从 GPU 预算', () => {
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
    const fills = { positions: new Float32Array(9), colors: new Float32Array(9), styles: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
    const gpuPerTile = 6 + fillBytes(fills);
    // 全局底面与每个来源区域各持有 92 字节，预算仅容纳一个完整来源。
    const store = new TileStore(surfaces, { maxGpuBytes: gpuPerTile + 184 }, new Set());
    const closed = vi.fn(), initTexture = vi.fn();
    const pipeline = new TilePipeline(store, { canvas: {} as HTMLCanvasElement, source: { id: 'fixture', tiles: ['/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17 }, layers: [] },
      { initTexture } as unknown as WebGPURenderer, '#ffffff', () => {}, () => {}, () => {});
    const a = store.create({ z: 4, x: 1, y: 0 }, 'visible', 0, 0)!;
    const b = store.create({ z: 4, x: 2, y: 0 }, 'visible', 0, 0)!;
    for (const e of [a, b]) { e.state = 'upload'; e.result = { id: e.address.x, bitmap: { width: 1, height: 1, close: closed } as unknown as ImageBitmap, fills, features: 1, paintMs: 1, empty: false }; }
    expect(resultBytes(a.result)).toBe(4 + fillBytes(fills));
    const cpuBefore = store.cpuBytes;
    pipeline.upload(10);
    expect(initTexture).toHaveBeenCalledOnce(); expect(a.state).toBe('ready'); expect(a.result).toBeUndefined();
    expect(store.cpuBytes).toBe(cpuBefore + 92); expect(store.gpuBytes).toBe(gpuPerTile + 184);
    pipeline.upload(20);
    expect(b.state).toBe('upload'); expect(initTexture).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled();
    store.release(a); pipeline.upload(30); expect(b.state).toBe('ready');
    pipeline.dispose(); surfaces.dispose(); store.dispose();
    expect(closed).toHaveBeenCalledTimes(2); expect(store.cpuBytes).toBe(0); expect(store.gpuBytes).toBe(0);
  });
  it('八个过期上传产物立即释放，当前解码瓦片获得 Worker 槽位', () => {
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
    const store = new TileStore(surfaces, {}, new Set());
    const closed = vi.fn();
    for (let i = 0; i < 8; i++) {
      const e = store.create({ z: 4, x: i, y: 0 }, 'predicted', Infinity, 0)!;
      e.state = 'upload'; e.result = { id: i, bitmap: { width: 256, height: 256, close: closed } as unknown as ImageBitmap, features: 0, paintMs: 1, empty: false };
    }
    const visible = store.create({ z: 4, x: 10, y: 0 }, 'visible', 0, 0)!;
    visible.state = 'decoded'; visible.buffer = new ArrayBuffer(1);
    const pipeline = new TilePipeline(store, { canvas: {} as HTMLCanvasElement, source: { id: 'fixture', tiles: ['/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17 }, layers: [] }, {} as WebGPURenderer, '#ffffff', () => {}, () => {}, () => {});
    pipeline.pump(100);
    expect(closed).toHaveBeenCalledTimes(8); expect(mocks.run).toHaveBeenCalledOnce();
    expect(visible.state).toBe('painting'); expect(store.entries.size).toBe(1);
    expect(pipeline.discardedBytes).toBe(8 * 256 * 256 * 4);
    pipeline.dispose(); store.dispose(); surfaces.dispose();
  });
});
