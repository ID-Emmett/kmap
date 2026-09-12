import { describe, expect, it, vi } from 'vitest';

import { TileRuntime } from '../src/runtime/tileRuntime.js';
import { TileRequestError } from '../src/source/errors.js';
import type { CanonicalTileKey } from '../src/types.js';
import {
  ControlledTileRender,
  ControlledTileSource,
  ControlledTileWorker,
  createCoverageEntry,
  FakeTileResource,
  FakeTileRuntimeClock,
  flushTileRuntime,
} from './helpers/controlledTileRuntime.js';

const A = { sourceId: 'main', z: 3, x: 1, y: 2 } as const;
const B = { sourceId: 'main', z: 3, x: 2, y: 2 } as const;
const C = { sourceId: 'main', z: 3, x: 3, y: 2 } as const;

describe('TileRuntime cache and disposal', () => {
  it('使用批准的初始 cache 预算', () => {
    const harness = createHarness();

    expect(harness.runtime.getStats().cache).toMatchObject({
      maxEntries: 256,
      maxCpuBytes: 128 * 1024 * 1024,
      maxGpuBytes: 256 * 1024 * 1024,
    });
    harness.runtime.dispose();
  });

  it('entry LRU 淘汰最旧非 visible ready Tile', async () => {
    const harness = createHarness({ maxEntries: 2 });
    const resourceA = await loadReady(harness, A, 10, 10);
    harness.clock.advance(1);
    const resourceB = await loadReady(harness, B, 10, 10);
    harness.clock.advance(1);

    harness.runtime.setCoverage([createCoverageEntry(C)]);

    expect(resourceA.disposeCount).toBe(1);
    expect(resourceB.disposeCount).toBe(0);
    expect(harness.runtime.getTile(A)).toBeUndefined();
    expect(harness.runtime.getTile(B)?.state).toBe('ready');
    expect(harness.runtime.getTile(C)?.state).toBe('fetching');
    harness.runtime.dispose();
  });

  it('ready cache hit 重新成为 visible 时不重复请求或上传', async () => {
    const harness = createHarness({ maxEntries: 3 });
    const resourceA = await loadReady(harness, A, 10, 10);
    await loadReady(harness, B, 10, 10);
    const fetchCount = harness.source.calls.filter((call) => call.key === A).length;
    const workerCount = harness.worker.calls.filter(
      (call) => call.input.key === A,
    ).length;
    const uploadCount = harness.render.calls.filter(
      (call) => call.input.key === A,
    ).length;
    const generation = harness.runtime.getTile(A)?.generation;

    expect(harness.runtime.getTile(A)).toMatchObject({
      state: 'ready',
      visible: false,
      consumers: 0,
      retained: true,
    });
    expect(harness.runtime.getStats().cache).toMatchObject({
      retainedEntries: 1,
      retainedReady: 1,
    });

    harness.runtime.setCoverage([createCoverageEntry(A)]);
    await harness.runtime.whenIdle();

    expect(harness.runtime.getTile(A)).toMatchObject({
      generation,
      state: 'ready',
      visible: true,
      retained: false,
    });
    expect(harness.source.calls.filter((call) => call.key === A)).toHaveLength(fetchCount);
    expect(harness.worker.calls.filter((call) => call.input.key === A)).toHaveLength(workerCount);
    expect(harness.render.calls.filter((call) => call.input.key === A)).toHaveLength(uploadCount);
    expect(resourceA.disposeCount).toBe(0);
    expect(harness.runtime.getStats()).toMatchObject({
      cache: { readyHits: 1 },
      scheduling: { duplicateRequestStarts: 0 },
    });
    harness.runtime.dispose();
  });

  it('cache hit 刷新 LRU，后续淘汰更旧 retained Tile', async () => {
    const harness = createHarness({ maxEntries: 2 });
    const resourceA = await loadReady(harness, A, 10, 10);
    harness.clock.advance(1);
    const resourceB = await loadReady(harness, B, 10, 10);
    harness.clock.advance(1);

    harness.runtime.setCoverage([createCoverageEntry(A)]);
    await harness.runtime.whenIdle();
    harness.clock.advance(1);
    harness.runtime.setCoverage([createCoverageEntry(C)]);

    expect(resourceA.disposeCount).toBe(0);
    expect(resourceB.disposeCount).toBe(1);
    expect(harness.runtime.getTile(B)).toBeUndefined();
    expect(harness.runtime.getStats().cache).toMatchObject({
      readyHits: 1,
      evictions: 1,
    });
    harness.runtime.dispose();
  });

  it('warm ancestor 完成后进入 retained cache，稳定刷新不重复请求', async () => {
    const harness = createHarness({
      maxEntries: 8,
      minFallbackZoom: 1,
    });
    const parent = { sourceId: 'main', z: 2, x: 0, y: 1 } as const;
    const grandparent = { sourceId: 'main', z: 1, x: 0, y: 0 } as const;

    await loadReady(harness, A, 10, 10);
    expect(harness.source.calls.map((call) => call.key)).toEqual(
      expect.arrayContaining([A, parent, grandparent]),
    );
    expect(harness.source.calls).toHaveLength(3);

    harness.source.resolve(parent, {
      status: 'data',
      data: new ArrayBuffer(4),
    });
    await flushTileRuntime();
    harness.worker.resolve(parent, { id: 'parent' });
    await flushTileRuntime();
    harness.render.resolve(parent, new FakeTileResource(10, 10));
    await flushTileRuntime();
    harness.source.resolve(grandparent, { status: 'empty' });
    await flushTileRuntime();

    expect(harness.runtime.getTile(parent)).toMatchObject({
      state: 'ready',
      consumers: 0,
      retained: true,
    });
    expect(harness.runtime.getTile(grandparent)).toMatchObject({
      state: 'empty',
      consumers: 0,
      retained: true,
    });

    const requestCount = harness.source.calls.length;
    harness.clock.advance(30_000);
    for (let index = 0; index < 10; index += 1) {
      harness.runtime.refresh();
    }

    expect(harness.source.calls).toHaveLength(requestCount);
    expect(harness.runtime.getStats()).toMatchObject({
      cache: {
        retainedEntries: 2,
        retainedReady: 1,
        retainedEmpty: 1,
      },
      scheduling: {
        requestStarts: 3,
        initialRequestStarts: 3,
        duplicateRequestStarts: 0,
      },
    });
    harness.runtime.dispose();
  });

  it('warm ancestor 被资源预算淘汰后保持抑制，不进入重复请求循环', async () => {
    const harness = createHarness({
      maxEntries: 8,
      maxCpuBytes: 15,
      minFallbackZoom: 2,
    });
    const parent = { sourceId: 'main', z: 2, x: 0, y: 1 } as const;

    await loadReady(harness, A, 10, 10);
    harness.source.resolve(parent, {
      status: 'data',
      data: new ArrayBuffer(4),
    });
    await flushTileRuntime();
    harness.worker.resolve(parent, { id: 'parent' });
    await flushTileRuntime();
    const parentResource = new FakeTileResource(10, 10);
    harness.render.resolve(parent, parentResource);
    await flushTileRuntime();

    expect(parentResource.disposeCount).toBe(1);
    expect(harness.runtime.getTile(parent)).toBeUndefined();
    expect(harness.runtime.getStats().cache.evictions).toBe(1);

    const requestCount = harness.source.calls.length;
    harness.clock.advance(30_000);
    for (let index = 0; index < 10; index += 1) {
      harness.runtime.refresh();
    }

    expect(harness.source.calls).toHaveLength(requestCount);
    expect(
      harness.source.calls.filter(
        (call) =>
          call.key.sourceId === parent.sourceId &&
          call.key.z === parent.z &&
          call.key.x === parent.x &&
          call.key.y === parent.y,
      ),
    ).toHaveLength(1);
    expect(harness.runtime.getStats().scheduling.duplicateRequestStarts).toBe(0);
    harness.runtime.dispose();
  });

  it('预算淘汰后的重新请求与 duplicate request 分开统计', async () => {
    const harness = createHarness({ maxEntries: 1 });
    await loadReady(harness, A, 10, 10);
    const resourceB = await loadReady(harness, B, 10, 10);

    expect(harness.runtime.getTile(A)).toBeUndefined();
    expect(harness.runtime.getStats().cache.evictions).toBe(1);

    harness.runtime.setCoverage([createCoverageEntry(A)]);

    expect(harness.source.calls.filter((call) => call.key === A)).toHaveLength(2);
    expect(harness.runtime.getStats().scheduling).toMatchObject({
      requestStarts: 3,
      initialRequestStarts: 2,
      evictionReloadStarts: 1,
      duplicateRequestStarts: 0,
    });
    expect(resourceB.disposeCount).toBe(0);
    harness.runtime.dispose();
  });

  it('empty 离开目标后保留并直接命中缓存', async () => {
    const harness = createHarness({ maxEntries: 2 });
    harness.runtime.setCoverage([createCoverageEntry(A)]);
    harness.source.resolve(A, { status: 'empty' });
    await harness.runtime.whenIdle();

    harness.runtime.setCoverage([createCoverageEntry(B)]);
    harness.source.resolve(B, { status: 'empty' });
    await harness.runtime.whenIdle();
    expect(harness.runtime.getTile(A)).toMatchObject({
      state: 'empty',
      retained: true,
    });

    harness.runtime.setCoverage([createCoverageEntry(A)]);
    await harness.runtime.whenIdle();

    expect(harness.source.calls.filter((call) => call.key === A)).toHaveLength(1);
    expect(harness.runtime.getStats().cache.emptyHits).toBe(1);
    harness.runtime.dispose();
  });

  it('non-recoverable failed 元数据离开目标后保留且不重复请求', async () => {
    const harness = createHarness({ maxEntries: 2 });
    harness.runtime.setCoverage([createCoverageEntry(A)]);
    harness.source.reject(
      A,
      new TileRequestError({
        kind: 'http',
        code: 'HTTP_ERROR',
        message: 'not found',
        recoverable: false,
        tileKey: A,
        status: 404,
      }),
    );
    await harness.runtime.whenIdle();

    harness.runtime.setCoverage([createCoverageEntry(B)]);
    expect(harness.runtime.getTile(A)).toMatchObject({
      state: 'failed',
      retained: true,
    });
    expect(harness.runtime.getStats().cache.retainedFailed).toBe(1);

    harness.runtime.setCoverage([createCoverageEntry(A)]);
    expect(harness.source.calls.filter((call) => call.key === A)).toHaveLength(1);
    expect(harness.runtime.getStats().scheduling.duplicateRequestStarts).toBe(0);
    harness.runtime.dispose();
  });

  it.each([
    { budget: 'cpu', cpuA: 60, gpuA: 10, cpuB: 60, gpuB: 10 },
    { budget: 'gpu', cpuA: 10, gpuA: 60, cpuB: 10, gpuB: 60 },
  ])('$budget byte budget 使用实际资源字节淘汰', async (values) => {
    const harness = createHarness({ maxCpuBytes: 100, maxGpuBytes: 100 });
    const resourceA = await loadReady(
      harness,
      A,
      values.cpuA,
      values.gpuA,
    );
    harness.clock.advance(1);
    const resourceB = await loadReady(
      harness,
      B,
      values.cpuB,
      values.gpuB,
    );
    harness.clock.advance(180);
    harness.runtime.refresh();

    expect(resourceA.disposeCount).toBe(1);
    expect(resourceB.disposeCount).toBe(0);
    expect(harness.runtime.getStats().resources).toMatchObject({
      cpuBytes: values.cpuB,
      gpuBytes: values.gpuB,
    });
    harness.runtime.dispose();
  });

  it('visible 超预算保持 pinned、关闭 prefetch 并发送压力事件', async () => {
    const harness = createHarness({ maxEntries: 1 });
    const pressure = vi.fn();
    harness.runtime.on('memorypressure', pressure);

    harness.runtime.setCoverage([
      createCoverageEntry(A),
      createCoverageEntry(B),
      createCoverageEntry(C, { kind: 'prefetch' }),
    ]);

    expect(harness.source.calls.map((call) => call.key)).toEqual([A, B]);
    expect(harness.runtime.getTile(C)).toBeUndefined();
    expect(harness.runtime.getStats()).toMatchObject({
      tiles: { total: 2, visible: 2 },
      cache: {
        prefetchEnabled: false,
        pressure: true,
        pressureReasons: ['entries'],
      },
    });
    expect(pressure).toHaveBeenCalledTimes(1);

    harness.source.resolve(A, { status: 'empty' });
    harness.source.resolve(B, { status: 'empty' });
    await harness.runtime.whenIdle();
    expect(harness.runtime.getTile(A)?.state).toBe('empty');
    expect(harness.runtime.getTile(B)?.state).toBe('empty');
    harness.runtime.dispose();
  });

  it('仅 prefetch 超预算时抑制预取但不报告 visible 压力', () => {
    const harness = createHarness({ maxEntries: 1 });
    const pressure = vi.fn();
    harness.runtime.on('memorypressure', pressure);

    harness.runtime.setCoverage([
      createCoverageEntry(A),
      createCoverageEntry(B, { kind: 'prefetch' }),
    ]);

    expect(harness.runtime.getTile(A)?.state).toBe('fetching');
    expect(harness.runtime.getTile(B)).toBeUndefined();
    expect(harness.runtime.getStats().cache).toMatchObject({
      prefetchEnabled: false,
      pressure: false,
      pressureReasons: [],
    });
    expect(pressure).not.toHaveBeenCalled();
    harness.runtime.dispose();
  });

  it('dispose 幂等取消在途工作、清空事件并按 adapter 顺序释放', async () => {
    const order: string[] = [];
    const source = new ControlledTileSource({
      onDispose: () => order.push('source'),
    });
    const worker = new ControlledTileWorker<{ id: string }>({
      onDispose: () => order.push('worker'),
    });
    const render = new ControlledTileRender<{ id: string }>(() =>
      order.push('render'),
    );
    const runtime = new TileRuntime({ source, worker, render });
    const statsListener = vi.fn();
    runtime.on('stats', statsListener);

    runtime.setCoverage([createCoverageEntry(A)]);
    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();
    worker.resolve(A, { id: 'payload-a' });
    await flushTileRuntime();
    const late = new FakeTileResource(20, 20, undefined, () =>
      order.push('resource'),
    );

    runtime.dispose();
    runtime.dispose();
    render.resolve(A, late);
    await flushTileRuntime();

    expect(order).toEqual(['worker', 'render', 'source', 'resource']);
    expect(late.disposeCount).toBe(1);
    expect(source.disposeCount).toBe(1);
    expect(worker.disposeCount).toBe(1);
    expect(render.disposeCount).toBe(1);
    expect(runtime.getStats()).toMatchObject({
      disposed: true,
      idle: true,
      tiles: { total: 0 },
      resources: { cpuBytes: 0, gpuBytes: 0, objects: 0 },
    });
    expect(() => runtime.setCoverage([])).toThrow('TileRuntime 已销毁');
    const callsAfterDispose = statsListener.mock.calls.length;
    await flushTileRuntime();
    expect(statsListener).toHaveBeenCalledTimes(callsAfterDispose);
  });

  it('三轮创建、empty、dispose 后 adapter 和记录均归零', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const harness = createHarness();
      harness.runtime.setCoverage([createCoverageEntry(A)]);
      harness.source.resolve(A, { status: 'empty' });
      await harness.runtime.whenIdle();
      harness.runtime.dispose();

      expect(harness.runtime.getStats()).toMatchObject({
        disposed: true,
        idle: true,
        tiles: { total: 0 },
      });
      expect(harness.source.disposeCount).toBe(1);
      expect(harness.worker.disposeCount).toBe(1);
      expect(harness.render.disposeCount).toBe(1);
    }
  });
});

interface HarnessOptions {
  maxEntries?: number;
  maxCpuBytes?: number;
  maxGpuBytes?: number;
  minFallbackZoom?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const clock = new FakeTileRuntimeClock();
  const source = new ControlledTileSource();
  const worker = new ControlledTileWorker<{ id: string }>();
  const render = new ControlledTileRender<{ id: string }>();
  const runtime = new TileRuntime({
    source,
    worker,
    render,
    clock,
    reducedMotion: true,
    minFallbackZoom: options.minFallbackZoom ?? 3,
    fetchConcurrency: 4,
    workerConcurrency: 2,
    ...options,
  });
  return { clock, source, worker, render, runtime };
}

async function loadReady(
  harness: ReturnType<typeof createHarness>,
  key: CanonicalTileKey,
  cpuBytes: number,
  gpuBytes: number,
): Promise<FakeTileResource> {
  harness.runtime.setCoverage([createCoverageEntry(key)]);
  harness.source.resolve(key, {
    status: 'data',
    data: new ArrayBuffer(Math.min(cpuBytes, 8)),
  });
  await flushTileRuntime();
  harness.worker.resolve(key, { id: `${key.x}` });
  await flushTileRuntime();
  const resource = new FakeTileResource(cpuBytes, gpuBytes);
  harness.render.resolve(key, resource);
  await harness.runtime.whenIdle();
  return resource;
}
