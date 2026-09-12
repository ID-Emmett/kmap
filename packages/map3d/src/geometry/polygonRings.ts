import type { DecodedMvtPoint } from '../mvt/types.js';

export type PolygonRings = readonly [
  outer: readonly DecodedMvtPoint[],
  ...holes: readonly DecodedMvtPoint[][],
];

/** 按 MVT winding 把连续 rings 组织为 outer + holes Polygon。 */
export function classifyPolygonRings(
  rings: readonly (readonly DecodedMvtPoint[])[],
): PolygonRings[] {
  const polygons: PolygonRings[] = [];
  let outerOrientation: boolean | undefined;
  let current: DecodedMvtPoint[][] | undefined;

  for (const rawRing of rings) {
    const ring = cleanRing(rawRing);

    if (ring === undefined) {
      continue;
    }

    const area = signedRingArea(ring);

    if (area === 0) {
      continue;
    }

    const orientation = area < 0;
    outerOrientation ??= orientation;

    if (orientation === outerOrientation) {
      if (current !== undefined) {
        polygons.push(current as unknown as PolygonRings);
      }
      current = [ring];
    } else if (current !== undefined) {
      current.push(ring);
    }
  }

  if (current !== undefined) {
    polygons.push(current as unknown as PolygonRings);
  }

  return polygons;
}

/** MVT tile 坐标中的有符号 ring 面积。 */
export function signedRingArea(
  ring: readonly DecodedMvtPoint[],
): number {
  let sum = 0;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const point = ring[index];
    const prior = ring[previous];

    if (point === undefined || prior === undefined) {
      continue;
    }

    sum += (prior.x - point.x) * (point.y + prior.y);
  }

  return sum;
}

function cleanRing(
  rawRing: readonly DecodedMvtPoint[],
): DecodedMvtPoint[] | undefined {
  const ring: DecodedMvtPoint[] = [];

  for (const point of rawRing) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return undefined;
    }

    const previous = ring.at(-1);

    if (previous?.x === point.x && previous.y === point.y) {
      continue;
    }

    ring.push(point);
  }

  const first = ring[0];
  const last = ring.at(-1);

  if (first !== undefined && last?.x === first.x && last.y === first.y) {
    ring.pop();
  }

  return ring.length >= 3 ? ring : undefined;
}
