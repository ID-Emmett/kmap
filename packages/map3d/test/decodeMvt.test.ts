import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decodeMvt } from '../src/mvt/decodeMvt.js';
import { MvtDecodeError } from '../src/mvt/types.js';
import { createSyntheticMvt } from './helpers/mvtFixture.js';

interface FixtureMetadata {
  byteLength: number;
  sha256: string;
  expectedLayers: Record<string, number>;
}

const FIXTURE_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);
const METADATA_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.json',
  import.meta.url,
);

describe('decodeMvt', () => {
  it('解码固定真实 KYE fixture 并核对来源摘要', () => {
    const bytes = readFileSync(FIXTURE_URL);
    const metadata = JSON.parse(
      readFileSync(METADATA_URL, 'utf8'),
    ) as FixtureMetadata;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const tile = decodeMvt(bytes);

    expect(bytes.byteLength).toBe(metadata.byteLength);
    expect(hash).toBe(metadata.sha256);
    expect(
      Object.fromEntries(
        Object.entries(tile.layers).map(([name, layer]) => [
          name,
          layer.features.length,
        ]),
      ),
    ).toEqual(metadata.expectedLayers);

    for (const layer of Object.values(tile.layers)) {
      expect(layer.version).toBe(2);
      expect(layer.extent).toBe(4096);
    }

    expect(tile.layers.building?.features).toHaveLength(233);
    expect(
      tile.layers.building?.features.some(
        (feature) => feature.geometry.length > 1,
      ),
    ).toBe(true);
    expect(
      tile.layers.building?.features.every(
        (feature) => feature.id === undefined,
      ),
    ).toBe(true);
    expect(tile.layers.road?.features[0]?.type).toBe('line');
    expect(typeof tile.layers.building?.features[0]?.properties.height).toBe(
      'number',
    );
    expect(typeof tile.layers.building?.features[0]?.properties.name).toBe(
      'string',
    );
  });

  it('保留 Polygon 多 ring、Line 和 string/number/boolean 字段', () => {
    const tile = decodeMvt(createSyntheticMvt());
    const layer = tile.layers.synthetic;

    expect(layer).toBeDefined();
    expect(layer?.features[0]).toMatchObject({
      index: 0,
      type: 'polygon',
      properties: { name: 'polygon', height: 12, visible: true },
    });
    expect(layer?.features[0]?.geometry).toHaveLength(2);
    expect(layer?.features[0]?.id).toBeUndefined();
    expect(layer?.features[1]).toMatchObject({
      index: 1,
      type: 'line',
      properties: { name: 'line' },
    });
    expect(Object.getPrototypeOf(layer?.features[0]?.geometry[0]?.[0])).toBe(
      Object.prototype,
    );
  });

  it('区分损坏 PBF 和不支持的 MVT version', () => {
    const bytes = readFileSync(FIXTURE_URL);

    expect(() => decodeMvt(bytes.subarray(0, 64))).toThrow(MvtDecodeError);

    try {
      decodeMvt(createSyntheticMvt(1));
      expect.unreachable('应拒绝 MVT version 1');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'MvtDecodeError',
        kind: 'unsupported-version',
        code: 'DECODE_ERROR',
      });
    }
  });
});
