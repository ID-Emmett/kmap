import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { TileUploadQueue } from '../src/nova-tile/upload/index.js';

const key = (x: number) => createCanonicalTileKey('main', 'r1', 4, x, 4)!;

describe('NTE TileUploadQueue', () => {
  it('enforces per-frame byte/time/commit budgets and supports release', () => {
    const queue = new TileUploadQueue({ maxBytesPerFrame: 100, maxTimeMsPerFrame: 4, maxCommitsPerFrame: 2 });
    queue.beginFrame();
    const first = queue.reserve(60, 2);
    expect(first).toBeDefined();
    expect(queue.reserve(50, 1)).toBeUndefined();
    expect(first!.commit(2)).toBe(true);
    expect(first!.commit()).toBe(false);
    const second = queue.reserve(40, 2);
    expect(second).toBeDefined();
    expect(second!.commit()).toBe(true);
    expect(queue.reserve(1, 0)).toBeUndefined();
    queue.beginFrame();
    const released = queue.reserve(100, 4);
    expect(released!.release()).toBe(true);
    expect(queue.stats.usedBytes).toBe(0);
    expect(queue.stats.usedTimeMs).toBe(0);
  });

  it('prioritizes visible-critical requests and reports backpressure', () => {
    const queue = new TileUploadQueue<number>({ maxBytesPerFrame: 64, maxTimeMsPerFrame: 4, maxCommitsPerFrame: 1 });
    queue.beginFrame();
    queue.enqueue({ id: 'warm', key: key(0), bytes: 16, priority: 'warm-prefetch', upload: () => 1 });
    queue.enqueue({ id: 'critical', key: key(1), bytes: 16, priority: 'visible-critical', upload: () => 2 });
    expect(queue.take()?.id).toBe('critical');
    expect(queue.stats.backpressure).toBe(true);
    expect(queue.cancel('warm')).toBe(true);
  });

  it('processes queued uploads while measuring elapsed time', async () => {
    let now = 0;
    const queue = new TileUploadQueue<number>({ maxBytesPerFrame: 128, maxTimeMsPerFrame: 4, maxCommitsPerFrame: 2, clock: { now: () => now } });
    queue.beginFrame();
    queue.enqueue({ id: 'one', key: key(2), bytes: 32, priority: 'exact-visible', upload: async () => { now = 3; return 7; } });
    await expect(queue.processNext()).resolves.toBe(7);
    expect(queue.stats.commitsThisFrame).toBe(1);
    expect(queue.stats.usedTimeMs).toBe(3);
  });
});
