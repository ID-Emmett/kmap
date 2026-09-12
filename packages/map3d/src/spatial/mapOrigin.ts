import type { LngLat } from '../types.js';
import {
  getTileAnchorMeters,
  getTileSpanMeters,
  lngLatToTilePosition,
} from './mercator.js';
import type {
  MapOrigin,
  ScenePosition,
  TileLocalPoint,
} from './types.js';
import { requireTileIndex, requireTileZoom } from './validation.js';

/** 选择当前中心所在数据 Tile 的中心作为浮动原点。 */
export function selectMapOrigin(center: LngLat, zoom: number): MapOrigin {
  const z = requireTileZoom(zoom);
  const scale = 2 ** z;
  const tilePosition = lngLatToTilePosition(center, z);
  const tileX = Math.floor(tilePosition.x);
  const tileY = Math.min(scale - 1, Math.max(0, Math.floor(tilePosition.y)));
  const anchor = getTileAnchorMeters(tileX, tileY, z);
  const halfSpan = getTileSpanMeters(z) / 2;

  return {
    z,
    tileX,
    tileY,
    meters: {
      x: anchor.x + halfSpan,
      y: anchor.y - halfSpan,
    },
  };
}

/** 计算任意 zoom Tile 西北角锚点相对 MapOrigin 的场景位置。 */
export function getTileAnchorRelativeToOrigin(
  x: number,
  y: number,
  zoom: number,
  origin: MapOrigin,
): ScenePosition {
  const z = requireTileZoom(zoom);
  const tileX = requireTileIndex(x, 'x');
  const tileY = requireTileIndex(y, 'y');

  const anchor = getTileAnchorMeters(tileX, tileY, z);

  return {
    x: anchor.x - origin.meters.x,
    y: 0,
    z: origin.meters.y - anchor.y,
  };
}

/** 将 Tile 局部米坐标转换为相对 MapOrigin 的场景位置。 */
export function tileLocalPointToScenePosition(
  point: TileLocalPoint,
  anchor: ScenePosition,
): ScenePosition {
  return {
    x: anchor.x + point.x,
    y: anchor.y,
    z: anchor.z - point.y,
  };
}
