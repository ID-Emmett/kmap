import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Color, type WebGPURenderer } from 'three/webgpu';
import { TileStore } from '../src/streaming/tileStore.js';
import { TileSurfaces } from '../src/streaming/surface.js';
const mocks = vi.hoisted(() => ({ run: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/streaming/workers.js', () => ({ PaintWorkers: class {
  run = mocks.run; getStats() { return { active: 0, queued: 0 }; } dispose() {}
} }));
import { TilePipeline } from '../src/streaming/pipeline.js';

afterEach(() => { mocks.run.mockClear(); });
describe('阶段队列的可见需求优先与过期释放', () => {
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
