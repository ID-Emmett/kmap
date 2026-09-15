import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';

/** XYZ 地址保留世界副本，网络地址按层级归一化。 */
export interface Address { z: number; x: number; y: number }
export const keyOf = (a: Address): string => `${a.z}/${a.x}/${a.y}`;
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
