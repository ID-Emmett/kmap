import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Uint16BufferAttribute } from 'three/webgpu';
import { keyOf, type Address } from './address.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { MapOrigin } from '../spatial/types.js';

export const PATCH_RECTANGLE_BYTES = 4 * 8 * Float32Array.BYTES_PER_ELEMENT + 6 * Uint16Array.BYTES_PER_ELEMENT;

/** 网格所有权固定于一个来源实例，矩形缓冲按实际区域数量增长。 */
export class PatchGeometry extends BufferGeometry {
  private signature = ''; private capacity = 0;
  private cells: readonly Address[] = [];
  constructor(readonly curved = false) { super(); }
  get bytes(): number { return this.capacity * PATCH_RECTANGLE_BYTES; }
  update(source: Address, cells: readonly Address[]): void {
    if (this.curved && source.z < 6) cells = cells.flatMap(cell => {
      const divisions = 2 ** Math.max(0, 6 - cell.z), scale = divisions;
      return Array.from({ length: divisions ** 2 }, (_, i) => ({ z: cell.z + Math.log2(scale), x: cell.x * scale + i % scale, y: cell.y * scale + Math.floor(i / scale) }));
    });
    const signature = cells.map(keyOf).join('|'); if (signature === this.signature) return;
    this.signature = signature;
    this.cells = cells;
    if (cells.length > this.capacity) {
      this.dispose(); this.capacity = 2 ** Math.ceil(Math.log2(cells.length));
      this.setAttribute('position', new Float32BufferAttribute(this.capacity * 12, 3).setUsage(DynamicDrawUsage));
      this.setAttribute('uv', new Float32BufferAttribute(this.capacity * 8, 2).setUsage(DynamicDrawUsage));
      this.setAttribute('maskPosition', new Float32BufferAttribute(this.capacity * 12, 3).setUsage(DynamicDrawUsage));
      const indices = new Uint16Array(this.capacity * 6);
      for (let i = 0; i < this.capacity; i++) { const n = i * 4; indices.set([n, n + 1, n + 2, n + 1, n + 3, n + 2], i * 6); }
      this.setIndex(new Uint16BufferAttribute(indices, 1));
    }
    const position = this.getAttribute('position') as Float32BufferAttribute, uv = this.getAttribute('uv') as Float32BufferAttribute;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!, scale = 2 ** (source.z - cell.z);
      const u = cell.x * scale - source.x, v = cell.y * scale - source.y;
      position.array.set([u - .5, 0, v - .5, u - .5, 0, v + scale - .5, u + scale - .5, 0, v - .5, u + scale - .5, 0, v + scale - .5], i * 12);
      uv.array.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8);
    }
    position.needsUpdate = true; uv.needsUpdate = true; this.setDrawRange(0, cells.length * 6);
  }
  /** 公共角点从同一 XYZ 格网以双精度计算，再统一转为浮点；邻接瓦片共用逐位相同的边界坐标。 */
  updateWorld(origin: MapOrigin): void {
    const position = this.getAttribute('maskPosition') as Float32BufferAttribute;
    for (const [i, cell] of this.cells.entries()) {
      const span = WORLD / 2 ** cell.z;
      const left = cell.x * span - WORLD / 2 - origin.meters.x, right = (cell.x + 1) * span - WORLD / 2 - origin.meters.x;
      const top = cell.y * span - WORLD / 2 + origin.meters.y, bottom = (cell.y + 1) * span - WORLD / 2 + origin.meters.y;
      position.array.set([left, 0, top, left, 0, bottom, right, 0, top, right, 0, bottom], i * 12);
    }
    position.needsUpdate = true;
  }
}
