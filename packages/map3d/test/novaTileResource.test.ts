import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { TileResourceRegistry } from '../src/nova-tile/resources/index.js';

const key = (x: number) => createCanonicalTileKey('main', 'r1', 3, x, 2)!;

describe('NTE TileResourceRegistry', () => {
  it('tracks CPU/GPU ownership, references and delayed release', () => {
    const disposed: string[] = [];
    const registry = new TileResourceRegistry({ releaseDelayFrames: 2, maxEntries: 4, maxCpuBytes: 100, maxGpuBytes: 100 });
    registry.register({ id: 'tile-a', tileKey: key(0), cpuBytes: 10, gpuBytes: 20, dispose: () => disposed.push('tile-a') });
    registry.retain('tile-a', 1);
    registry.release('tile-a', 2);
    expect(registry.stats.pendingReleaseEntries).toBe(1);
    registry.advanceFrame(3);
    expect(registry.get('tile-a')).toBeDefined();
    registry.advanceFrame(4);
    expect(registry.get('tile-a')).toBeUndefined();
    expect(disposed).toEqual(['tile-a']);
    expect(registry.stats.cpuBytes).toBe(0);
    expect(registry.stats.gpuBytes).toBe(0);
  });

  it('keeps referenced resources alive and emits pressure events', () => {
    const registry = new TileResourceRegistry({ maxEntries: 1, maxCpuBytes: 8, maxGpuBytes: 8 });
    const pressures: string[][] = [];
    registry.onPressure((event) => pressures.push([...event.reasons]));
    registry.register({ id: 'resident', tileKey: key(1), cpuBytes: 16, gpuBytes: 16, cacheRole: 'resident' });
    registry.retain('resident');
    expect(registry.stats.pressure).toBe(true);
    expect(pressures.at(-1)).toEqual(['cpu', 'gpu']);
    expect(registry.remove('resident')).toBe(false);
    registry.release('resident');
    expect(registry.stats.referencedEntries).toBe(0);
  });

  it('supports three create/dispose cycles with zero final ownership', () => {
    const registry = new TileResourceRegistry({ releaseDelayFrames: 0 });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const id = `tile-${cycle}`;
      registry.register({ id, tileKey: key(cycle), cpuBytes: 1, gpuBytes: 2 });
      registry.retain(id);
      registry.release(id);
      registry.advanceFrame(cycle);
    }
    registry.clear();
    expect(registry.stats.entries).toBe(0);
    expect(registry.stats.cpuBytes).toBe(0);
    expect(registry.stats.gpuBytes).toBe(0);
  });
});
