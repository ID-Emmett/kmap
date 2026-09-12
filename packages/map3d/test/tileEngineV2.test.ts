import { describe, expect, it } from 'vitest';

import { createInteractionMotionSnapshot } from '../src/interaction/motionSnapshot.js';
import { TileEngineV2 } from '../src/runtime/tileEngineV2.js';
import { TileEngineV2Scheduler } from '../src/runtime/tileEngineV2Schedule.js';
import type { TileRuntimeResource } from '../src/runtime/tileRecord.js';
import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
import { calculateTileCoverage } from '../src/spatial/tileCoverage.js';
import type {
  TileCoverageEntry,
  TileCoverageResult,
} from '../src/spatial/tileCoverage.js';
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

const A = { sourceId: 'main', z: 3, x: 1, y: 2 } as const;
const B = { sourceId: 'main', z: 3, x: 2, y: 2 } as const;
const C = { sourceId: 'main', z: 3, x: 3, y: 2 } as const;
const PARENT = { sourceId: 'main', z: 2, x: 2, y: 1 } as const;
const CHILDREN = [
  { sourceId: 'main', z: 3, x: 4, y: 2 },
  { sourceId: 'main', z: 3, x: 5, y: 2 },
  { sourceId: 'main', z: 3, x: 4, y: 3 },
  { sourceId: 'main', z: 3, x: 5, y: 3 },
] as const;

describe('TileEngineV2', () => {
  it('运动中保留 ordinary prefetch，并按 coverage/refinement/prefetch 排序', () => {
    const scheduler = new TileEngineV2Scheduler();
    const source = normalizeVectorTileSourceOptions({
      id: 'main',
      tiles: ['https://example.test/{z}/{x}/{y}.mvt'],
      minZoom: 0,
      maxZoom: 3,
    });
    const view = {
      center: { lng: 0, lat: 0 },
      zoom: 3,
      bearing: 0,
      pitch: 0,
    };
    const coverage = calculateTileCoverage(view, { width: 512, height: 512 }, source);
    scheduler.setMotion({
      phase: 'active',
      timeMs: 100,
      velocity: { panX: 1, panY: 0, bearing: 0, pitch: 0, zoom: 0 },
    });
    const schedule = scheduler.createSchedule(view, { width: 512, height: 512 }, source, coverage, 100);
    expect(schedule.diagnostics.ordinaryPrefetch).toBeGreaterThan(0);
    expect(schedule.entries.findIndex((entry) => entry.priority.role === 'coverage')).toBeLessThan(
      schedule.entries.findIndex((entry) => entry.priority.role === 'prefetch'),
    );
  });

  it('active 和 settling 阶段不再给 refinement 设置统一 idle-only notBefore', () => {
    const scheduler = new TileEngineV2Scheduler();
    const source = normalizeVectorTileSourceOptions({
      id: 'main',
      tiles: ['https://example.test/{z}/{x}/{y}.mvt'],
      minZoom: 0,
      maxZoom: 4,
    });
    const view = { center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 };
    const viewport = { width: 512, height: 512 };
    const coverage = createManualCoverage([
      createCoverageEntry({ sourceId: 'main', z: 2, x: 0, y: 0 }, {
        screenDistance: 500,
      }),
      ...createFairnessEntries(8),
    ]);

    for (const phase of ['active', 'settling'] as const) {
      scheduler.setMotion(
        createInteractionMotionSnapshot(
          phase,
          2_000,
          { panX: 60_000, panY: 10_000, bearing: 0, pitch: 0 },
        ),
      );
      const schedule = scheduler.createSchedule(view, viewport, source, coverage, 2_050);
      const refinements = schedule.entries.filter(
        (entry) => entry.priority.role === 'refinement',
      );

      expect(refinements.length).toBeGreaterThan(0);
      expect(refinements.every((entry) => entry.priority.notBefore === undefined)).toBe(true);
      expect(schedule.diagnostics.refinementReadyAt).toBe(2_050);
      expect(schedule.diagnostics.delayedByNotBefore).toBe(0);
    }
  });

  it('同角色 refinement 按距离带轮询生成 coverageRank，避免中心向外独占', () => {
    const scheduler = new TileEngineV2Scheduler();
    const source = normalizeVectorTileSourceOptions({
      id: 'main',
      tiles: ['https://example.test/{z}/{x}/{y}.mvt'],
      minZoom: 0,
      maxZoom: 4,
    });
    const view = { center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 };
    const viewport = { width: 512, height: 512 };
    const coverage = createManualCoverage([
      createCoverageEntry({ sourceId: 'main', z: 2, x: 0, y: 0 }, {
        screenDistance: 500,
      }),
      ...createFairnessEntries(8),
    ]);

    const schedule = scheduler.createSchedule(view, viewport, source, coverage, 0);
    const refinementDistances = schedule.entries
      .filter((entry) => entry.priority.role === 'refinement')
      .map((entry) => entry.priority.screenDistance);

    expect(refinementDistances.slice(0, 4)).toEqual([0, 20, 40, 60]);
    expect(refinementDistances.slice(4)).toEqual([10, 30, 50, 70]);
  });

  it('同角色请求使用 coverageRank 和 deadline age，远处 queued Tile 不被新中心 Tile 饿死', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const engine = new TileEngineV2({
      source,
      worker,
      render,
      clock,
      fetchConcurrency: 1,
      minFallbackZoom: 3,
    });

    engine.setCoverage([
      createCoverageEntry(A, { role: 'refinement', screenDistance: 0, coverageRank: 0 }),
      createCoverageEntry(B, { role: 'refinement', screenDistance: 1_000, coverageRank: 1 }),
    ]);
    expect(source.calls.map((call) => call.key)).toEqual([A]);

    clock.advance(300);
    engine.setCoverage([
      createCoverageEntry(A, { role: 'refinement', screenDistance: 0, coverageRank: 0 }),
      createCoverageEntry(B, { role: 'refinement', screenDistance: 1_000, coverageRank: 1 }),
      createCoverageEntry(C, { role: 'refinement', screenDistance: 1, coverageRank: 2 }),
    ]);
    const queuedB = engine.getDiagnostics().requestQueue.find(
      (entry) => entry.id === 'main/3/2/2',
    );
    expect(queuedB).toMatchObject({
      coverageRank: 1,
      queueAgeMs: 300,
      starved: true,
    });
    expect(engine.getStats().scheduling).toMatchObject({
      starvedQueueCount: 1,
      oldestStarvedQueueAgeMs: 300,
    });

    source.resolve(A, { status: 'empty' });
    await flushTileRuntime();

    expect(source.calls.map((call) => call.key)).toEqual([A, B]);
    engine.dispose();
  });

  it('提供 Target/Render Cover/Retained Cache 的独立诊断集合', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<never>();
    const render = new ControlledTileRender<never>();
    const engine = new TileEngineV2({ source, worker, render, clock });

    engine.setCoverage([createCoverageEntry(A)]);
    expect(engine.getDiagnostics()).toMatchObject({
      targetCoverage: ['main/3/1/2'],
      renderCover: [],
    });
    source.resolve(A, { status: 'empty' });
    await flushTileRuntime();
    await engine.whenIdle();
    expect(engine.getDiagnostics().targetCoverage).toEqual(['main/3/1/2']);

    engine.setCoverage([createCoverageEntry(B)]);
    expect(engine.getDiagnostics().retainedCache).toContain('main/3/1/2');
    engine.dispose();
  });

  it('多个 upload 在同一提交边界一次进入 Render Cover', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const engine = new TileEngineV2({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    engine.setCoverage([createCoverageEntry(A), createCoverageEntry(B)]);
    source.resolve(A, { status: 'data', data: new ArrayBuffer(4) });
    source.resolve(B, { status: 'data', data: new ArrayBuffer(4) });
    await flushTileRuntime();
    worker.resolve(A, { id: 'a' });
    worker.resolve(B, { id: 'b' });
    await flushTileRuntime();
    const resourceA = new TrackingResource();
    const resourceB = new TrackingResource();

    render.resolve(A, resourceA);
    render.resolve(B, resourceB);
    await flushTileRuntime();

    expect(engine.getDiagnostics().cohortCommits).toBe(1);
    expect([...engine.getDiagnostics().renderCover].sort()).toEqual([
      'main/3/1/2',
      'main/3/2/2',
    ]);
    expect(resourceA.renderKeys.at(-1)).toEqual([createCoverageEntry(A).key]);
    expect(resourceB.renderKeys.at(-1)).toEqual([createCoverageEntry(B).key]);
    engine.dispose();
  });

  it('单个 exact upload 不会在目标覆盖未完整时独自改变显示集合', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const engine = new TileEngineV2({
      source,
      worker,
      render,
      clock,
      minFallbackZoom: 3,
    });

    engine.setCoverage([createCoverageEntry(A), createCoverageEntry(B)]);
    const resourceA = await resolveReady(engine, source, worker, render, A, 'a');

    expect(engine.getDiagnostics().cohortCommits).toBe(1);
    expect(engine.getDiagnostics().renderCover).toEqual([]);
    expect(resourceA.renderKeys.at(-1)).toEqual([]);

    const resourceB = await resolveReady(engine, source, worker, render, B, 'b');
    expect(engine.getDiagnostics().cohortCommits).toBe(2);
    expect([...engine.getDiagnostics().renderCover].sort()).toEqual([
      'main/3/1/2',
      'main/3/2/2',
    ]);
    expect(resourceA.renderKeys.at(-1)).toEqual([createCoverageEntry(A).key]);
    expect(resourceB.renderKeys.at(-1)).toEqual([createCoverageEntry(B).key]);
    engine.dispose();
  });

  it('初始无显示资源时请求 parent fallback，并先提交完整 coarse cover', async () => {
    const clock = new FakeTileRuntimeClock();
    const source = new ControlledTileSource();
    const worker = new ControlledTileWorker<{ id: string }>();
    const render = new ControlledTileRender<{ id: string }>();
    const engine = new TileEngineV2({ source, worker, render, clock });

    engine.setCoverage(CHILDREN.map((key) => createCoverageEntry(key)));
    expect(source.calls.map((call) => call.key)).toContainEqual(PARENT);

    const parent = await resolveReady(
      engine,
      source,
      worker,
      render,
      PARENT,
      'parent',
    );

    expect(parent.renderKeys.at(-1)).toEqual([createCoverageEntry(PARENT).key]);
    expect(engine.getDiagnostics().renderCover).toEqual(['main/2/2/1']);
    engine.dispose();
  });

  it('真实 rAF 提交未触发前保持非 idle 且不挂载资源', async () => {
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    let frame: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {};

    try {
      const source = new ControlledTileSource();
      const worker = new ControlledTileWorker<{ id: string }>();
      const render = new ControlledTileRender<{ id: string }>();
      const engine = new TileEngineV2({
        source,
        worker,
        render,
        reducedMotion: true,
        minFallbackZoom: 3,
      });

      engine.setCoverage([createCoverageEntry(A)]);
      const resource = await resolveReady(engine, source, worker, render, A, 'a');

      expect(engine.getStats().idle).toBe(false);
      expect(engine.getDiagnostics().renderCover).toEqual([]);
      expect(resource.renderKeys).toEqual([]);

      frame?.(16);
      await flushTileRuntime();

      expect(engine.getStats().idle).toBe(true);
      expect(engine.getDiagnostics().renderCover).toEqual(['main/3/1/2']);
      expect(resource.renderKeys.at(-1)).toEqual([createCoverageEntry(A).key]);
      engine.dispose();
    } finally {
      restoreRaf(previousRaf, previousCancel);
    }
  });
});

function createManualCoverage(
  visible: readonly TileCoverageEntry[],
  prefetch: readonly TileCoverageEntry[] = [],
): TileCoverageResult {
  return {
    referenceZoom: 4,
    origin: { z: 4, tileX: 0, tileY: 0, meters: { x: 0, y: 0 } },
    footprint: Object.freeze([]),
    maxGroundDistance: 0,
    tiles: Object.freeze([...visible, ...prefetch]),
    visible: Object.freeze([...visible]),
    prefetch: Object.freeze([...prefetch]),
    truncated: false,
    diagnostics: Object.freeze({
      candidateCount: visible.length + prefetch.length,
      evaluatedCount: 0,
      refinedCount: 0,
      coarsenedCount: 0,
      budgetLimited: false,
      budgetExceeded: false,
      zoomDistribution: Object.freeze([]),
    }),
  };
}

function createFairnessEntries(count: number): TileCoverageEntry[] {
  return Array.from({ length: count }, (_, index) =>
    createCoverageEntry(
      { sourceId: 'main', z: 3, x: index, y: 0 },
      { screenDistance: index * 10 },
    ),
  );
}

async function resolveReady(
  engine: TileEngineV2<{ id: string }>,
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
  expect(engine.getTile(key)?.state).toBe('ready');
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

function restoreRaf(
  previousRaf: typeof globalThis.requestAnimationFrame | undefined,
  previousCancel: typeof globalThis.cancelAnimationFrame | undefined,
): void {
  if (previousRaf === undefined) {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  } else {
    globalThis.requestAnimationFrame = previousRaf;
  }
  if (previousCancel === undefined) {
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  } else {
    globalThis.cancelAnimationFrame = previousCancel;
  }
}
