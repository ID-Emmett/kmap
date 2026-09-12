import { describe, expect, it } from 'vitest';

import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
import { tilePositionToLngLat } from '../src/spatial/mercator.js';
import { calculateTileCoverage } from '../src/spatial/tileCoverage.js';
import { renderTileKeyToString } from '../src/spatial/tileKey.js';

const SOURCE = normalizeVectorTileSourceOptions({
  id: 'main',
  tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  minZoom: 0,
  maxZoom: 17,
});

describe('Tile coverage', () => {
  it('pitch/bearing 下覆盖有限地面且不生成越界 Y', () => {
    const coverage = calculateTileCoverage(
      {
        center: { lng: 116.4, lat: 39.9 },
        zoom: 12.4,
        bearing: 37,
        pitch: 60,
      },
      { width: 1280, height: 720 },
      SOURCE,
    );
    const scale = 2 ** coverage.referenceZoom;

    expect(coverage.visible.length).toBeGreaterThan(0);
    expect(coverage.tiles.length).toBeLessThanOrEqual(128);
    expect(coverage.footprint.flatMap((point) => [point.x, point.y]).every(Number.isFinite)).toBe(true);
    expect(
      coverage.tiles.every(
        (entry) =>
          entry.key.canonical.y >= 0 && entry.key.canonical.y < scale,
      ),
    ).toBe(true);
  });

  it('低 zoom 跨日期线保留不同 wrap 并共享 canonical key', () => {
    const coverage = calculateTileCoverage(
      {
        center: { lng: 179.9, lat: 0 },
        zoom: 0,
        bearing: 0,
        pitch: 0,
      },
      { width: 800, height: 256 },
      SOURCE,
      { maxTiles: 32 },
    );
    const canonicalGroups = new Map<string, Set<number>>();

    for (const entry of coverage.tiles) {
      const canonical = `${entry.key.canonical.z}/${entry.key.canonical.x}/${entry.key.canonical.y}`;
      const wraps = canonicalGroups.get(canonical) ?? new Set<number>();
      wraps.add(entry.key.wrap);
      canonicalGroups.set(canonical, wraps);
    }

    expect(
      [...canonicalGroups.values()].some((wraps) => wraps.size > 1),
    ).toBe(true);

    const bounded = normalizeVectorTileSourceOptions({
      id: 'dateline',
      tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
      minZoom: 0,
      maxZoom: 4,
      bounds: [170, -20, -170, 20],
    });
    const boundedCoverage = calculateTileCoverage(
      {
        center: { lng: 179.9, lat: 0 },
        zoom: 2,
        bearing: 0,
        pitch: 0,
      },
      { width: 512, height: 256 },
      bounded,
    );
    expect(boundedCoverage.visible.length).toBeGreaterThan(0);

    const shiftedBounds = normalizeVectorTileSourceOptions({
      id: 'shifted-dateline',
      tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
      minZoom: 0,
      maxZoom: 4,
      bounds: [890, -20, 910, 20],
    });
    const shiftedCoverage = calculateTileCoverage(
      {
        center: { lng: 899.9, lat: 0 },
        zoom: 2,
        bearing: 0,
        pitch: 0,
      },
      { width: 512, height: 256 },
      shiftedBounds,
    );
    expect(shiftedCoverage.visible.length).toBeGreaterThan(0);
  });

  it('source zoom/bounds、prefetch、上限和优先级均确定', () => {
    const bounded = normalizeVectorTileSourceOptions({
      id: 'bounded',
      tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
      minZoom: 5,
      maxZoom: 10,
      bounds: [73, 3, 135, 54],
    });
    const outside = calculateTileCoverage(
      {
        center: { lng: 0, lat: 0 },
        zoom: 2,
        bearing: 0,
        pitch: 0,
      },
      { width: 256, height: 256 },
      bounded,
    );
    expect(outside.referenceZoom).toBe(5);
    expect(outside.tiles).toHaveLength(0);

    const center = tilePositionToLngLat({
      z: 17,
      x: 107914.5,
      y: 49666.5,
    });
    const full = calculateTileCoverage(
      { center, zoom: 20, bearing: 0, pitch: 0 },
      { width: 256, height: 256 },
      SOURCE,
      { maxTiles: 9 },
    );
    const limited = calculateTileCoverage(
      { center, zoom: 20, bearing: 0, pitch: 0 },
      { width: 256, height: 256 },
      SOURCE,
      { maxTiles: 4 },
    );

    expect(full.referenceZoom).toBe(17);
    expect(full.visible).toHaveLength(1);
    expect(full.prefetch).toHaveLength(8);
    expect(full.tiles).toHaveLength(9);
    expect(full.tiles[0]?.kind).toBe('visible');
    expect(full.tiles[0]?.priority.screenDistance).toBeLessThanOrEqual(
      full.tiles.at(-1)?.priority.screenDistance ?? Number.POSITIVE_INFINITY,
    );
    expect(limited.tiles).toHaveLength(4);
    expect(limited.truncated).toBe(true);
    expect(limited.tiles.map((entry) => renderTileKeyToString(entry.key))).toEqual(
      full.tiles
        .slice(0, 4)
        .map((entry) => renderTileKeyToString(entry.key)),
    );
  });
});
