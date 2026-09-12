import type { CanonicalTileKey } from '../types.js';
import type { RenderTileKey } from './types.js';
import {
  requireFiniteNumber,
  requireTileIndex,
  requireTileZoom,
} from './validation.js';

/** 将任意整数 X 归一化到 canonical X，并保留 world wrap。 */
export function wrapTileX(
  x: number,
  zoom: number,
): { x: number; wrap: number } {
  const tileX = requireTileIndex(x, 'x');
  const scale = 2 ** requireTileZoom(zoom);
  const wrap = Math.floor(tileX / scale);

  return {
    x: tileX - wrap * scale,
    wrap,
  };
}

/** 从可能跨 world wrap 的 XYZ 坐标创建渲染 TileKey。 */
export function createRenderTileKey(
  sourceId: string,
  zoom: number,
  x: number,
  y: number,
): RenderTileKey | undefined {
  const z = requireTileZoom(zoom);
  const tileY = requireTileIndex(y, 'y');
  const scale = 2 ** z;

  if (tileY < 0 || tileY >= scale) {
    return undefined;
  }

  const wrapped = wrapTileX(x, z);

  return {
    canonical: {
      sourceId: requireSourceId(sourceId),
      z,
      x: wrapped.x,
      y: tileY,
    },
    wrap: wrapped.wrap,
  };
}

/** 从可能跨 world wrap 的 XYZ 坐标创建 canonical TileKey。 */
export function createCanonicalTileKey(
  sourceId: string,
  zoom: number,
  x: number,
  y: number,
): CanonicalTileKey | undefined {
  return createRenderTileKey(sourceId, zoom, x, y)?.canonical;
}

/** 将连续 view zoom 收敛为数据源真实存在的整数层级。 */
export function resolveDataZoom(
  viewZoom: number,
  minZoom: number,
  maxZoom: number,
): number {
  const normalizedViewZoom = Math.floor(
    requireFiniteNumber(viewZoom, 'viewZoom'),
  );
  const sourceMinZoom = requireTileZoom(minZoom, 'minZoom');
  const sourceMaxZoom = requireTileZoom(maxZoom, 'maxZoom');

  if (sourceMinZoom > sourceMaxZoom) {
    throw new RangeError('minZoom 不能大于 maxZoom。');
  }

  return Math.min(
    sourceMaxZoom,
    Math.max(sourceMinZoom, normalizedViewZoom),
  );
}

/** 将高于 source maxZoom 的 TileKey 映射到实际请求父 Tile。 */
export function overzoomCanonicalTileKey(
  sourceId: string,
  zoom: number,
  x: number,
  y: number,
  maxZoom: number,
): CanonicalTileKey | undefined {
  const requestedZoom = requireTileZoom(zoom);
  const sourceMaxZoom = requireTileZoom(maxZoom, 'maxZoom');
  const requestedX = requireTileIndex(x, 'x');
  const requestedY = requireTileIndex(y, 'y');

  if (requestedZoom <= sourceMaxZoom) {
    return createCanonicalTileKey(
      sourceId,
      requestedZoom,
      requestedX,
      requestedY,
    );
  }

  const scale = 2 ** (requestedZoom - sourceMaxZoom);

  return createCanonicalTileKey(
    sourceId,
    sourceMaxZoom,
    Math.floor(requestedX / scale),
    Math.floor(requestedY / scale),
  );
}

/** CanonicalTileKey 的稳定缓存键。 */
export function canonicalTileKeyToString(key: CanonicalTileKey): string {
  const normalized = createCanonicalTileKey(
    key.sourceId,
    key.z,
    key.x,
    key.y,
  );

  if (normalized === undefined || normalized.x !== key.x) {
    throw new RangeError('CanonicalTileKey 必须已归一化。');
  }

  return `${normalized.sourceId}/${normalized.z}/${normalized.x}/${normalized.y}`;
}

/** RenderTileKey 的稳定实例键。 */
export function renderTileKeyToString(key: RenderTileKey): string {
  if (!Number.isSafeInteger(key.wrap)) {
    throw new RangeError('wrap 必须是安全整数。');
  }

  return `${canonicalTileKeyToString(key.canonical)}@${key.wrap}`;
}

function requireSourceId(sourceId: string): string {
  if (sourceId.length === 0) {
    throw new RangeError('sourceId 不能为空。');
  }

  return sourceId;
}
