import { describe, expect, it } from 'vitest';

import { TileRuntime } from '../src/runtime/tileRuntime.js';
import type { TileRuntimeResource } from '../src/runtime/tileRecord.js';
import type { RenderTileKey } from '../src/spatial/types.js';
import type { CanonicalTileKey } from '../src/types.js';
import {
  ControlledTileRender,
  ControlledTileSource,
  ControlledTileWorker,
  createCoverageEntry,
  FakeTileRuntimeClock,
  flushTileRuntime,
} from './helpers/controlledTileRuntime.js';

const A = { sourceId: 'main', z: 3, x: 0, y: 0 } as const;
const A_PARENT = { sourceId: 'main', z: 2, x: 0, y: 0 } as const;
const B = { sourceId: 'main', z: 3, x: 4, y: 2 } as const;
const B_PARENT = { sourceId: 'main', z: 2, x: 2, y: 1 } as const;
const B_CHILDREN = [
  { sourceId: 'main', z: 3, x: 4, y: 2 },
  { sourceId: 'main', z: 3, x: 5, y: 2 },
  { sourceId: 'main', z: 3, x: 4, y: 3 },
  { sourceId: 'main', z: 3, x: 5, y: 3 },
] as const;
const C = { sourceId: 'main', z: 3, x: 6, y: 2 } as const;

describe('TileRuntime progressive display coverage', () => {
  it('目标 Tile 未就绪时请求 parent，并在 parent/exact 就绪时渐进替换', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      maxEntries: 1,
      fetchConcurrency: 4,
      workerConcurrency: 2,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const resourceA = await resolveReady(runtime, source, worker, render, A, 'a');
    expect(resourceA?.renderKeys.at(-1)).toEqual([createCoverageEntry(A).key]);

    runtime.setCoverage([createCoverageEntry(B)]);
    expect(source.calls.map((call) => call.key)).toEqual([
      A,
      A_PARENT,
      B,
      B_PARENT,
    ]);
    expect(resourceA?.disposeCount).toBe(0);

    const parentResource = await resolveReady(
      runtime,
      source,
      worker,
      render,
      B_PARENT,
      'parent',
    );
    expect(parentResource?.renderKeys.at(-1)).toEqual([createCoverageEntry(B_PARENT).key]);
    expect(resourceA?.disposeCount).toBe(1);

    const exactResource = await resolveReady(runtime, source, worker, render, B, 'b');
    expect(exactResource?.renderKeys.at(-1)).toEqual([createCoverageEntry(B).key]);
    expect(exactResource?.opacities.at(-1)).toBe(0);
    expect(parentResource?.disposeCount).toBe(0);

    clock.advance(180);
    runtime.refresh();
    expect(exactResource?.opacities.at(-1)).toBe(1);
    expect(parentResource?.disposeCount).toBe(1);
    runtime.dispose();
  });

  it('display pin 在预算压力下保留 outgoing，替换覆盖移除后才允许淘汰', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      maxEntries: 1,
      fetchConcurrency: 4,
      workerConcurrency: 2,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const resourceA = await resolveReady(runtime, source, worker, render, A, 'a');

    runtime.setCoverage([createCoverageEntry(B)]);
    expect(resourceA?.disposeCount).toBe(0);
    expect(runtime.getStats().cache.pressure).toBe(true);

    runtime.setCoverage([]);
    runtime.setCoverage([createCoverageEntry(C)]);
    expect(resourceA?.disposeCount).toBe(1);
    runtime.dispose();
  });

  it('same-zoom retained cache hit 直接显示，不重新淡入或请求', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      fetchConcurrency: 4,
      minFallbackZoom: 3,
    });

    runtime.setCoverage([createCoverageEntry(A)]);
    const resourceA = await resolveReady(runtime, source, worker, render, A, 'a');
    runtime.setCoverage([createCoverageEntry(C)]);
    await resolveReady(runtime, source, worker, render, C, 'c');
    const opacityCount = resourceA.opacities.length;

    runtime.setCoverage([createCoverageEntry(A)]);
    await runtime.whenIdle();

    expect(source.calls.filter((call) => call.key === A)).toHaveLength(1);
    expect(resourceA.renderKeys.at(-1)).toEqual([createCoverageEntry(A).key]);
    expect(resourceA.opacities.slice(opacityCount)).not.toContain(0);
    expect(resourceA.opacities.at(-1)).toBe(1);
    expect(runtime.getStats()).toMatchObject({
      cache: { readyHits: 1 },
      scheduling: { duplicateRequestStarts: 0 },
    });
    runtime.dispose();
  });

  it('parent 等全部 replacement children ready 后才退出 Display', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const runtime = new TileRuntime({
      source,
      worker,
      render,
      clock,
      fetchConcurrency: 4,
      workerConcurrency: 4,
    });

    runtime.setCoverage([createCoverageEntry(B_PARENT)]);
    const parentResource = await resolveReady(
      runtime,
      source,
      worker,
      render,
      B_PARENT,
      'parent',
    );
    runtime.setCoverage(B_CHILDREN.map((key) => createCoverageEntry(key)));

    const firstChildResource = await resolveReady(
      runtime,
      source,
      worker,
      render,
      B_CHILDREN[0],
      'child-0',
    );
    expect(firstChildResource.renderKeys.at(-1)).toEqual([]);
    expect(parentResource.renderKeys.at(-1)).toEqual([
      createCoverageEntry(B_PARENT).key,
    ]);
    expect(parentResource.disposeCount).toBe(0);

    for (let index = 1; index < B_CHILDREN.length; index += 1) {
      await resolveReady(
        runtime,
        source,
        worker,
        render,
        B_CHILDREN[index]!,
        `child-${index}`,
      );
    }

    expect(firstChildResource.renderKeys.at(-1)).toEqual([
      createCoverageEntry(B_CHILDREN[0]).key,
    ]);
    expect(firstChildResource.opacities.at(-1)).toBe(0);
    expect(parentResource.disposeCount).toBe(0);

    clock.advance(180);
    runtime.refresh();
    expect(firstChildResource.opacities.at(-1)).toBe(1);
    expect(parentResource.renderKeys.at(-1)).toEqual([]);
    expect(parentResource.disposeCount).toBe(0);
    runtime.dispose();
  });
});

async function resolveReady(
  runtime: TileRuntime<{ id: string }>,
  source: ControlledTileSource,
  worker: ControlledTileWorker<{ id: string }>,
  render: ControlledTileRender<{ id: string }>,
  key: CanonicalTileKey,
  id: string,
): Promise<TrackingResource> {
  source.resolve(key, { status: 'data', data: new ArrayBuffer(4) });
  await flushTileRuntime();
  worker.resolve(key, { id });
  await flushTileRuntime();
  const resource = new TrackingResource();
  render.resolve(key, resource);
  await flushTileRuntime();
  expect(runtime.getTile(key)?.state).toBe('ready');
  return resource;
}

class TrackingResource implements TileRuntimeResource {
  readonly cpuBytes = 4;
  readonly gpuBytes = 4;
  readonly stats = {
    batches: 1,
    features: 1,
    vertices: 3,
    indices: 3,
    objects: 2,
  } as const;
  readonly renderKeys: RenderTileKey[][] = [];
  readonly opacities: number[] = [];
  disposeCount = 0;

  setRenderKeys(keys: readonly RenderTileKey[]): void {
    this.renderKeys.push([...keys]);
  }

  setDisplayOpacity(opacity: number): void {
    this.opacities.push(opacity);
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}
