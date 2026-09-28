import type { RasterTileSourceOptions } from '../types.js';
import type { Address } from '../streaming/address.js';

/** 使用视图连续缩放与实际设备像素密度选择影像层级；最高有效层级限定可用细节。 */
export function rasterTargetZoom(zoom: number, pixelRatio: number, source: Pick<RasterTileSourceOptions, 'minZoom' | 'maxZoom'>): number {
  return Math.max(source.minZoom, Math.min(source.maxZoom, Math.ceil(zoom + Math.log2(Math.max(1, pixelRatio)))));
}

/** 子区域在祖先影像中的 UV；v 从图片顶部向下计量。 */
export function sourceRect(source: Address, cell: Address): { u0: number; v0: number; u1: number; v1: number } {
  const factor = 2 ** (cell.z - source.z);
  if (factor < 1 || Math.floor(cell.x / factor) !== source.x || Math.floor(cell.y / factor) !== source.y) {
    throw new RangeError('影像来源必须包含目标区域。');
  }
  const u0 = (cell.x - source.x * factor) / factor;
  const v0 = (cell.y - source.y * factor) / factor;
  return { u0, v0, u1: u0 + 1 / factor, v1: v0 + 1 / factor };
}

/** 哈希精确匹配供应商占位图片，避免把 HTTP 200 当作有效影像。 */
export async function isMissingRasterTile(bytes: ArrayBuffer, hashes: readonly string[] = []): Promise<boolean> {
  if (!hashes.length) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return hashes.some(hash => hash.toLowerCase() === actual);
}
