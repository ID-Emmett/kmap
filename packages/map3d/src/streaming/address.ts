import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';

/** XYZ 地址只存在于单个世界范围内，x 位于 [0, 2^z)。 */
export interface Address {
  z: number; x: number; y: number;
  /** 记忆化键；只由 cachedKey 写入，地址字段不得原地修改。 */
  k?: string;
}
export const keyOf = (a: Address): string => `${a.z}/${a.x}/${a.y}`;
/** 重复查询同一地址时复用键字符串，避免热路径反复拼接。 */
export const cachedKey = (a: Address): string => (a.k ??= keyOf(a));
export const parentOf = (a: Address): Address => ({ z: a.z - 1, x: Math.floor(a.x / 2), y: Math.floor(a.y / 2) });
export function childrenOf(a: Address): Address[] {
  return [0, 1, 2, 3].map(i => ({ z: a.z + 1, x: a.x * 2 + i % 2, y: a.y * 2 + Math.floor(i / 2) }));
}
export function contains(a: Address, b: Address): boolean {
  const scale = 2 ** (b.z - a.z);
  return a.z <= b.z && Math.floor(b.x / scale) === a.x && Math.floor(b.y / scale) === a.y;
}
export function tileBounds(a: Address) {
  const span = WORLD / 2 ** a.z;
  return { west: a.x * span - WORLD / 2, north: WORLD / 2 - a.y * span, span };
}
export function requestUrl(a: Address, templates: readonly string[]): string {
  return templates[(a.x + a.y) % templates.length]!.replace('{z}', String(a.z)).replace('{x}', String(a.x)).replace('{y}', String(a.y));
}
