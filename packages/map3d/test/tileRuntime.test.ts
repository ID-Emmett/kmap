import { describe, expect, it, vi } from 'vitest';

import {
  TILE_CANCEL_GRACE_MS,
  TILE_PROGRESS_CANCEL_GRACE_MS,
  TileRuntime,
} from '../src/runtime/tileRuntime.js';
import { VectorTileSourceAdapter } from '../src/runtime/tileRuntimeAdapters.js';
import type {
  TileRuntimeRenderAdapter,
  TileRuntimeWorkerAdapter,
} from '../src/runtime/tileRuntimeTypes.js';
import { TileRequestError } from '../src/source/errors.js';
import type { FetchLike } from '../src/source/types.js';
import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
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

describe('TileRuntime scheduling and lifecycle', () => {
  it('静态优先级按 coverage、refinement、leading-prefetch、prefetch 调度', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const C = { sourceId: 'main', z: 3, x: 3, y: 2 } as const;
    const D = { sourceId: 'main', z: 3, x: 4, y: 2 } as const;
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      fetchConcurrency: 1,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([
      createCoverageEntry(A, { role: 'refinement', screenDistance: 0 }),
      createCoverageEntry(B, { role: 'coverage', screenDistance: 500 }),
      createCoverageEntry(C, {
        kind: 'prefetch',
        role: 'leading-prefetch',
        screenDistance: 0,
      }),
      createCoverageEntry(D, {
        kind: 'prefetch',
        role: 'prefetch',
        screenDistance: 0,
      }),
    ]);

    expect(source.calls.map((call) => call.key)).toEqual([B]);
    source.resolve(B, { status: 'empty' });
    await flushTileRuntime();
    expect(source.calls.map((call) => call.key)).toEqual([B, A]);
    source.resolve(A, { status: 'empty' });
    await flushTileRuntime();
    expect(source.calls.map((call) => call.key)).toEqual([B, A, C]);
    source.resolve(C, { status: 'empty' });
    await flushTileRuntime();
    expect(source.calls.map((call) => call.key)).toEqual([B, A, C, D]);
    runtime.dispose();
  });

  it('refinement debounce 到期后不会被 prefetch 饿死', () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([
      createCoverageEntry(A, { role: 'refinement', notBefore: 180 }),
      createCoverageEntry(B, { kind: 'prefetch', role: 'leading-prefetch' }),
    ]);

    expect(source.calls.map((call) => call.key)).toEqual([B]);
    clock.advance(180);
    runtime.refresh();
    expect(source.calls.map((call) => call.key)).toEqual([B, A]);
    runtime.dispose();
  });

  it('按 visible/屏幕距离调度，并对多个 wrap consumer 去重', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      fetchConcurrency: 1,
      workerConcurrency: 1,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([
      createCoverageEntry(A, { screenDistance: 200 }),
      createCoverageEntry(A, {
        wrap: 1,
        kind: 'prefetch',
        screenDistance: 10,
      }),
      createCoverageEntry(B, { screenDistance: 20 }),
    ]);

    expect(source.calls.map((call) => call.key)).toEqual([B]);
    source.resolve(B, { status: 'empty' });
    await flushTileRuntime();
    expect(source.calls.map((call) => call.key)).toEqual([B, A]);

    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();
    expect(worker.calls).toHaveLength(1);
    worker.resolve(A, { id: 'payload-a' });
    await flushTileRuntime();
    const resource = new FakeTileResource(40, 60);
    render.resolve(A, resource);
    await runtime.whenIdle();

    expect(runtime.getTile(A)).toMatchObject({
      state: 'ready',
      visible: true,
      consumers: 2,
      cpuBytes: 40,
      gpuBytes: 60,
    });
    expect(runtime.getTile(B)?.state).toBe('empty');
    expect(source.calls.filter((call) => call.key === A)).toHaveLength(1);
    expect(runtime.getStats()).toMatchObject({
      idle: true,
      consumers: { visible: 2, prefetch: 1 },
      tiles: { ready: 1, empty: 1 },
    });

    runtime.dispose();
    expect(resource.disposeCount).toBe(1);
  });

  it('快速移除 consumer 会取消 fetch，迟到结果不能启动 Worker', async () => {
    const source = new ControlledTileSource({ respectAbort: false });
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const clock = new FakeTileRuntimeClock();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const signal = source.calls[0]!.signal;
    runtime.setCoverage([]);

    expect(signal.aborted).toBe(false);
    expect(runtime.getTile(A)?.state).toBe('fetching');
    clock.advance(TILE_CANCEL_GRACE_MS);
    runtime.refresh();
    expect(signal.aborted).toBe(true);
    expect(runtime.getTile(A)).toBeUndefined();
    expect(runtime.getStats().scheduling).toMatchObject({
      requestStarts: 1,
      initialRequestStarts: 1,
      cancellationReloadStarts: 0,
      duplicateRequestStarts: 0,
    });
    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();

    expect(worker.calls).toHaveLength(0);
    expect(runtime.getStats().idle).toBe(true);
    runtime.dispose();
  });

  it('取消迟滞内快速返回复用同一 generation', () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const generation = runtime.getTile(A)?.generation;
    runtime.setCoverage([]);
    clock.advance(TILE_CANCEL_GRACE_MS - 1);
    runtime.setCoverage([createCoverageEntry(A)]);

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]?.signal.aborted).toBe(false);
    expect(runtime.getTile(A)?.generation).toBe(generation);
    expect(runtime.getStats().scheduling).toMatchObject({
      requestStarts: 1,
      cancellationReloadStarts: 0,
      duplicateRequestStarts: 0,
    });
    runtime.dispose();
  });

  it('取消后重新进入会记录 cancellation reload 而不是 duplicate', () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    runtime.setCoverage([]);
    clock.advance(TILE_CANCEL_GRACE_MS);
    runtime.refresh();
    runtime.setCoverage([createCoverageEntry(A)]);

    expect(source.calls).toHaveLength(2);
    expect(runtime.getStats().scheduling).toMatchObject({
      requestStarts: 2,
      initialRequestStarts: 1,
      cancellationReloadStarts: 1,
      duplicateRequestStarts: 0,
    });
    runtime.dispose();
  });

  it('明显下载进度延长取消迟滞但仍有确定上限', () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    source.reportProgress(A, 20 * 1024, 32 * 1024);
    runtime.setCoverage([]);
    clock.advance(TILE_CANCEL_GRACE_MS);
    runtime.refresh();
    expect(source.calls[0]?.signal.aborted).toBe(false);

    clock.advance(TILE_PROGRESS_CANCEL_GRACE_MS - TILE_CANCEL_GRACE_MS);
    runtime.refresh();
    expect(source.calls[0]?.signal.aborted).toBe(true);
    expect(runtime.getStats().scheduling).toMatchObject({
      requestCancels: 1,
      discardedDownloadBytes: 20 * 1024,
    });
    runtime.dispose();
  });

  it('同一 canonical key 的旧 Fetch 不能污染新 generation', async () => {
    const source = new ControlledTileSource({ respectAbort: false });
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const clock = new FakeTileRuntimeClock();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      fetchConcurrency: 2,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const staleCall = source.calls[0]!;
    runtime.setCoverage([]);
    clock.advance(TILE_CANCEL_GRACE_MS);
    runtime.refresh();
    runtime.setCoverage([createCoverageEntry(A)]);

    staleCall.deferred.resolve({
      status: 'data',
      data: new ArrayBuffer(4),
    });
    source.resolve(A, { status: 'data', data: new ArrayBuffer(8) });
    await flushTileRuntime();

    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]?.input.generation).toBe(2);
    worker.resolve(A, { id: 'payload-generation-2' });
    await flushTileRuntime();
    render.resolve(A, new FakeTileResource(8, 12));
    await runtime.whenIdle();

    expect(runtime.getTile(A)).toMatchObject({
      generation: 2,
      state: 'ready',
      cpuBytes: 8,
      gpuBytes: 12,
    });
    runtime.dispose();
  });

  it('GPU upload 迟到时立即释放 stale resource', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const clock = new FakeTileRuntimeClock();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();
    worker.resolve(A, { id: 'payload-a' });
    await flushTileRuntime();
    expect(render.calls).toHaveLength(1);

    runtime.setCoverage([]);
    clock.advance(TILE_PROGRESS_CANCEL_GRACE_MS);
    runtime.refresh();
    const stale = new FakeTileResource(10, 10);
    render.resolve(A, stale);
    await flushTileRuntime();

    expect(stale.disposeCount).toBe(1);
    expect(runtime.getTile(A)).toBeUndefined();
    runtime.dispose();
  });

  it('Worker completion 迟到时不进入 GPU upload', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>({
      respectCancel: false,
    });
    const render = new ControlledTileRender<{ id: string }>();
    const clock = new FakeTileRuntimeClock();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();
    expect(worker.calls).toHaveLength(1);

    runtime.setCoverage([]);
    clock.advance(TILE_PROGRESS_CANCEL_GRACE_MS);
    runtime.refresh();
    worker.resolve(A, { id: 'stale-payload' });
    await flushTileRuntime();

    expect(worker.calls[0]?.cancelCount).toBe(1);
    expect(render.calls).toHaveLength(0);
    expect(runtime.getTile(A)).toBeUndefined();
    runtime.dispose();
  });

  it('记录 coarse/ideal milestone 和 oldest queue age', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([
      createCoverageEntry(A, { role: 'coverage' }),
      createCoverageEntry(B, { role: 'refinement', notBefore: 180 }),
    ]);
    clock.advance(50);
    expect(runtime.getStats().scheduling.oldestQueueAgeMs).toBe(50);
    source.resolve(A, { status: 'empty' });
    await flushTileRuntime();
    expect(runtime.getStats().scheduling.coarseCoverMs).toBe(50);

    clock.advance(130);
    runtime.refresh();
    source.resolve(B, { status: 'empty' });
    await flushTileRuntime();
    expect(runtime.getStats().scheduling).toMatchObject({
      idealRefinementMs: 180,
      requestStarts: 2,
    });
    runtime.dispose();
  });

  it('Worker 并发槽释放后继续按优先级调度等待队列', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const C = { sourceId: 'main', z: 3, x: 3, y: 2 } as const;
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      fetchConcurrency: 3,
      workerConcurrency: 1,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([
      createCoverageEntry(A, { screenDistance: 0 }),
      createCoverageEntry(B, { screenDistance: 200 }),
      createCoverageEntry(C, { screenDistance: 20 }),
    ]);
    source.resolve(A, { status: 'data', data: new ArrayBuffer(1) });
    source.resolve(B, { status: 'data', data: new ArrayBuffer(1) });
    source.resolve(C, { status: 'data', data: new ArrayBuffer(1) });
    await flushTileRuntime();
    expect(worker.calls.map((call) => call.input.key)).toEqual([A]);

    worker.resolve(A, { id: 'payload-a' });
    await flushTileRuntime();
    expect(worker.calls.map((call) => call.input.key)).toEqual([A, C]);
    runtime.dispose();
  });

  it('recoverable failure 遵守 cooldown，404 不自动重试', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      failedCooldownMs: 1_000,
      minFallbackZoom: 3,
    });
    const errors = vi.fn();
    const idle = vi.fn();
    runtime.on('error', errors);
    runtime.on('idle', idle);

    runtime.setCoverage([createCoverageEntry(A)]);
    source.reject(
      A,
      new TileRequestError({
        kind: 'network',
        code: 'NETWORK_ERROR',
        message: 'offline',
        recoverable: true,
        tileKey: A,
      }),
    );
    await flushTileRuntime();
    expect(runtime.getTile(A)).toMatchObject({ state: 'failed', retryAt: 1_000 });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(idle).toHaveBeenCalledTimes(1);

    clock.advance(999);
    runtime.refresh();
    expect(source.calls).toHaveLength(1);
    clock.advance(1);
    runtime.refresh();
    expect(source.calls).toHaveLength(2);
    source.resolve(A, { status: 'empty' });
    await runtime.whenIdle();
    expect(runtime.getTile(A)).toMatchObject({ state: 'empty', generation: 2 });
    expect(runtime.getStats().scheduling).toMatchObject({
      retryRequestStarts: 1,
      duplicateRequestStarts: 0,
    });

    runtime.setCoverage([createCoverageEntry(B)]);
    source.reject(
      B,
      new TileRequestError({
        kind: 'http',
        code: 'HTTP_ERROR',
        message: 'not found',
        recoverable: false,
        tileKey: B,
        status: 404,
      }),
    );
    await runtime.whenIdle();
    clock.advance(10_000);
    runtime.refresh();
    expect(source.calls.filter((call) => call.key === B)).toHaveLength(1);
    expect(runtime.getTile(B)?.state).toBe('failed');
    runtime.dispose();
  });

  it('T004 source adapter 在 Runtime 中完成三次 5xx/network 重试和 204', async () => {
    const sourceConfig = normalizeVectorTileSourceOptions({
      id: 'main',
      tiles: [
        'https://tiles0.example.test/{z}/{x}/{y}.pbf',
        'https://tiles1.example.test/{z}/{x}/{y}.pbf',
        'https://tiles2.example.test/{z}/{x}/{y}.pbf',
      ],
      minZoom: 0,
      maxZoom: 17,
    });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response(null, { status: 500 });
      }
      if (fetchImpl.mock.calls.length === 2) {
        throw new TypeError('offline');
      }
      return new Response(null, { status: 204 });
    });
    const source = new VectorTileSourceAdapter(sourceConfig, {
      fetch: fetchImpl,
      retryBaseDelayMs: 0,
      random: () => 0.5,
    });
    const worker: TileRuntimeWorkerAdapter<never> = {
      enqueue: () => {
        throw new Error('204 不应进入 Worker。');
      },
      dispose() {},
    };
    const render: TileRuntimeRenderAdapter<never> = {
      upload: () => {
        throw new Error('204 不应进入 Render。');
      },
      dispose() {},
    };
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    await runtime.whenIdle();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(runtime.getTile(A)?.state).toBe('empty');
    runtime.dispose();
  });

  it('idle 只等待 visible Tile，不被后台 prefetch 阻塞', async () => {
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      minFallbackZoom: 3,
    });
    const idle = vi.fn();
    runtime.on('idle', idle);

    runtime.setCoverage([
      createCoverageEntry(A),
      createCoverageEntry(B, { kind: 'prefetch' }),
    ]);
    source.resolve(A, { status: 'empty' });
    await flushTileRuntime();

    await expect(runtime.whenIdle()).resolves.toBeUndefined();
    expect(runtime.getStats()).toMatchObject({
      idle: true,
      requests: { active: 1 },
      tiles: { fetching: 1, empty: 1 },
    });
    expect(idle).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it('Source adapter 同步抛错时转为 failed 而不泄漏并发槽', async () => {
    const source = {
      fetch: () => {
        throw new Error('sync source failure');
      },
      dispose: vi.fn(),
    };
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      minFallbackZoom: 3,
    });

    expect(() => runtime.setCoverage([createCoverageEntry(A)])).not.toThrow();
    await runtime.whenIdle();
    await flushTileRuntime();

    expect(runtime.getTile(A)).toMatchObject({ state: 'failed' });
    expect(runtime.getStats().requests.active).toBe(0);
    runtime.dispose();
  });
});
