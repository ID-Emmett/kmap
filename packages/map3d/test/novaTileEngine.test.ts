import { describe, expect, it } from 'vitest';

import {
  NovaTileEngine,
  advancePlanEpoch,
  advanceTileGeneration,
  canTransitionNovaTile,
  canonicalTileKeyToString,
  createCanonicalTileKey,
  createNovaTileRecord,
  createRenderTileKey,
  isCurrentAsyncIdentity,
  isNovaTileInFlight,
  isNovaTileTerminal,
  renderTileKeyToString,
  transitionNovaTileRecord,
} from '../src/nova-tile/index.js';

describe('NovaTileEngine contract', () => {
  it('canonical key includes source revision and normalizes world wrap', () => {
    const west = createCanonicalTileKey('main', '2026-09', 2, -1, 1);
    const east = createCanonicalTileKey('main', '2026-09', 2, 3, 1);
    const changed = createCanonicalTileKey('main', '2026-10', 2, 3, 1);

    expect(west).toEqual(east);
    expect(canonicalTileKeyToString(west!)).toBe('main/2026-09/2/3/1');
    expect(canonicalTileKeyToString(changed!)).not.toBe(canonicalTileKeyToString(east!));
    expect(createCanonicalTileKey('main', '2026-09', 2, 1, 4)).toBeUndefined();
  });

  it('render key keeps wrap and MapOrigin independent from canonical identity', () => {
    const canonical = createCanonicalTileKey('main', 'r1', 3, 1, 2)!;
    const first = createRenderTileKey(canonical, 0, 'origin-a');
    const second = createRenderTileKey(canonical, -1, 'origin-b');

    expect(first.canonical).toEqual(canonical);
    expect(renderTileKeyToString(first)).toBe('main/r1/3/1/2@0#origin-a');
    expect(renderTileKeyToString(first)).not.toBe(renderTileKeyToString(second));
  });

  it('epoch and generation identities reject late asynchronous results', () => {
    const identity = { planEpoch: advancePlanEpoch(4), generation: advanceTileGeneration(8) };
    expect(isCurrentAsyncIdentity(identity, { planEpoch: 5, generation: 9 })).toBe(true);
    expect(isCurrentAsyncIdentity(identity, { planEpoch: 4, generation: 9 })).toBe(false);
    expect(isCurrentAsyncIdentity(identity, { planEpoch: 5, generation: 8 })).toBe(false);
  });

  it('state model separates lifecycle, render role and cache role', () => {
    const key = createCanonicalTileKey('main', 'r1', 0, 0, 0)!;
    const record = createNovaTileRecord({
      key,
      generation: 1,
      planEpoch: 2,
      now: 100,
      renderRole: 'exact',
      cacheRole: 'resident',
    });

    expect(record.lifecycleState).toBe('planned');
    expect(isNovaTileInFlight(record.lifecycleState)).toBe(true);
    expect(canTransitionNovaTile('planned', 'fetching')).toBe(true);
    expect(canTransitionNovaTile('planned', 'committed')).toBe(false);
    transitionNovaTileRecord(record, 'fetching', 110);
    transitionNovaTileRecord(record, 'decoded', 120);
    transitionNovaTileRecord(record, 'built', 130);
    transitionNovaTileRecord(record, 'uploadQueued', 140);
    transitionNovaTileRecord(record, 'ready', 150);
    transitionNovaTileRecord(record, 'committed', 160);
    transitionNovaTileRecord(record, 'retained', 170);
    transitionNovaTileRecord(record, 'evicted', 180);
    expect(isNovaTileTerminal(record.lifecycleState)).toBe(true);
    expect(() => transitionNovaTileRecord(record, 'planned', 190)).toThrow('不能从 evicted 转换');
  });

  it('engine advances plan epoch and emits frame stats with explicit lifecycle', async () => {
    let now = 0;
    const engine = new NovaTileEngine({ clock: { now: () => now } });
    const stats: number[] = [];
    engine.on('stats', (event) => stats.push(event.planEpoch));
    await engine.initialize();
    engine.resize({ width: 800, height: 600 });
    engine.updateView({ center: { lng: 0, lat: 0 }, zoom: 2, bearing: 0, pitch: 0 });
    now = 16;
    engine.frame({ frameId: 1, timeMs: now, deltaMs: 16 });
    expect(engine.getPlanEpoch()).toBe(1);
    expect(stats).toEqual([1]);
    await engine.dispose();
    await engine.dispose();
    expect(() => engine.frame({ frameId: 2, timeMs: 32, deltaMs: 16 })).toThrow('已销毁');
  });

  it('exposes the NTE contract through isolated module boundaries', async () => {
    const engineModule = await import('../src/nova-tile/novaTileEngine.js');
    const addressModule = await import('../src/nova-tile/tileAddress.js');

    expect(Object.keys(engineModule)).toEqual(['NovaTileEngine']);
    expect(Object.keys(addressModule)).toEqual([
      'MAX_TILE_ZOOM',
      'ancestorCanonicalTileKey',
      'canonicalTileKeyToString',
      'createCanonicalTileKey',
      'createRenderTileKey',
      'normalizeCanonicalTileKey',
      'normalizeTileX',
      'renderTileKeyToString',
    ]);
  });
});
