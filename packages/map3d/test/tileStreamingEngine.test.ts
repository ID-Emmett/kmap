import { describe, expect, it } from 'vitest';
import { TilePyramid } from '../src/streaming/tilePyramid.js';
import { TileRequestScheduler } from '../src/streaming/tileRequestScheduler.js';
import { TileCache } from '../src/streaming/tileCache.js';
import { TileUploadBudget } from '../src/streaming/tileUploadBudget.js';
import { TileRenderCover } from '../src/streaming/tileRenderCover.js';
import { createCanonicalTileKey, createRenderTileKey, renderTileKeyToString } from '../src/spatial/tileKey.js';

const pyramid = new TilePyramid({ sourceId: 's', minZoom: 0, maxZoom: 4 });
const key = createCanonicalTileKey('s', 2, 1, 2)!;

describe('TileStreamingEngine vertical slice invariants', () => {
  it('maintains canonical parent/children and wrap relation', () => {
    expect(pyramid.parent(key)).toEqual({ sourceId: 's', z: 1, x: 0, y: 1 });
    expect(pyramid.children(pyramid.parent(key)!)).toHaveLength(4);
    const wrapped = createRenderTileKey('s', 2, -1, 2)!;
    expect(wrapped.wrap).toBe(-1);
    expect(pyramid.parentRenderKey(wrapped)?.wrap).toBe(-1);
  });

  it('starts requests within frame bound and prevents duplicate active work', () => {
    const scheduler = new TileRequestScheduler({ maxStartsPerFrame: 2 });
    const entries = [1, 2, 3].map((x) => ({
      key: createRenderTileKey('s', 2, x, 2)!,
      kind: 'visible' as const,
      priority: { role: 'coverage' as const, visible: true, screenDistance: x, coverageRank: x },
    }));
    scheduler.beginFrame(0);
    scheduler.replace(entries, 0);
    expect(scheduler.take(0)?.key.x).toBeDefined();
    expect(scheduler.take(0)?.key.x).toBeDefined();
    expect(scheduler.take(0)).toBeUndefined();
    expect(scheduler.getStats().requestStarts).toBe(2);
  });

  it('retains negative records and evicts oldest entries under budget', () => {
    const cache = new TileCache<{ stats: { outputBytes: number }}>({ maxEntries: 1, maxCpuBytes: 10, maxGpuBytes: 10 });
    const first = createCanonicalTileKey('s', 1, 0, 0)!;
    const second = createCanonicalTileKey('s', 1, 1, 0)!;
    cache.set({ key: first, generation: 1, state: 'empty', cpuBytes: 0, gpuBytes: 0, pinned: false, lastAccessedAt: 0 });
    expect(cache.get(first, 1)?.state).toBe('empty');
    cache.set({ key: second, generation: 2, state: 'failed', cpuBytes: 0, gpuBytes: 0, pinned: false, lastAccessedAt: 2 });
    expect(cache.has(first)).toBe(false);
    expect(cache.stats().emptyHits).toBe(1);
  });

  it('enforces per-frame upload bytes and commit count', () => {
    const budget = new TileUploadBudget({ maxBytesPerFrame: 100, maxCommitsPerFrame: 1 });
    budget.beginFrame();
    const first = budget.reserve(80);
    expect(first).toBeDefined();
    first!.commit();
    expect(budget.reserve(10)).toBeUndefined();
    budget.beginFrame();
    expect(budget.reserve(100)).toBeDefined();
  });

  it('resolves best available parent fallback without empty cover', () => {
    const cover = new TileRenderCover(pyramid);
    const target = createRenderTileKey('s', 2, 1, 2)!;
    const parent = pyramid.parentRenderKey(target)!;
    const result = cover.resolve([target], new Map([[renderTileKeyToString(parent), 'ready']]));
    expect(result.complete).toBe(true);
    expect(result.entries[0]?.key).toEqual(parent);
  });

  it('does not import legacy runtime authority', async () => {
    const source = await import('../src/streaming/tileStreamingEngine.js');
    expect(Object.keys(source).join('|')).not.toContain('TileEngineV2');
  });
});
