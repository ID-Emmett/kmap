import {
  WEB_MERCATOR_HALF_WORLD_SIZE,
  WEB_MERCATOR_WORLD_SIZE,
} from './mercator.js';

const RECT_EPSILON = 1e-9;

export interface TilePoint {
  x: number;
  y: number;
}

export function mercatorPointToTilePoint(
  point: Readonly<{ x: number; y: number }>,
  zoom: number,
): TilePoint {
  const scale = 2 ** zoom;
  return {
    x:
      ((point.x + WEB_MERCATOR_HALF_WORLD_SIZE) /
        WEB_MERCATOR_WORLD_SIZE) *
      scale,
    y:
      ((WEB_MERCATOR_HALF_WORLD_SIZE - point.y) /
        WEB_MERCATOR_WORLD_SIZE) *
      scale,
  };
}

export function getTilePolygonBounds(polygon: readonly TilePoint[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: Math.floor(Math.min(...polygon.map((point) => point.x))),
    maxX: Math.ceil(Math.max(...polygon.map((point) => point.x))) - 1,
    minY: Math.floor(Math.min(...polygon.map((point) => point.y))),
    maxY: Math.ceil(Math.max(...polygon.map((point) => point.y))) - 1,
  };
}

export function tileRectangleIntersectsPolygon(
  x: number,
  y: number,
  polygon: readonly TilePoint[],
): boolean {
  const corners = [
    { x, y },
    { x: x + 1, y },
    { x: x + 1, y: y + 1 },
    { x, y: y + 1 },
  ];

  if (
    polygon.some((point) => pointInsideRectangle(point, x, y)) ||
    corners.some((point) => pointInsidePolygon(point, polygon))
  ) {
    return true;
  }

  for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
    const polygonStart = polygon[polygonIndex];
    const polygonEnd = polygon[(polygonIndex + 1) % polygon.length];

    if (polygonStart === undefined || polygonEnd === undefined) {
      continue;
    }

    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const cornerStart = corners[cornerIndex];
      const cornerEnd = corners[(cornerIndex + 1) % corners.length];
      if (
        cornerStart !== undefined &&
        cornerEnd !== undefined &&
        segmentsIntersect(polygonStart, polygonEnd, cornerStart, cornerEnd)
      ) {
        return true;
      }
    }
  }

  return false;
}

function pointInsideRectangle(point: TilePoint, x: number, y: number): boolean {
  return (
    point.x >= x &&
    point.x <= x + 1 &&
    point.y >= y &&
    point.y <= y + 1
  );
}

function pointInsidePolygon(
  point: TilePoint,
  polygon: readonly TilePoint[],
): boolean {
  let inside = false;

  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const left = polygon[current];
    const right = polygon[previous];

    if (left === undefined || right === undefined) {
      continue;
    }

    const crosses =
      left.y > point.y !== right.y > point.y &&
      point.x <
        ((right.x - left.x) * (point.y - left.y)) /
          (right.y - left.y) +
          left.x;
    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

function segmentsIntersect(
  firstStart: TilePoint,
  firstEnd: TilePoint,
  secondStart: TilePoint,
  secondEnd: TilePoint,
): boolean {
  const a = orientation(firstStart, firstEnd, secondStart);
  const b = orientation(firstStart, firstEnd, secondEnd);
  const c = orientation(secondStart, secondEnd, firstStart);
  const d = orientation(secondStart, secondEnd, firstEnd);

  if (
    ((a > RECT_EPSILON && b < -RECT_EPSILON) ||
      (a < -RECT_EPSILON && b > RECT_EPSILON)) &&
    ((c > RECT_EPSILON && d < -RECT_EPSILON) ||
      (c < -RECT_EPSILON && d > RECT_EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(a) <= RECT_EPSILON && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(b) <= RECT_EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(c) <= RECT_EPSILON && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(d) <= RECT_EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function orientation(start: TilePoint, end: TilePoint, point: TilePoint): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function pointOnSegment(
  point: TilePoint,
  start: TilePoint,
  end: TilePoint,
): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - RECT_EPSILON &&
    point.x <= Math.max(start.x, end.x) + RECT_EPSILON &&
    point.y >= Math.min(start.y, end.y) - RECT_EPSILON &&
    point.y <= Math.max(start.y, end.y) + RECT_EPSILON
  );
}
