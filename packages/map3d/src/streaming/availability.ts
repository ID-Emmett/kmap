import { canonicalKey, parentOf } from './address.js';

/** 就绪资源的增量祖先索引，覆盖解析只查询已有树节点。 */
export class TileAvailability extends Set<string> {
  readonly ancestors = new Map<string, number>();
  /** 集合内容版本号；覆盖解析据此判定复用已计算的覆盖结果。 */
  revision = 0;
  override add(key: string): this {
    if (this.has(key)) return this;
    super.add(key); this.updateAncestors(key, 1); this.revision++; return this;
  }
  override delete(key: string): boolean {
    if (!super.delete(key)) return false;
    this.updateAncestors(key, -1); this.revision++; return true;
  }
  private updateAncestors(key: string, delta: number): void {
    const [z, x, y] = key.split('/').map(Number) as [number, number, number]; let address = { z, x, y };
    while (address.z > 0) {
      address = parentOf(address); const parent = canonicalKey(address); const count = (this.ancestors.get(parent) ?? 0) + delta;
      if (count) this.ancestors.set(parent, count); else this.ancestors.delete(parent);
    }
  }
  override clear(): void { super.clear(); this.ancestors.clear(); this.revision++; }
}
