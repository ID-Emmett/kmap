import { describe, expect, it } from 'vitest';

import {
  canonicalTileKeyToString,
  createCanonicalTileKey,
  createRenderTileKey,
  overzoomCanonicalTileKey,
  renderTileKeyToString,
  resolveDataZoom,
} from '../src/spatial/tileKey.js';

describe('TileKey', () => {
  it('同一 canonical Tile 的 world wrap 共享数据键并区分渲染键', () => {
    const westWorld = createRenderTileKey('main', 2, -1, 1);
    const baseWorld = createRenderTileKey('main', 2, 3, 1);

    expect(westWorld).toEqual({
      canonical: { sourceId: 'main', z: 2, x: 3, y: 1 },
      wrap: -1,
    });
    expect(baseWorld).toEqual({
      canonical: { sourceId: 'main', z: 2, x: 3, y: 1 },
      wrap: 0,
    });
    expect(canonicalTileKeyToString(westWorld!.canonical)).toBe(
      canonicalTileKeyToString(baseWorld!.canonical),
    );
    expect(renderTileKeyToString(westWorld!)).not.toBe(
      renderTileKeyToString(baseWorld!),
    );
  });

  it('忽略 Y 越界并稳定归一化 X', () => {
    expect(createCanonicalTileKey('main', 3, 9, 4)).toEqual({
      sourceId: 'main',
      z: 3,
      x: 1,
      y: 4,
    });
    expect(createCanonicalTileKey('main', 3, 1, -1)).toBeUndefined();
    expect(createCanonicalTileKey('main', 3, 1, 8)).toBeUndefined();
  });

  it('限制 source zoom 并将 overzoom 请求映射到真实父层级', () => {
    expect(resolveDataZoom(3.9, 5, 17)).toBe(5);
    expect(resolveDataZoom(12.9, 5, 17)).toBe(12);
    expect(resolveDataZoom(22, 5, 17)).toBe(17);
    expect(overzoomCanonicalTileKey('main', 4, 13, 10, 2)).toEqual({
      sourceId: 'main',
      z: 2,
      x: 3,
      y: 2,
    });
  });

  it('生成稳定字符串键并拒绝未归一化 canonical key', () => {
    expect(
      canonicalTileKeyToString({ sourceId: 'main', z: 3, x: 1, y: 4 }),
    ).toBe('main/3/1/4');
    expect(
      renderTileKeyToString({
        canonical: { sourceId: 'main', z: 3, x: 1, y: 4 },
        wrap: -2,
      }),
    ).toBe('main/3/1/4@-2');
    expect(() =>
      canonicalTileKeyToString({ sourceId: 'main', z: 3, x: 9, y: 4 }),
    ).toThrow('必须已归一化');
  });
});
