import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey, createRenderTileKey } from '../src/nova-tile/tileAddress.js';
import { TilePyramid } from '../src/nova-tile/pyramid/index.js';

const pyramid = new TilePyramid({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 4 });

describe('NTE TilePyramid', () => {
  it('returns parent, children and stable ancestor relationships', () => {
    const key = createCanonicalTileKey('main', 'r1', 2, 3, 2)!;
    expect(pyramid.parent(key)).toEqual({ sourceId: 'main', sourceRevision: 'r1', z: 1, x: 1, y: 1 });
    expect(pyramid.children(pyramid.parent(key)!)).toHaveLength(4);
    expect(pyramid.isAncestor(pyramid.parent(key)!, key)).toBe(true);
    expect(pyramid.ancestorAtZoom(key, 0)).toEqual({ sourceId: 'main', sourceRevision: 'r1', z: 0, x: 0, y: 0 });
  });

  it('preserves wrap index across render parent and children', () => {
    const wrapped = createRenderTileKey('main', 'r1', 2, -1, 1, 'origin')!;
    expect(wrapped.wrapIndex).toBe(-1);
    expect(pyramid.parentRenderKey(wrapped)?.wrapIndex).toBe(-1);
    expect(pyramid.childrenRenderKeys(wrapped).map((entry) => entry.wrapIndex)).toEqual([-1, -1, -1, -1]);
  });

  it('keeps Y boundary finite and rejects keys from another source revision', () => {
    expect(createCanonicalTileKey('main', 'r1', 2, 1, -1)).toBeUndefined();
    expect(createCanonicalTileKey('main', 'r1', 2, 1, 4)).toBeUndefined();
    expect(() => pyramid.parent(createCanonicalTileKey('main', 'r2', 2, 1, 1)!)).toThrow('不属于当前');
  });
});
