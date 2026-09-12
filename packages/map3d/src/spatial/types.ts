import type { CanonicalTileKey } from '../types.js';

/** CPU 侧 Web Mercator 米坐标，X 向东、Y 向北。 */
export interface MercatorPoint {
  x: number;
  y: number;
}

/** 指定层级下的连续 XYZ Tile 坐标。 */
export interface TilePosition {
  z: number;
  x: number;
  y: number;
}

/** MVT extent 坐标，X 向右、Y 向下。 */
export interface MvtPoint {
  x: number;
  y: number;
}

/** Tile 西北角锚点下的局部米坐标，X 向东、Y 向北。 */
export interface TileLocalPoint {
  x: number;
  y: number;
}

/** 同一 canonical Tile 在横向世界副本中的渲染标识。 */
export interface RenderTileKey {
  canonical: CanonicalTileKey;
  wrap: number;
}

/** 浮动原点，固定在当前数据 Tile 的中心。 */
export interface MapOrigin {
  z: number;
  tileX: number;
  tileY: number;
  meters: MercatorPoint;
}

/** Three.js Y-up 场景中的相对位置。 */
export interface ScenePosition {
  x: number;
  y: number;
  z: number;
}
