import { describe, expect, it } from 'vitest';

import {
  getTileRequestUrl,
  hashCanonicalTileKey,
  normalizeVectorTileSourceOptions,
} from '../src/source/vectorTileSource.js';

const SOURCE_OPTIONS = {
  id: 'main',
  tiles: [
    'https://tiles0.example.test/{z}/{x}/{y}.pbf',
    'https://tiles1.example.test/{z}/{x}/{y}.pbf',
    'https://tiles2.example.test/{z}/{x}/{y}.pbf',
  ],
  minZoom: 0,
  maxZoom: 17,
} as const;

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;

describe('VectorTileSource', () => {
  it('校验并复制公共 source 配置', () => {
    const source = normalizeVectorTileSourceOptions({
      ...SOURCE_OPTIONS,
      bounds: [73, -10, 135, 54],
    });

    expect(source).toEqual({
      ...SOURCE_OPTIONS,
      bounds: [73, -10, 135, 54],
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.tiles)).toBe(true);
    expect(Object.isFrozen(source.bounds)).toBe(true);
  });

  it('拒绝缺失 XYZ 占位符、无效 zoom 和无效 bounds', () => {
    expect(() =>
      normalizeVectorTileSourceOptions({
        ...SOURCE_OPTIONS,
        tiles: ['https://example.test/{z}/{x}.pbf'],
      }),
    ).toThrow('缺少 {y}');
    expect(() =>
      normalizeVectorTileSourceOptions({
        ...SOURCE_OPTIONS,
        minZoom: 18,
      }),
    ).toThrow('minZoom 不能大于 maxZoom');
    expect(() =>
      normalizeVectorTileSourceOptions({
        ...SOURCE_OPTIONS,
        bounds: [73, -86, 135, 54],
      }),
    ).toThrow('Web Mercator 有效范围');
  });

  it('同一 canonical key 稳定选节点，重试按列表轮换', () => {
    const source = normalizeVectorTileSourceOptions(SOURCE_OPTIONS);
    const first = getTileRequestUrl(source, KEY, 0);
    const repeated = getTileRequestUrl(source, KEY, 0);
    const second = getTileRequestUrl(source, KEY, 1);
    const third = getTileRequestUrl(source, KEY, 2);

    expect(hashCanonicalTileKey(KEY)).toBe(hashCanonicalTileKey({ ...KEY }));
    expect(first).toEqual(repeated);
    expect(first.url).toContain('/15/26978/12416.pbf');
    expect(second.templateIndex).toBe(
      (first.templateIndex + 1) % source.tiles.length,
    );
    expect(third.templateIndex).toBe(
      (first.templateIndex + 2) % source.tiles.length,
    );
  });

  it('拒绝 source 不匹配或超出真实层级的请求 key', () => {
    const source = normalizeVectorTileSourceOptions(SOURCE_OPTIONS);

    expect(() =>
      getTileRequestUrl(source, { ...KEY, sourceId: 'other' }, 0),
    ).toThrow('不属于 source');
    expect(() =>
      getTileRequestUrl(source, { ...KEY, z: 18 }, 0),
    ).toThrow('超出 source zoom');
  });
});
