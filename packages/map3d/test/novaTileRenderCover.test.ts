import { describe, expect, it } from 'vitest';
import { createRenderTileKey, renderTileKeyToString } from '../src/nova-tile/tileAddress.js';
import { TilePyramid } from '../src/nova-tile/pyramid/index.js';
import { NovaTileRenderCover, resolveRenderCover } from '../src/nova-tile/render/index.js';
import type { RenderTileCandidate } from '../src/nova-tile/render/index.js';

const pyramid = new TilePyramid({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 4 });
const target = createRenderTileKey('main', 'r1', 2, 1, 1, 'origin')!;
const parent = pyramid.parentRenderKey(target)!;

function ready(key: ReturnType<typeof createRenderTileKey>): RenderTileCandidate {
  if (key === undefined) throw new Error('Render key 创建失败。');
  return { key, availability: 'ready' };
}

describe('NTE Render Cover and Cohort Commit', () => {
  it('resolves exact before ancestor fallback', () => {
    const candidates = new Map([[renderTileKeyToString(parent), ready(parent)]]);
    const ancestor = resolveRenderCover([target], candidates, { planEpoch: 1, pyramid });
    expect(ancestor.coverageComplete).toBe(true);
    expect(ancestor.cells[0]?.role).toBe('ancestor');

    candidates.set(renderTileKeyToString(target), ready(target));
    const exact = resolveRenderCover([target], candidates, { planEpoch: 1, pyramid });
    expect(exact.cells[0]?.role).toBe('exact');
    expect(exact.entries[0]?.key).toEqual(target);
  });

  it('resolves complete descendant fallback only when all quadrants are ready', () => {
    const descendants = pyramid.childrenRenderKeys(target);
    const candidates = new Map(descendants.map((key) => [renderTileKeyToString(key), ready(key)]));
    const result = resolveRenderCover([target], candidates, { planEpoch: 3, pyramid });
    expect(result.coverageComplete).toBe(true);
    expect(result.cells[0]?.role).toBe('descendant');
    candidates.delete(renderTileKeyToString(descendants[0]!));
    const incomplete = resolveRenderCover([target], candidates, { planEpoch: 3, pyramid });
    expect(incomplete.coverageComplete).toBe(false);
    expect(incomplete.blankArea).toBeGreaterThan(0);
  });

  it('commits complete cohorts atomically and preserves outgoing references during transition', () => {
    const cover = new NovaTileRenderCover(pyramid, { transitionDurationMs: 150 });
    const first = cover.setTarget(1, [target], new Map([[renderTileKeyToString(parent), ready(parent)]]));
    expect(cover.commitResolution(first, 0)).toBe(true);
    expect(cover.snapshot.coverageComplete).toBe(true);
    const second = cover.setTarget(2, [target], new Map([[renderTileKeyToString(target), ready(target)]]));
    expect(cover.commitResolution(second, 10)).toBe(true);
    expect(cover.snapshot.outgoing).toHaveLength(1);
    expect(cover.snapshot.transition?.progress).toBe(0);
    cover.advance(160);
    expect(cover.snapshot.outgoing).toHaveLength(0);
    expect(cover.snapshot.blankArea).toBe(0);
  });

  it('rejects stale epoch cohorts and keeps blankArea zero for committed cover', () => {
    const cover = new NovaTileRenderCover(pyramid);
    const resolution = cover.setTarget(4, [target], new Map([[renderTileKeyToString(target), ready(target)]]));
    const cohort = cover.createCohort(0)!;
    cover.invalidate(5);
    expect(cover.commit(cohort, 1)).toBe(false);
    expect(cover.snapshot.blankArea).toBe(0);
    expect(cover.coverageComplete).toBe(true);
    expect(resolution.coverageComplete).toBe(true);
  });
});
