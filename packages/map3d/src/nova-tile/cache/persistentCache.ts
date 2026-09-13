import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';

export interface PersistentTileValue<Payload = unknown> {
  readonly key: CanonicalTileKey;
  readonly sourceRevision: string;
  readonly state: 'ready' | 'empty' | 'negative';
  readonly payload?: Payload;
  readonly bytes: number;
  readonly storedAt: number;
}

export interface PersistentTileStore<Payload = unknown> {
  get(key: CanonicalTileKey): Promise<PersistentTileValue<Payload> | undefined>;
  set(value: PersistentTileValue<Payload>): Promise<void>;
  delete(key: CanonicalTileKey): Promise<void>;
  clear(): Promise<void>;
}

/** 可测试、无 DOM 依赖的持久化替身；浏览器适配器可实现同一接口接入 IndexedDB。 */
export class MemoryPersistentTileStore<Payload = unknown> implements PersistentTileStore<Payload> {
  readonly #values = new Map<string, PersistentTileValue<Payload>>();
  async get(key: CanonicalTileKey): Promise<PersistentTileValue<Payload> | undefined> { return this.#values.get(canonicalTileKeyToString(key)); }
  async set(value: PersistentTileValue<Payload>): Promise<void> { this.#values.set(canonicalTileKeyToString(value.key), Object.freeze({ ...value })); }
  async delete(key: CanonicalTileKey): Promise<void> { this.#values.delete(canonicalTileKeyToString(key)); }
  async clear(): Promise<void> { this.#values.clear(); }
  get size(): number { return this.#values.size; }
}

/** 对持久化层做 source revision 校验，防止旧数据命中当前 Source。 */
export class PersistentTileCache<Payload = unknown> {
  readonly #store: PersistentTileStore<Payload>;
  constructor(store: PersistentTileStore<Payload>) { this.#store = store; }
  async read(key: CanonicalTileKey): Promise<PersistentTileValue<Payload> | undefined> {
    const value = await this.#store.get(key);
    return value?.sourceRevision === key.sourceRevision ? value : undefined;
  }
  write(value: PersistentTileValue<Payload>): Promise<void> { return this.#store.set(value); }
  remove(key: CanonicalTileKey): Promise<void> { return this.#store.delete(key); }
  clear(): Promise<void> { return this.#store.clear(); }
}
