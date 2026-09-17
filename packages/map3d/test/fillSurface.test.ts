import { describe, expect, it, vi } from 'vitest';
import { Color, EqualStencilFunc, Scene } from 'three/webgpu';
import { canonicalKey, childrenOf, keyOf } from '../src/streaming/address.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { fillBytes, type FillData } from '../src/streaming/fills.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';

const address = { z: 4, x: 12, y: 5 };
const origin = selectMapOrigin({ lng: 116, lat: 39 }, 4);
const data = (): FillData => ({ positions: new Float32Array([-.5, 0, -.5, .5, 0, -.5, .5, 0, .5]),
  colors: new Float32Array(9).fill(.5), styles: new Float32Array([0, 25, 1, 0, 25, 1, 0, 25, 1]), indices: new Uint32Array([0, 1, 2]) });
const bitmap = () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap;

describe('原生面批次的裁剪与资源所有权', () => {
  it('父级剩余区域的面和线使用同一 stencil，完整来源直接显示', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const children = childrenOf(address);
    const parent = surfaces.create(bitmap(), address, { segments: new Float32Array([-.5, 0, .5, 0]),
      styles: new Float32Array([0, 1, 0, 24]), distances: new Float32Array([0]), paints: [{ color: '#ffffff', width: 7 }], colors: new Float32Array([1, 1, 1]) }, data());
    const child = surfaces.create(bitmap(), children[0]!, undefined, data());
    const resources = new Map([[canonicalKey(address), { surface: parent }], [canonicalKey(children[0]!), { surface: child }]]);
    surfaces.commit(resolveRenderCover(children, new Set(resources.keys()), 0).patches, resources, origin);
    expect(parent.mesh.material.visible).toBe(true);
    for (const material of [parent.fills!.mesh.material, parent.lines!.mesh.material]) {
      expect(material.stencilWrite).toBe(true); expect(material.stencilWriteMask).toBe(0);
      expect(material.stencilFunc).toBe(EqualStencilFunc); expect(material.stencilRef).toBe(parent.mesh.material.stencilRef);
    }
    expect(parent.mesh.geometry.drawRange.count).toBe(18);
    expect(child.mesh.material.visible).toBe(false); expect(child.fills!.mesh.material.stencilWrite).toBe(false);
    surfaces.update(origin, 14.5);
    expect(parent.fills!.viewZoom.value).toBe(14.5); expect(child.fills!.viewZoom.value).toBe(14.5);
    surfaces.commit(resolveRenderCover([address], new Set(resources.keys()), 0).patches, resources, origin);
    expect(parent.fills!.mesh.material.stencilWrite).toBe(false); expect(parent.mesh.material.visible).toBe(false);
    expect(scene.children).toHaveLength(2);
    surfaces.dispose(); surfaces.release(parent); surfaces.release(child);
    expect(surfaces.geometryBytes).toBe(0); expect(scene.children).toHaveLength(0);
  });
  it('世界副本共享面缓冲，材质与视图状态独立，副本退出只释放其所有资源', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const content = data(), image = bitmap(), resource = surfaces.create(image, address, undefined, content);
    const resources = new Map([[canonicalKey(address), { surface: resource }]]);
    const copy = { ...address, x: address.x + 2 ** address.z };
    surfaces.commit(resolveRenderCover([address, copy], new Set(resources.keys()), 0).patches, resources, origin);
    const instance = surfaces.instances.get(keyOf(copy))!;
    expect(instance.fills!.mesh.geometry).toBe(resource.fills!.mesh.geometry);
    expect(instance.fills!.mesh.material).not.toBe(resource.fills!.mesh.material);
    expect(instance.fills!.viewZoom).not.toBe(resource.fills!.viewZoom);
    expect(resource.cpuBytes).toBe(4 + fillBytes(content));
    const geometryDisposed = vi.fn(), materialDisposed = vi.fn(), copyDisposed = vi.fn();
    resource.fills!.mesh.geometry.addEventListener('dispose', geometryDisposed);
    resource.fills!.mesh.material.addEventListener('dispose', materialDisposed);
    instance.fills!.mesh.material.addEventListener('dispose', copyDisposed);
    surfaces.update(origin, 7.75); expect(instance.fills!.viewZoom.value).toBe(7.75);
    surfaces.commit(resolveRenderCover([address], new Set(resources.keys()), 0).patches, resources, origin);
    expect(copyDisposed).toHaveBeenCalledOnce(); expect(geometryDisposed).not.toHaveBeenCalled();
    surfaces.dispose(); surfaces.release(resource);
    expect(geometryDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce(); expect(surfaces.geometryBytes).toBe(0);
  });
});
