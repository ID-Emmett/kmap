import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, WebGPURenderer } from 'three/webgpu';

type GeometryAttributes = (BufferAttribute | InterleavedBufferAttribute)[];
interface GeometryOwner { geometry: BufferGeometry; getAttributes(): GeometryAttributes }
interface GeometryRegistry {
  initGeometry(owner: GeometryOwner): void;
  delete(geometry: BufferGeometry): unknown;
  _geometryDisposeListeners: Map<BufferGeometry, () => void>;
}

const installed = new WeakSet<GeometryRegistry>();

export function installGeometryDisposalGuard(renderer: WebGPURenderer): void {
  const registry = (renderer as unknown as { _geometries: GeometryRegistry })._geometries;
  if (installed.has(registry)) return;
  const initialize = registry.initGeometry;
  registry.initGeometry = function (owner): void {
    const geometry = owner.geometry, attributes = owner.getAttributes().slice();
    initialize.call(this, { geometry, getAttributes: () => attributes });
    const dispose = this._geometryDisposeListeners.get(geometry)!;
    geometry.removeEventListener('dispose', dispose);
    const release = () => {
      geometry.removeEventListener('dispose', release);
      dispose();
      this.delete(geometry);
    };
    geometry.addEventListener('dispose', release);
    this._geometryDisposeListeners.set(geometry, release);
  };
  installed.add(registry);
}
