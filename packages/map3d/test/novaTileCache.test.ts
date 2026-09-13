import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { MemoryPersistentTileStore, PersistentTileCache, TileCache } from '../src/nova-tile/cache/index.js';

const key = (revision: string, x: number) => createCanonicalTileKey('main', revision, 2, x, 1)!;

describe('NTE layered cache', () => {
  it('tracks roles, hits and LRU eviction under entry/byte budgets', () => {
    const cache = new TileCache<number>({ maxEntries: 2, maxCpuBytes: 10, maxGpuBytes: 10 });
    cache.set({ key: key('r1', 0), generation: 1, state: 'ready', payload: 1, cpuBytes: 6, gpuBytes: 0, role: 'cold', pinned: false, lastAccessedAt: 0 });
    cache.set({ key: key('r1', 1), generation: 1, state: 'empty', cpuBytes: 0, gpuBytes: 0, role: 'warm', pinned: false, lastAccessedAt: 1 });
    expect(cache.get(key('r1', 0))?.state).toBe('ready');
    cache.set({ key: key('r1', 2), generation: 1, state: 'negative', cpuBytes: 6, gpuBytes: 0, role: 'cold', pinned: false, lastAccessedAt: 2 });
    expect(cache.size).toBeLessThanOrEqual(2);
    expect(cache.stats.readyHits).toBe(1);
    expect(cache.stats.evictions).toBeGreaterThan(0);
  });

  it('keeps resident entries pinned and exposes pressure when all entries are pinned', () => {
    const cache = new TileCache<number>({ maxEntries: 1, maxCpuBytes: 1, maxGpuBytes: 1 });
    cache.set({ key: key('r1', 0), generation: 1, state: 'ready', cpuBytes: 4, gpuBytes: 4, role: 'resident', pinned: true, lastAccessedAt: 0 });
    expect(cache.stats.pressure).toBe(true);
    expect(cache.has(key('r1', 0))).toBe(true);
  });

  it('isolates persistent entries by source revision', async () => {
    const store = new MemoryPersistentTileStore<number>();
    const persistent = new PersistentTileCache(store);
    await persistent.write({ key: key('r1', 0), sourceRevision: 'r1', state: 'ready', payload: 7, bytes: 4, storedAt: 0 });
    expect((await persistent.read(key('r1', 0)))?.payload).toBe(7);
    expect(await persistent.read(key('r2', 0))).toBeUndefined();
  });
});
