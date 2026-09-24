import { BufferAttribute, BufferGeometry, InstancedBufferAttribute } from 'three/webgpu';

type NumericArray = { length: number; constructor: unknown; set(source: never): void };

/** 容量按 2 的幂分档，避免每个瓦片重建属性与 GPU 缓冲。 */
function capacityFor(needed: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, needed)));
}

/**
 * 几何分档：只有容量档位相同（或更大）的几何才能承接新瓦片数据。
 * 档位不匹配会让 `writeAttribute` 重新分配数组，进而创建新的 GPUBuffer，
 * 因此复用前必须按档位取几何，而不是取池中任意几何。
 */
export function capacityTier(count: number): number {
  return 2 ** Math.min(22, Math.ceil(Math.log2(Math.max(1, count))));
}

/**
 * 就地写入顶点属性；容量不足或类型变化时才按档位重建属性。
 * `capacity` 给出档位容量（元素数）：同档位内的几何一次分配到档位容量后，后续瓦片不再重建属性与 GPUBuffer。
 */
export function writeAttribute(geometry: BufferGeometry, name: string, source: ArrayBufferView, itemSize: number, instanced = false, capacity?: number): void {
  const existing = geometry.getAttribute(name) as BufferAttribute | undefined;
  const values = source as unknown as NumericArray;
  const needed = values.length;
  const sized = Math.max(capacityFor(needed), capacity ?? 0, itemSize);
  if (existing === undefined) {
    if (sized > needed) {
      // 档位容量大于当前数据时按档位分配并复制，保证同档位后续瓦片可就地写入。
      const array = new (values.constructor as new (length: number) => Float32Array)(sized);
      (array as unknown as NumericArray).set(source as never);
      const attribute = instanced ? new InstancedBufferAttribute(array, itemSize) : new BufferAttribute(array, itemSize);
      setCount(attribute, needed / itemSize); attribute.needsUpdate = true;
      geometry.setAttribute(name, attribute);
      return;
    }
    // 容量刚好匹配时直接接管 Worker 转移过来的数组，避免复制。
    const attribute = instanced ? new InstancedBufferAttribute(source as Float32Array, itemSize) : new BufferAttribute(source as Float32Array, itemSize);
    geometry.setAttribute(name, attribute);
    attribute.needsUpdate = true;
    return;
  }
  if (existing.itemSize !== itemSize || existing.array.length < needed || existing.array.constructor !== values.constructor) {
    geometryPoolStats.reallocs++;
    const array = new (values.constructor as new (length: number) => Float32Array)(sized);
    (array as unknown as NumericArray).set(source as never);
    const attribute = instanced ? new InstancedBufferAttribute(array, itemSize) : new BufferAttribute(array, itemSize);
    setCount(attribute, needed / itemSize);
    geometry.setAttribute(name, attribute);
    attribute.needsUpdate = true;
    return;
  }

  (existing.array as unknown as NumericArray).set(source as never);
  setCount(existing, needed / itemSize);
  existing.clearUpdateRanges();
  existing.addUpdateRange(0, needed);
  existing.needsUpdate = true;
}

/** three 在绘制时读取 count，容量只增不减，因此使用数量与容量解耦。 */
function setCount(attribute: BufferAttribute, count: number): void {
  (attribute as unknown as { count: number }).count = count;
}

/** 就地写入索引；绘制数量由实际索引数量决定，容量只增不减。 */
export function writeIndex(geometry: BufferGeometry, source: ArrayBufferView, capacity?: number): void {
  const existing = geometry.getIndex();
  const values = source as unknown as NumericArray;
  const needed = values.length;
  const sized = Math.max(capacityFor(needed), capacity ?? 0);
  if (existing === null && sized <= needed) {
    geometry.setIndex(new BufferAttribute(source as Uint32Array, 1));
    return;
  }
  if (existing === null || existing.array.length < needed || existing.array.constructor !== values.constructor) {
    const array = new (values.constructor as new (length: number) => Float32Array)(sized);
    (array as unknown as NumericArray).set(source as never);
    const attribute = new BufferAttribute(array, 1); setCount(attribute, needed);
    geometry.setIndex(attribute);
    attribute.needsUpdate = true;
    return;
  }

  (existing.array as unknown as NumericArray).set(source as never);
  setCount(existing, needed);
  existing.clearUpdateRanges();
  existing.addUpdateRange(0, needed);
  existing.needsUpdate = true;
}

/** 几何容量档位：入池与取用都按该档位匹配，避免跨档重建属性与 GPUBuffer。 */
export function poolTierOf(geometry: BufferGeometry): number {
  return (geometry.userData.poolTier as number | undefined) ?? 1;
}

/** 几何池诊断：稳态下新建与重建计数应收敛，复用计数持续增长。 */
export const geometryPoolStats = { creates: 0, reuses: 0, reallocs: 0, disposes: 0, releases: 0, misses: 0 };

/** 同一几何可被父来源的多个绘制实例共享；引用计数为零才回到池中。 */
const references = new WeakMap<BufferGeometry, number>();

/** 新建几何登记一次引用；池中取出的几何在 acquire 时已登记。 */
export function registerGeometry(geometry: BufferGeometry): void {
  references.set(geometry, 1); geometryPoolStats.creates++;
}

/** 共享给绘制实例时递增引用计数。 */
export function retainGeometry(geometry: BufferGeometry): void {
  references.set(geometry, (references.get(geometry) ?? 1) + 1);
}

/** 释放一次引用；仍有绘制实例持有该几何时保留 GPU 缓冲。 */
export function releaseGeometry(pool: GeometryPool, layout: string, geometry: BufferGeometry): void {
  const remaining = (references.get(geometry) ?? 1) - 1;
  if (remaining > 0) { references.set(geometry, remaining); return; }
  references.delete(geometry);
  pool.release(layout, geometry);
}

/** 按布局键复用 GPU 几何：释放保留缓冲，重新获取后只写入实际使用范围。 */
export class GeometryPool {
  private readonly idle = new Map<string, BufferGeometry[]>();
  private disposed = false;
  #bytes = 0;
  constructor(private readonly limitPerKey = 192, private readonly maxBytes = 128 * 1048576) {}
  /**
   * 取一个容量不低于档位的几何：优先同档位，其次更高档位。
   * 容量更大的几何可就地承接更少的数据，属性数组与 GPUBuffer 都不重建，
   * 因此按容量向上匹配比精确档位匹配更能保持缓冲恒定。
   */
  acquire(layout: string, tier: number): BufferGeometry | undefined {
    for (let level = tier; level <= tier * 4; level *= 2) {
      const geometry = this.idle.get(`${layout}:${level}`)?.pop();
      if (geometry === undefined) continue;
      references.set(geometry, 1); geometryPoolStats.reuses++;
      this.#bytes -= geometryBytes(geometry);
      return geometry;
    }
    geometryPoolStats.misses++;
    return undefined;
  }
  /** 归还几何：按几何自身容量档位入池，供同档位与更低档位的瓦片复用。 */
  release(layout: string, geometry: BufferGeometry): void {
    geometryPoolStats.releases++;
    const bytes = geometryBytes(geometry);
    if (this.disposed || this.#bytes + bytes > this.maxBytes) { geometry.dispose(); geometryPoolStats.disposes++; return; }
    const key = `${layout}:${poolTierOf(geometry)}`;
    let items = this.idle.get(key);
    if (items === undefined) { items = []; this.idle.set(key, items); }
    if (items.length >= this.limitPerKey) { geometry.dispose(); geometryPoolStats.disposes++; return; }
    items.push(geometry); this.#bytes += bytes;
  }
  /** 池内几何数量；诊断用于确认复用是否生效。 */
  get size(): number {
    let total = 0;
    for (const items of this.idle.values()) total += items.length;
    return total;
  }
  /** 池内几何占用的缓冲字节；池有独立字节上限，不参与瓦片准入预算。 */
  get bytes(): number { return this.#bytes; }
  dispose(): void {
    this.disposed = true;
    for (const items of this.idle.values()) for (const geometry of items) geometry.dispose();
    this.idle.clear(); this.#bytes = 0;
  }
}

/** 顶点属性与索引的字节合计；与 patchGeometry 的容量口径一致。 */
function geometryBytes(geometry: BufferGeometry): number {
  // 同一个 GPUBuffer 可被多个属性视图引用（交错缓冲、共享四边形）：按底层缓冲去重。
  // 重复计数会让池提前判定超预算，进而销毁仍在绘制中的几何。
  let total = 0; const seen = new Set<object>();
  for (const attribute of Object.values(geometry.attributes)) {
    const buffer = ((attribute as unknown as { data?: object }).data ?? attribute) as unknown as { array: { byteLength: number } };
    if (seen.has(buffer)) continue; seen.add(buffer); total += buffer.array.byteLength;
  }
  const index = geometry.getIndex() as unknown as { array: { byteLength: number } } | null;
  if (index !== null && !seen.has(index)) total += index.array.byteLength;
  return total;
}
