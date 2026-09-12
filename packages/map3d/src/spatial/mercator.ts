import type { LngLat } from '../types.js';
import type {
  MercatorPoint,
  MvtPoint,
  TileLocalPoint,
  TilePosition,
} from './types.js';
import {
  requireFiniteNumber,
  requireTileIndex,
  requireTileZoom,
} from './validation.js';

/** EPSG:3857 使用的球体半径，单位为 meter。 */
export const WEB_MERCATOR_RADIUS = 6_378_137;
export const WEB_MERCATOR_WORLD_SIZE =
  2 * Math.PI * WEB_MERCATOR_RADIUS;
export const WEB_MERCATOR_HALF_WORLD_SIZE = WEB_MERCATOR_WORLD_SIZE / 2;
export const WEB_MERCATOR_MAX_LATITUDE =
  (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

/** 将纬度限制到 Web Mercator 的有限投影范围。 */
export function clampMercatorLatitude(latitude: number): number {
  requireFiniteNumber(latitude, 'latitude');
  return Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
}

/** WGS84 经纬度转换为 Web Mercator 米坐标。 */
export function projectLngLat(lngLat: LngLat): MercatorPoint {
  const longitude = requireFiniteNumber(lngLat.lng, 'lng');
  const latitude = clampMercatorLatitude(lngLat.lat);
  const latitudeRadians = latitude * DEGREES_TO_RADIANS;

  return {
    x: WEB_MERCATOR_RADIUS * longitude * DEGREES_TO_RADIANS,
    y:
      WEB_MERCATOR_RADIUS *
      Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  };
}

/** Web Mercator 米坐标转换为 WGS84 经纬度。 */
export function unprojectMercator(point: MercatorPoint): LngLat {
  const x = requireFiniteNumber(point.x, 'x');
  const y = Math.min(
    WEB_MERCATOR_HALF_WORLD_SIZE,
    Math.max(
      -WEB_MERCATOR_HALF_WORLD_SIZE,
      requireFiniteNumber(point.y, 'y'),
    ),
  );

  return {
    lng: (x / WEB_MERCATOR_RADIUS) * RADIANS_TO_DEGREES,
    lat:
      Math.atan(Math.sinh(y / WEB_MERCATOR_RADIUS)) *
      RADIANS_TO_DEGREES,
  };
}

/** 经纬度转换为指定层级下的连续 XYZ Tile 坐标。 */
export function lngLatToTilePosition(
  lngLat: LngLat,
  zoom: number,
): TilePosition {
  const z = requireTileZoom(zoom);
  const scale = 2 ** z;
  const projected = projectLngLat(lngLat);

  return {
    z,
    x: ((projected.x + WEB_MERCATOR_HALF_WORLD_SIZE) / WEB_MERCATOR_WORLD_SIZE) * scale,
    y: ((WEB_MERCATOR_HALF_WORLD_SIZE - projected.y) / WEB_MERCATOR_WORLD_SIZE) * scale,
  };
}

/** 连续 XYZ Tile 坐标转换为经纬度。 */
export function tilePositionToLngLat(position: TilePosition): LngLat {
  const z = requireTileZoom(position.z);
  const x = requireFiniteNumber(position.x, 'x');
  const y = requireFiniteNumber(position.y, 'y');
  const scale = 2 ** z;

  return unprojectMercator({
    x: (x / scale) * WEB_MERCATOR_WORLD_SIZE - WEB_MERCATOR_HALF_WORLD_SIZE,
    y: WEB_MERCATOR_HALF_WORLD_SIZE - (y / scale) * WEB_MERCATOR_WORLD_SIZE,
  });
}

/** 返回指定层级单个 Tile 的 Web Mercator 边长。 */
export function getTileSpanMeters(zoom: number): number {
  return WEB_MERCATOR_WORLD_SIZE / 2 ** requireTileZoom(zoom);
}

/** 返回整数 XYZ Tile 西北角的 Web Mercator 米坐标。 */
export function getTileAnchorMeters(
  x: number,
  y: number,
  zoom: number,
): MercatorPoint {
  const z = requireTileZoom(zoom);
  const tileX = requireTileIndex(x, 'x');
  const tileY = requireTileIndex(y, 'y');
  const scale = 2 ** z;

  if (tileY < 0 || tileY >= scale) {
    throw new RangeError(`y 必须位于 0 到 ${scale - 1}。`);
  }

  const span = WEB_MERCATOR_WORLD_SIZE / scale;

  return {
    x: -WEB_MERCATOR_HALF_WORLD_SIZE + tileX * span,
    y: WEB_MERCATOR_HALF_WORLD_SIZE - tileY * span,
  };
}

/** MVT extent 坐标转换为 Tile 西北角下的局部米坐标。 */
export function mvtPointToTileLocalMeters(
  point: MvtPoint,
  zoom: number,
  extent: number,
): TileLocalPoint {
  const size = requireExtent(extent);
  const span = getTileSpanMeters(zoom);

  return {
    x: (requireFiniteNumber(point.x, 'x') / size) * span,
    y: -(requireFiniteNumber(point.y, 'y') / size) * span,
  };
}

/** Tile 局部米坐标转换为 MVT extent 坐标。 */
export function tileLocalMetersToMvtPoint(
  point: TileLocalPoint,
  zoom: number,
  extent: number,
): MvtPoint {
  const size = requireExtent(extent);
  const span = getTileSpanMeters(zoom);

  return {
    x: (requireFiniteNumber(point.x, 'x') / span) * size,
    y: -(requireFiniteNumber(point.y, 'y') / span) * size,
  };
}

function requireExtent(extent: number): number {
  if (!Number.isSafeInteger(extent) || extent <= 0) {
    throw new RangeError('extent 必须是正安全整数。');
  }

  return extent;
}
