import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Color, type WebGPURenderer } from 'three/webgpu';
import { resultBytes, TileStore } from '../src/streaming/tileStore.js';
import { fillBytes } from '../src/streaming/fills.js';
import { TileSurfaces } from '../src/streaming/surface.js';
const mocks = vi.hoisted(() => ({ run: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/streaming/workers.js', () => ({ PaintWorkers: class {
  run = mocks.run; getStats() { return { active: 0, queued: 0 }; } dispose() {}
} }));
import { TilePipeline } from '../src/streaming/pipeline.js';

afterEach(() => { mocks.run.mockClear(); });
describe('阶段队列的可见需求优先与过期释放', () => {
  it('面几何从上传产物转为驻留资源后字节守恒，并服从 GPU 预算', () => {
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
    const fills = { positions: new Float32Array(9), colors: new Float32Array(9), styles: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
    const gpuPerTile = 6 + fillBytes(fills);
    // 每个来源的一个区域矩形持有 92 字节，预算仅容纳一个完整来源。
    const store = new TileStore(surfaces, { maxGpuBytes: gpuPerTile + 92 }, new Set());
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
    expect(store.cpuBytes).toBe(cpuBefore + 92); expect(store.gpuBytes).toBe(gpuPerTile + 92);
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
