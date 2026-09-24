import { describe, expect, it } from 'vitest';
import { Color, Scene } from 'three/webgpu';
import { TileStore } from '../src/streaming/tileStore.js';
import { TileSurfaces } from '../src/streaming/surface.js';

function fixture(maxEntries: number) {
  const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
  return { surfaces, store: new TileStore(surfaces, { maxTileEntries: maxEntries }, new Set()) };
}

describe('回访缓存与已解析空登记', () => {
  it('最近仍有需求的条目在保护窗口内不被淘汰，旧条目让位', () => {
    const { surfaces, store } = fixture(2);
    const now = performance.now();
    const recent = store.create({ z: 4, x: 0, y: 0 }, 'visible', 0, now)!;
    store.create({ z: 4, x: 1, y: 0 }, 'predicted', 1000, now - 60000);
    const created = store.create({ z: 4, x: 2, y: 0 }, 'visible', 0, now);
    expect(created).toBeDefined();
    expect(store.entries.has(recent.key)).toBe(true);
    expect(store.entries.has('4/1/0')).toBe(false);
    expect(store.evictions).toBe(1);
    store.dispose(); surfaces.dispose();
  });

  it('全部可淘汰条目都在保护窗口内时仍按兜底轮淘汰，保证新需求可准入', () => {
    const { surfaces, store } = fixture(1);
    const now = performance.now();
    store.create({ z: 4, x: 0, y: 0 }, 'predicted', 1000, now);
    const created = store.create({ z: 4, x: 1, y: 0 }, 'visible', 0, now);
    expect(created).toBeDefined();
    expect(store.entries.size).toBe(1);
    expect(store.entries.has('4/1/0')).toBe(true);
    expect(store.evictions).toBe(1);
    store.dispose(); surfaces.dispose();
  });

  it('条目淘汰后空登记保留供回退规划跳过，未解析区域仍为需要', () => {
    const { surfaces, store } = fixture(2);
    const entry = store.create({ z: 5, x: 1, y: 1 }, 'visible', 0, 0)!;
    store.markEmpty(entry);
    expect(entry.empty).toBe(true);
    expect(store.isEmpty({ z: 5, x: 1, y: 1 })).toBe(true);
    store.release(entry);
    expect(store.entries.size).toBe(0);
    expect(store.isEmpty({ z: 5, x: 1, y: 1 })).toBe(true);
    expect(store.isEmpty({ z: 5, x: 1, y: 2 })).toBe(false);
    // 归一化副本与规范键指向同一登记。
    expect(store.isEmpty({ z: 5, x: 1 + 2 ** 5, y: 1 })).toBe(true);
    store.dispose();
    expect(store.isEmpty({ z: 5, x: 1, y: 1 })).toBe(false);
    surfaces.dispose();
  });
});
