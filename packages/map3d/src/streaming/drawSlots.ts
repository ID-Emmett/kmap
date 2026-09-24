import type { Mesh } from 'three/webgpu';

/**
 * 固定绘制槽位：mesh 与材质作为一个整体复用。
 *
 * Three 的 RenderObject 以 `(object, material, context, lights)` 为链键，绑定组按 RenderObject 创建一次；
 * 绑定组内的 uniform buffer 与 buffer 节点各自对应一个 GPUBuffer。因此只有让同一 mesh 与同一材质实例
 * 长期配对复用，绑定组与已分配的 GPUBuffer 才能跨瓦片保持恒定，而不是每块新瓦片重新创建。
 */
export class DrawSlotPool<U extends { mesh: Mesh }> {
  private readonly idle = new Map<string, U[]>();
  private disposed = false;
  /** 复用与新建次数：诊断用于确认稳态是否仍在创建新材质。 */
  reuses = 0; creates = 0;
  /** 每个布局键保留的空闲槽位上限；超出上限的槽位直接销毁，保证 GPU 侧对象有界。 */
  constructor(private readonly limitPerKey = 64, private readonly destroy: (unit: U) => void = () => {}) {}
  /** 空闲槽位总数。 */
  get idleCount(): number {
    let total = 0;
    for (const items of this.idle.values()) total += items.length;
    return total;
  }
  /** 取一个槽位；空闲池为空时新建。 */
  acquire(key: string, spawn: () => U): U {
    if (this.disposed) return spawn();
    const unit = this.idle.get(key)?.pop();
    if (unit !== undefined) { this.reuses++; return unit; }
    this.creates++;
    return spawn();
  }
  /** 归还槽位；超过上限时销毁，避免空闲槽位无限增长。 */
  release(key: string, unit: U): void {
    if (this.disposed) { this.destroy(unit); return; }
    let items = this.idle.get(key);
    if (items === undefined) { items = []; this.idle.set(key, items); }
    if (items.length >= this.limitPerKey) { this.destroy(unit); return; }
    items.push(unit);
  }
  dispose(): void {
    this.disposed = true;
    for (const items of this.idle.values()) for (const unit of items) this.destroy(unit);
    this.idle.clear();
  }
}
