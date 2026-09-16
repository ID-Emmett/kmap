export interface LabelBox { left: number; top: number; right: number; bottom: number }
export const overlaps = (a: LabelBox, b: LabelBox): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** 屏幕网格降低碰撞查询成本；每次布局只处理有界候选集合。 */
export class CollisionGrid {
  private readonly cells = new Map<string, LabelBox[]>();
  constructor(readonly cellSize = 64) {}
  private keys(box: LabelBox): string[] {
    const keys: string[] = [];
    for (let y = Math.floor(box.top / this.cellSize); y <= Math.floor(box.bottom / this.cellSize); y++)
      for (let x = Math.floor(box.left / this.cellSize); x <= Math.floor(box.right / this.cellSize); x++) keys.push(`${x}:${y}`);
    return keys;
  }
  collides(box: LabelBox): boolean { return this.keys(box).some(key => this.cells.get(key)?.some(other => overlaps(box, other))); }
  insert(box: LabelBox): void { for (const key of this.keys(box)) { const cell = this.cells.get(key) ?? []; cell.push(box); this.cells.set(key, cell); } }
}
