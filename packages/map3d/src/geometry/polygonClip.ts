import type { DecodedMvtPoint } from '../mvt/types.js';

type Boundary = 'left' | 'right' | 'top' | 'bottom';

/** 将单个三角形裁到 Tile 核心 extent，消除相邻 Tile buffer 重叠。 */
export function clipTriangleToTileExtent(
  triangle: readonly [DecodedMvtPoint, DecodedMvtPoint, DecodedMvtPoint],
  extent: number,
): readonly DecodedMvtPoint[] {
  let polygon: readonly DecodedMvtPoint[] = triangle;

  for (const boundary of ['left', 'right', 'top', 'bottom'] as const) {
    polygon = clipAgainstBoundary(polygon, boundary, extent);
    if (polygon.length < 3) {
      return Object.freeze([]);
    }
  }

  return Object.freeze(removeConsecutiveDuplicates(polygon));
}

function clipAgainstBoundary(
  polygon: readonly DecodedMvtPoint[],
  boundary: Boundary,
  extent: number,
): readonly DecodedMvtPoint[] {
  const output: DecodedMvtPoint[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const currentInside = isInside(current, boundary, extent);
    const previousInside = isInside(previous, boundary, extent);

    if (currentInside !== previousInside) {
      output.push(intersectBoundary(previous, current, boundary, extent));
    }
    if (currentInside) {
      output.push(current);
    }
  }

  return output;
}

function isInside(
  point: DecodedMvtPoint,
  boundary: Boundary,
  extent: number,
): boolean {
  switch (boundary) {
    case 'left':
      return point.x >= 0;
    case 'right':
      return point.x <= extent;
    case 'top':
      return point.y >= 0;
    case 'bottom':
      return point.y <= extent;
  }
}

function intersectBoundary(
  start: DecodedMvtPoint,
  end: DecodedMvtPoint,
  boundary: Boundary,
  extent: number,
): DecodedMvtPoint {
  if (boundary === 'left' || boundary === 'right') {
    const x = boundary === 'left' ? 0 : extent;
    const ratio = (x - start.x) / (end.x - start.x);
    return { x, y: start.y + (end.y - start.y) * ratio };
  }

  const y = boundary === 'top' ? 0 : extent;
  const ratio = (y - start.y) / (end.y - start.y);
  return { x: start.x + (end.x - start.x) * ratio, y };
}

function removeConsecutiveDuplicates(
  polygon: readonly DecodedMvtPoint[],
): DecodedMvtPoint[] {
  const result: DecodedMvtPoint[] = [];

  for (const point of polygon) {
    const previous = result.at(-1);
    if (previous?.x !== point.x || previous.y !== point.y) {
      result.push(point);
    }
  }

  const first = result[0];
  const last = result.at(-1);
  if (
    result.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    result.pop();
  }

  return result;
}
