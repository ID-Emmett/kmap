import { canonicalKey, contains, keyOf, parentOf, type Address } from './address.js';
import { coveredFraction } from './coverage.js';
import type { CoverPatch } from './renderCover.js';

/** 缺口与超过两级的显示误差共享有界祖先请求，当前精细目标保留独立需求。 */
export function fallbackRequests(targets: readonly Address[], patches: readonly CoverPatch[], minZoom: number, limit: number,
  empty: (address: Address) => boolean, loading: (address: Address) => boolean = () => false): Address[] {
  const candidates = new Map<string, { address: Address; missing: boolean; order: number }>();
  for (const [order, target] of targets.entries()) {
    const covering = patches.filter(p => contains(target, p.cell));
    const missing = coveredFraction(target, covering.map(p => p.cell)) < .999999;
    const coarse = covering.some(p => target.z - p.source.z > 2);
    if (!missing && !coarse) continue;
    let address = target;
    for (let i = 0; i < (empty(target) ? 1 : 2) && address.z > minZoom; i++) address = parentOf(address);
    // 已进入下载或构建的祖先可以直接补足缺口，保持该工作的当前显示用途。
    if (missing) {
      let ancestor = target;
      while (ancestor.z > minZoom) {
        ancestor = parentOf(ancestor);
        if (loading(ancestor)) { address = ancestor; break; }
      }
    }
    while (empty(address) && address.z > minZoom) address = parentOf(address);
    if (keyOf(address) === keyOf(target) || empty(address)) continue;
    const key = canonicalKey(address), previous = candidates.get(key);
    if (!previous || (missing && !previous.missing)) candidates.set(key, { address, missing, order });
  }
  return [...candidates.values()].sort((a, b) => Number(b.missing) - Number(a.missing) || a.order - b.order)
    .slice(0, limit).map(c => c.address);
}
