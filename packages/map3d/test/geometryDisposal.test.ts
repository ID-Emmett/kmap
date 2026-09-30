import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, type WebGPURenderer } from 'three/webgpu';
import { installGeometryDisposalGuard } from '../src/rendering/geometryDisposal.js';

function harness() {
  const deleted = vi.fn();
  const registry = {
    _geometryDisposeListeners: new Map<BufferGeometry, () => void>(),
    initialized: new Set<BufferGeometry>(),
    delete(geometry: BufferGeometry) { this.initialized.delete(geometry); },
    initGeometry(owner: { geometry: BufferGeometry; getAttributes(): Float32BufferAttribute[] }) {
      const geometry = owner.geometry;
      this.initialized.add(geometry);
      const dispose = () => {
        owner.getAttributes().forEach(attribute => deleted(attribute));
        geometry.removeEventListener('dispose', dispose);
        this._geometryDisposeListeners.delete(geometry);
      };
      geometry.addEventListener('dispose', dispose);
      this._geometryDisposeListeners.set(geometry, dispose);
    },
  };
  const renderer = { _geometries: registry } as unknown as WebGPURenderer;
  installGeometryDisposalGuard(renderer);
  return { registry, renderer, deleted };
}

describe('固定绘制槽位的几何释放所有权', () => {
  it('旧几何释放只销毁初始化时的属性，当前槽位的属性保持有效', () => {
    const { registry, deleted } = harness();
    const first = new BufferGeometry(), second = new BufferGeometry();
    const firstAttribute = new Float32BufferAttribute([1, 0, 0], 3);
    const secondAttribute = new Float32BufferAttribute([0, 1, 0], 3);
    const owner = { geometry: first, attributes: [firstAttribute], getAttributes() { return this.attributes; } };
    registry.initGeometry(owner);
    owner.geometry = second; owner.attributes = [secondAttribute];
    registry.initGeometry(owner);
    first.dispose();
    expect(deleted.mock.calls.map(([attribute]) => attribute)).toEqual([firstAttribute]);
    expect(registry.initialized.has(second)).toBe(true);
    second.dispose();
    expect(deleted.mock.calls.map(([attribute]) => attribute)).toEqual([firstAttribute, secondAttribute]);
  });

  it('释放后同一几何可重新初始化，监听与登记均完整回收', () => {
    const { registry, renderer, deleted } = harness();
    const geometry = new BufferGeometry(), attribute = new Float32BufferAttribute([1, 0, 0], 3);
    const owner = { geometry, getAttributes: () => [attribute] };
    const initialize = registry.initGeometry;
    installGeometryDisposalGuard(renderer);
    expect(registry.initGeometry).toBe(initialize);
    for (let cycle = 0; cycle < 3; cycle++) {
      registry.initGeometry(owner);
      geometry.dispose();
      expect(registry.initialized.has(geometry)).toBe(false);
      expect(registry._geometryDisposeListeners.size).toBe(0);
    }
    geometry.dispose();
    expect(deleted).toHaveBeenCalledTimes(3);
  });
});
