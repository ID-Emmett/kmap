import { TileAvailability } from './availability.js';
import { canonicalKey, childrenOf, contains, keyOf, parentOf, type Address } from './address.js';

export interface CoverPatch { cell: Address; source: Address; key: string }
export interface RenderCover { patches: CoverPatch[]; missing: number; uncovered: number; maxGap: number }

/** 可用目标、已加载子级和最近祖先组成互斥区域，数据就绪后在帧边界直接接替。 */
export function resolveRenderCover(targets: readonly Address[], ready: ReadonlySet<string>, minZoom: number, visible: (cell: Address) => boolean = () => true): RenderCover {
  const result: RenderCover = { patches: [], missing: 0, uncovered: 0, maxGap: 0 };
  const descendants = ready instanceof TileAvailability ? ready.ancestors : new Map<string, number>();
  if (!(ready instanceof TileAvailability)) for (const key of ready) {
    const [z, x, y] = key.split('/').map(Number) as [number, number, number];
    let a = { z, x, y };
    while (a.z > minZoom) { a = parentOf(a); descendants.set(canonicalKey(a), 1); }
  }
  const visit = (cell: Address, inherited: Address | undefined): void => {
    if (!visible(cell)) return;
    const key = canonicalKey(cell);
    if (ready.has(key)) { result.patches.push({ cell, source: cell, key }); return; }
    // 增量索引将遍历限制在已驻留资源的祖先路径，快速缩小可继续使用任意深度的已有内容。
    if (descendants.has(key)) {
      for (const child of childrenOf(cell)) visit(child, inherited);
    } else if (inherited) result.patches.push({ cell, source: inherited, key: canonicalKey(inherited) });
    else result.uncovered++;
  };
  for (const target of targets) {
    if (!ready.has(canonicalKey(target))) result.missing++;
    let parent = target; let fallback: Address | undefined;
    while (parent.z > minZoom) {
      parent = parentOf(parent);
      if (ready.has(canonicalKey(parent))) { fallback = parent; break; }
    }
    const offset = result.patches.length; visit(target, fallback);
    for (let i = offset; i < result.patches.length; i++) result.maxGap = Math.max(result.maxGap, target.z - result.patches[i]!.source.z);
  }
  return result;
}
export function coverSources(patches: readonly CoverPatch[]) {
  const sources = new Map<string, { address: Address; key: string; cells: Address[] }>();
  for (const patch of patches) {
    const id = keyOf(patch.source); const item = sources.get(id) ?? { address: patch.source, key: patch.key, cells: [] };
    item.cells.push(patch.cell); sources.set(id, item);
  }
  return [...sources.values()];
}
export function patchAt(patches: readonly CoverPatch[], point: Address): CoverPatch | undefined {
  return patches.find(p => contains(p.cell, point));
}
