import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ renderers: [] as { callback: ((time: number) => void) | null; init: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; initTexture: ReturnType<typeof vi.fn> }[], bitmaps: [] as { close: ReturnType<typeof vi.fn> }[] }));
vi.mock('three/webgpu', async original => {
  const three = await original<typeof import('three/webgpu')>();
  return { ...three, WebGPURenderer: class {
    backend = { isWebGPUBackend: true }; callback: ((time: number) => void) | null = null;
    info = { render: { drawCalls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } };
    init = vi.fn(async () => {}); dispose = vi.fn(); initTexture = vi.fn();
    setPixelRatio() {} setSize() {} render() {}
    setAnimationLoop(callback: ((time: number) => void) | null) { this.callback = callback; }
    constructor() { mocks.renderers.push(this); }
  } };
});
vi.mock('../src/streaming/workers.js', () => ({ PaintWorkers: class {
  run = async () => {
    const bitmap = { width: 512, height: 512, close: vi.fn() }; mocks.bitmaps.push(bitmap);
    return { id: 1, bitmap, features: 8, paintMs: 2, empty: false };
  };
  getStats() { return { active: 0, queued: 0 }; } dispose() {}
} }));

import { Map3D } from '../src/Map3D.js';
import type { Map3DOptions } from '../src/types.js';

const maps: Map3D[] = [];
const options = (): Map3DOptions => ({ canvas: new EventTarget() as HTMLCanvasElement,
  source: { id: 'fixture', tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'], minZoom: 0, maxZoom: 17 }, layers: [],
  view: { center: { lng: 116.39, lat: 39.9 }, zoom: 15 } });
const create = () => { const map = new Map3D(options()); maps.push(map); map.resize({ width: 1280, height: 720 }); return map; };
const tick = async (frames = 200) => {
  for (let i = 0; i < frames; i++) {
    vi.advanceTimersByTime(17); mocks.renderers.at(-1)!.callback?.(performance.now());
    for (let j = 0; j < 6; j++) await Promise.resolve();
  }
};
afterEach(() => { maps.splice(0).forEach(map => map.dispose()); mocks.renderers.length = 0; mocks.bitmaps.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Map3D 生命周期与流式覆盖', () => {
  it('重复初始化复用 Promise，销毁后拒绝操作并关闭位图', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
    const map = create(); const first = map.initialize(); expect(map.initialize()).toBe(first); await first; await tick();
    expect(map.getStats().tiles.visible).toBeGreaterThan(0); expect(map.getDiagnostics().tiles?.uncoveredCells).toBe(0);
    map.dispose(); map.dispose(); expect(mocks.renderers[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(() => map.setView({ zoom: 10 })).toThrow('已销毁'); await expect(map.initialize()).rejects.toMatchObject({ code: 'MAP_DISPOSED' });
  });
  it('慢网视图更新保持 12 请求上限，停止后保留缓存', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const pending: (() => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => pending.push(() => resolve(new Response(new Uint8Array([1]))))));
    vi.stubGlobal('fetch', fetcher); const map = create(); await map.initialize(); await tick(10);
    expect(fetcher).toHaveBeenCalledTimes(12);
    for (let i = 0; i < 10; i++) { map.setView({ bearing: i * 10 }); await tick(4); expect(map.getStats().tiles.fetching).toBeLessThanOrEqual(12); }
    for (let i = 0; i < 30; i++) { pending.splice(0).forEach(resolve => resolve()); await tick(20); }
    const starts = fetcher.mock.calls.length; const view = map.getView(); map.setView(view); await tick(20);
    expect(fetcher).toHaveBeenCalledTimes(starts); expect(map.getDiagnostics().tiles?.coverageComplete).toBe(true);
    map.stop(); expect(mocks.renderers[0]!.callback).toBeNull(); map.start(); expect(mocks.renderers[0]!.callback).toBeTypeOf('function');
  });
  it('204 空数据通过有内容的祖先维持地理覆盖', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Number(new URL(url).pathname.split('/')[1]) >= 14 ? new Response(null, { status: 204 }) : new Response(new Uint8Array([1]))));
    const map = create(); await map.initialize(); await tick();
    expect(map.getStats().tiles.empty).toBeGreaterThan(0); expect(map.getStats().tiles.visible).toBeGreaterThan(0);
    expect(map.getDiagnostics().tiles?.targetMissing).toBe(0); expect(map.getDiagnostics().tiles?.uncoveredCells).toBe(0);
    expect(map.getDiagnostics().tiles?.resources.gpuBytes).toBeLessThanOrEqual(256 * 1048576);
  });
  it('俯仰和方位直接切换时已驻留祖先覆盖新增视锥', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetcher);
    const map = create(); await map.initialize();
    map.setView({ center: { lng: 116.398, lat: 39.896 }, zoom: 15.6, bearing: 192, pitch: 1 }); await tick();
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    map.setView({ center: { lng: 116.39465, lat: 39.90552 }, zoom: 15, bearing: 0, pitch: 60 }); await tick(5);
    expect(map.getDiagnostics().tiles?.uncoveredCells).toBe(0);
  });
});
