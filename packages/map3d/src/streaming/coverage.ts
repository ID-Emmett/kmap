import { contains, type Address } from './address.js';

/** 祖先互斥化后计算真实地理覆盖面积，嵌套瓦片的重叠区域计数一次。 */
export function coveredFraction(target: Address, addresses: readonly Address[]): number {
  const roots: Address[] = [];
  for (const address of [...addresses].sort((a, b) => a.z - b.z)) {
    if (!contains(target, address) || roots.some(root => contains(root, address))) continue;
    roots.push(address);
  }
  return roots.reduce((area, address) => area + 4 ** (target.z - address.z), 0);
}
