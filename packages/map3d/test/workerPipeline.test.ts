import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createLineLayerRecipe,
  createPolygonLayerRecipe,
} from '../src/geometry/types.js';
import { buildTilePayload } from '../src/worker/buildTile.js';
import {
  StaleTileBuildError,
  TileWorkerBuildError,
  TileWorkerPool,
} from '../src/worker/pool.js';
import {
  getTileBuildTransferables,
  TILE_BUILD_PROTOCOL_VERSION,
} from '../src/worker/protocol.js';
import { createTileBuildWorkerRuntime } from '../src/worker/runtime.js';
import { ControlledTileWorker } from './helpers/controlledTileWorker.js';
import { createSyntheticMvt } from './helpers/mvtFixture.js';

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;
const FIXTURE_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);
const LAYERS = [
  createPolygonLayerRecipe({
    type: 'fill',
    id: 'building-fill',
    sourceLayer: 'building',
    paint: { color: '#999999' },
  }),
];

describe('Tile worker protocol', () => {
  it('对 protocol version mismatch 返回确定错误', () => {
    const responses: unknown[] = [];
    const runtime = createTileBuildWorkerRuntime((message) => {
      responses.push(message);
    });

    runtime.handleMessage({
      type: 'build',
      protocolVersion: 99,
      jobId: 7,
      generation: 3,
    });

    expect(responses).toEqual([
      {
        type: 'error',
        protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
        jobId: 7,
        generation: 3,
        error: {
          code: 'PROTOCOL_VERSION_MISMATCH',
          message: '不支持 protocolVersion 99。',
          phase: 'protocol',
          recoverable: false,
          details: { expected: TILE_BUILD_PROTOCOL_VERSION },
        },
      },
    ]);
  });

  it('build 后立即 cancel 会返回 JOB_CANCELLED', () => {
    const responses: unknown[] = [];
    const runtime = createTileBuildWorkerRuntime((message) => {
      responses.push(message);
    });
    const data = readFixtureArrayBuffer();

    runtime.handleMessage({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 8,
      generation: 4,
      key: KEY,
      data,
      layers: LAYERS,
    });
    runtime.handleMessage({
      type: 'cancel',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 8,
    });

    expect(responses).toMatchObject([
      {
        type: 'error',
        jobId: 8,
        generation: 4,
        error: { code: 'JOB_CANCELLED' },
      },
    ]);
  });

  it('无效 cancel jobId 返回确定协议错误', () => {
    const responses: unknown[] = [];
    const runtime = createTileBuildWorkerRuntime((message) => {
      responses.push(message);
    });

    runtime.handleMessage({
      type: 'cancel',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: -1,
    });

    expect(responses).toMatchObject([
      {
        type: 'error',
        jobId: -1,
        generation: 0,
        error: { code: 'WORKER_ERROR', phase: 'protocol' },
      },
    ]);
  });
});

describe('TileWorkerPool', () => {
  it('使用单 Worker adapter 完成 transferable round-trip', async () => {
    const worker = new ControlledTileWorker();
    const pool = new TileWorkerPool({ size: 1, createWorker: () => worker });
    const data = readFixtureArrayBuffer();
    const job = pool.enqueue({ key: KEY, generation: 1, data, layers: LAYERS });

    expect(data.byteLength).toBe(0);
    await worker.drain();
    const payload = await job.result;

    expect(payload.protocolVersion).toBe(1);
    expect(payload.batches).toHaveLength(1);
    expect(payload.features).toHaveLength(216);
    expect(payload.stats).toMatchObject({
      inputBytes: 35594,
      decodedFeatures: 680,
      matchedPolygonFeatures: 216,
      batches: 1,
    });
    expect(payload.stats.outputBytes).toBeGreaterThan(0);
    expect(payload.batches[0]?.positions.buffer.byteLength).toBeGreaterThan(0);
    expect(worker.detachedOutputBuffers.every((length) => length === 0)).toBe(
      true,
    );
    pool.dispose();
  });

  it('共享 Line pass 的 Worker 输出只转移唯一 buffer', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 11,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createLineLayerRecipe({
          type: 'line',
          id: 'line-casing',
          sourceLayer: 'synthetic',
          filters: [{ operator: 'has', property: 'name' }],
          paint: { color: '#94a3b8', width: 6 },
        }),
        createLineLayerRecipe({
          type: 'line',
          id: 'line-fill',
          sourceLayer: 'synthetic',
          filters: [{ operator: 'has', property: 'name' }],
          paint: { color: '#f8fafc', width: 2 },
        }),
      ],
    });

    expect(payload.batches).toHaveLength(2);
    const [casing, fill] = payload.batches;
    expect(casing?.type).toBe('line');
    expect(fill?.type).toBe('line');
    if (casing?.type !== 'line' || fill?.type !== 'line') {
      throw new Error('测试 fixture 应只生成 Line batch。');
    }
    expect(casing.geometryKey).toBe(fill.geometryKey);
    expect(casing.positions.buffer).toBe(fill.positions.buffer);

    const transferables = getTileBuildTransferables(payload);
    expect(transferables).toHaveLength(6);
    expect(new Set(transferables).size).toBe(6);
  });

  it('取消、stale generation 和 decode error 都不会挂载结果', async () => {
    const cancelWorker = new ControlledTileWorker();
    const cancelPool = new TileWorkerPool({
      size: 1,
      createWorker: () => cancelWorker,
    });
    const controller = new AbortController();
    const cancelled = cancelPool.enqueue(
      { key: KEY, generation: 2, data: readFixtureArrayBuffer(), layers: LAYERS },
      { signal: controller.signal },
    );
    controller.abort(new DOMException('consumer disposed', 'AbortError'));

    await expect(cancelled.result).rejects.toMatchObject({ name: 'AbortError' });
    await cancelWorker.drain();
    cancelPool.dispose();

    const staleWorker = new ControlledTileWorker();
    const stalePool = new TileWorkerPool({
      size: 1,
      createWorker: () => staleWorker,
    });
    const stale = stalePool.enqueue(
      { key: KEY, generation: 3, data: readFixtureArrayBuffer(), layers: LAYERS },
      { isGenerationCurrent: () => false },
    );
    const staleExpectation = expect(stale.result).rejects.toBeInstanceOf(
      StaleTileBuildError,
    );
    await staleWorker.drain();
    await staleExpectation;
    stalePool.dispose();

    const errorWorker = new ControlledTileWorker();
    const errorPool = new TileWorkerPool({
      size: 1,
      createWorker: () => errorWorker,
    });
    const failed = errorPool.enqueue({
      key: KEY,
      generation: 4,
      data: new Uint8Array([0xff]).buffer,
      layers: LAYERS,
    });
    const failureExpectation = expect(failed.result).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TileWorkerBuildError &&
        error.workerError.code === 'DECODE_ERROR',
    );
    await errorWorker.drain();
    await failureExpectation;
    errorPool.dispose();
  });

  it('dispose 终止 Worker 并拒绝在途 job', async () => {
    const worker = new ControlledTileWorker();
    const pool = new TileWorkerPool({ size: 1, createWorker: () => worker });
    const job = pool.enqueue({
      key: KEY,
      generation: 5,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });

    pool.dispose();

    await expect(job.result).rejects.toThrow('已销毁');
    expect(worker.terminated).toBe(true);
  });

  it('拒绝无效 Worker 响应，并继续调度后续 job', async () => {
    const worker = new ControlledTileWorker();
    const pool = new TileWorkerPool({ size: 1, createWorker: () => worker });
    const invalid = pool.enqueue({
      key: KEY,
      generation: 6,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });

    worker.onmessage?.({
      data: {
        type: 'success',
        protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
        jobId: invalid.jobId,
        generation: 6,
      },
    } as MessageEvent<unknown>);

    await expect(invalid.result).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TileWorkerBuildError &&
        error.workerError.code === 'WORKER_ERROR',
    );

    const valid = pool.enqueue({
      key: KEY,
      generation: 7,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });
    await worker.drain();
    await expect(valid.result).resolves.toMatchObject({ protocolVersion: 1 });
    pool.dispose();
  });

  it('拒绝不匹配版本的 Worker payload', async () => {
    const worker = new ControlledTileWorker();
    const pool = new TileWorkerPool({ size: 1, createWorker: () => worker });
    const job = pool.enqueue({
      key: KEY,
      generation: 8,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });

    worker.onmessage?.({
      data: {
        type: 'success',
        protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
        jobId: job.jobId,
        generation: 8,
        payload: { protocolVersion: 99 },
      },
    } as MessageEvent<unknown>);

    await expect(job.result).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TileWorkerBuildError &&
        error.workerError.code === 'PROTOCOL_VERSION_MISMATCH',
    );
    pool.dispose();
  });

  it('postMessage 失败后释放 slot 并处理下一 job', async () => {
    const worker = new ThrowOnceTileWorker();
    const pool = new TileWorkerPool({ size: 1, createWorker: () => worker });
    const failed = pool.enqueue({
      key: KEY,
      generation: 9,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });

    await expect(failed.result).rejects.toThrow('synthetic postMessage failure');

    const succeeded = pool.enqueue({
      key: KEY,
      generation: 10,
      data: readFixtureArrayBuffer(),
      layers: LAYERS,
    });
    await worker.drain();
    await expect(succeeded.result).resolves.toMatchObject({ protocolVersion: 1 });
    pool.dispose();
  });
});

class ThrowOnceTileWorker extends ControlledTileWorker {
  #shouldThrow = true;

  override postMessage(
    message: Parameters<ControlledTileWorker['postMessage']>[0],
    transfer?: Parameters<ControlledTileWorker['postMessage']>[1],
  ): void {
    if (this.#shouldThrow) {
      this.#shouldThrow = false;
      throw new Error('synthetic postMessage failure');
    }

    super.postMessage(message, transfer);
  }
}

function readFixtureArrayBuffer(): ArrayBuffer {
  return Uint8Array.from(readFileSync(FIXTURE_URL)).buffer;
}
