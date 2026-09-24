import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';

/** XYZ 地址保留世界副本，网络地址按层级归一化。 */
export interface Address {
  z: number; x: number; y: number;
  /** 记忆化规范键；只由 cachedKey 写入，地址字段不得原地修改。 */
  k?: string;
}
export const keyOf = (a: Address): string => `${a.z}/${a.x}/${a.y}`;
export const canonical = (a: Address): Address => ({ z: a.z, x: ((a.x % 2 ** a.z) + 2 ** a.z) % 2 ** a.z, y: a.y });
export const canonicalKey = (a: Address): string => keyOf(canonical(a));
/** 重复查询同一地址时复用规范键，避免热路径反复拼接字符串。 */
export const cachedKey = (a: Address): string => (a.k ??= canonicalKey(a));
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
  const n = 2 ** a.z;
  const x = ((a.x % n) + n) % n;
  return templates[(x + a.y) % templates.length]!.replace('{z}', String(a.z)).replace('{x}', String(x)).replace('{y}', String(a.y));
}
