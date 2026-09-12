import type { VectorTileSource } from '../source/types.js';
import { lngLatToTilePosition } from './mercator.js';
import type { RenderTileKey } from './types.js';

/** 判断 canonical Tile 是否与重复到各 world 的 source bounds 相交。 */
export function tileIntersectsSourceBounds(
  key: RenderTileKey,
  bounds: VectorTileSource['bounds'],
): boolean {
  if (bounds === undefined) {
    return true;
  }

  const scale = 2 ** key.canonical.z;
  const northY = lngLatToTilePosition(
    { lng: 0, lat: bounds[3] },
    key.canonical.z,
  ).y;
  const southY = lngLatToTilePosition(
    { lng: 0, lat: bounds[1] },
    key.canonical.z,
  ).y;
  const tileMinY = key.canonical.y;
  const tileMaxY = tileMinY + 1;

  if (tileMaxY <= northY || tileMinY >= southY) {
    return false;
  }

  const longitudeSpan = getEastwardLongitudeSpan(bounds[0], bounds[2]);
  if (longitudeSpan >= 360) {
    return true;
  }

  if (longitudeSpan === 0) {
    return false;
  }

  const start = modulo(((bounds[0] + 180) / 360) * scale, scale);
  const end = start + (longitudeSpan / 360) * scale;
  const tileMinX = key.canonical.x;
  const tileMaxX = tileMinX + 1;

  return end <= scale
    ? intervalsOverlap(tileMinX, tileMaxX, start, end)
    : intervalsOverlap(tileMinX, tileMaxX, start, scale) ||
        intervalsOverlap(tileMinX, tileMaxX, 0, end - scale);
}

function getEastwardLongitudeSpan(west: number, east: number): number {
  const raw = east - west;
  if (Math.abs(raw) >= 360) {
    return 360;
  }
  return ((raw % 360) + 360) % 360;
}

function intervalsOverlap(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
): boolean {
  return leftMax > rightMin && leftMin < rightMax;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
