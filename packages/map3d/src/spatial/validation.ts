/** JavaScript 安全整数可以精确表示的最高 XYZ 层级。 */
export const MAX_SAFE_TILE_ZOOM = 52;

/** 验证有限数值并返回原值。 */
export function requireFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} 必须是有限数值。`);
  }

  return value;
}

/** 验证 XYZ 层级并返回原值。 */
export function requireTileZoom(value: number, name = 'zoom'): number {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_SAFE_TILE_ZOOM
  ) {
    throw new RangeError(
      `${name} 必须是 0 到 ${MAX_SAFE_TILE_ZOOM} 之间的整数。`,
    );
  }

  return value;
}

/** 验证整数 Tile 坐标并返回原值。 */
export function requireTileIndex(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} 必须是安全整数。`);
  }

  return value;
}
