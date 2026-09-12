import { describe, expect, it } from 'vitest';

import { clipTriangleToTileExtent } from '../src/geometry/polygonClip.js';

describe('clipTriangleToTileExtent', () => {
  it('保留 Tile extent 内的三角形', () => {
    const triangle = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 100, y: 300 },
    ] as const;

    expect(clipTriangleToTileExtent(triangle, 4096)).toEqual(triangle);
  });

  it('将 MVT buffer 三角形裁到 Tile 核心边界', () => {
    const result = clipTriangleToTileExtent(
      [
        { x: -80, y: -80 },
        { x: 4176, y: 100 },
        { x: 100, y: 4176 },
      ],
      4096,
    );

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.every((point) => point.x >= 0 && point.x <= 4096)).toBe(true);
    expect(result.every((point) => point.y >= 0 && point.y <= 4096)).toBe(true);
    expect(result.some((point) => point.x === 0)).toBe(true);
    expect(result.some((point) => point.x === 4096)).toBe(true);
    expect(result.some((point) => point.y === 0)).toBe(true);
    expect(result.some((point) => point.y === 4096)).toBe(true);
  });

  it('丢弃完全位于相邻 Tile buffer 的三角形', () => {
    expect(
      clipTriangleToTileExtent(
        [
          { x: -80, y: 100 },
          { x: -20, y: 100 },
          { x: -20, y: 200 },
        ],
        4096,
      ),
    ).toEqual([]);
  });
});
