import { describe, expect, it } from 'vitest';
import { Scene, Color } from 'three/webgpu';
import { canonicalKey, childrenOf, contains, keyOf, type Address } from '../src/streaming/address.js';
import { resolveRenderCover, coverSources } from '../src/streaming/renderCover.js';
import { TileAvailability } from '../src/streaming/availability.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { renderGroup } from 'three/tsl';
import { PatchGeometry } from '../src/streaming/patchGeometry.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';

const parent = { z: 13, x: 6744, y: 3104 };
const children = childrenOf(parent);
const ready = (...addresses: Address[]) => new Set(addresses.map(canonicalKey));
const disjoint = (patches: ReturnType<typeof resolveRenderCover>['patches']) => {
  for (const a of patches) for (const b of patches) if (a !== b) expect(contains(a.cell, b.cell)).toBe(false);
};
describe('实际显示区域归属', () => {
  it('区域网格具有正确朝向、纹理坐标与稳定的几何所有权', () => {
    const geometry = new PatchGeometry(); geometry.update(parent, [children[0]!, children[3]!]);
    const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    let area = 0;
    for (let i = 0; i < geometry.drawRange.count; i += 3) {
      const a = geometry.index!.getX(i), b = geometry.index!.getX(i + 1), c = geometry.index!.getX(i + 2);
      const cross = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
      expect(cross).toBeGreaterThan(0); area += cross / 2;
    }
    expect(area).toBe(.5);
    for (let i = 0; i < p.count; i++) { expect(p.getX(i) + .5).toBe(uv.getX(i)); expect(p.getZ(i) + .5).toBe(uv.getY(i)); }
    geometry.update(parent, [parent]); expect(geometry.getAttribute('position')).toBe(p);
    expect(geometry.drawRange.count).toBe(6); expect(geometry.bytes).toBe(184); geometry.dispose();
  });
  it('增量祖先计数保留兄弟依赖，最后一个资源释放后树索引归零', () => {
    const available = new TileAvailability(); children.forEach(a => available.add(canonicalKey(a)));
    available.add(canonicalKey(children[0]!));
    expect(available.ancestors.get(canonicalKey(parent))).toBe(4);
    available.delete(canonicalKey(children[0]!));
    expect(available.ancestors.get(canonicalKey(parent))).toBe(3);
    const indexed = resolveRenderCover([parent], available, 0);
    const plain = resolveRenderCover([parent], new Set(available), 0);
    expect(indexed).toEqual(plain);
    for (const key of [...available]) available.delete(key);
    expect(available.size).toBe(0); expect(available.ancestors.size).toBe(0);
  });
  it('部分子级就绪时父级只贡献剩余区域，全部就绪后释放显示引用', () => {
    const partial = resolveRenderCover(children, ready(parent, children[0]!, children[2]!), 0);
    expect(partial.uncovered).toBe(0); expect(partial.patches).toHaveLength(4); disjoint(partial.patches);
    expect(partial.patches.filter(p => keyOf(p.source) === keyOf(parent))).toHaveLength(2);
    const complete = resolveRenderCover(children, ready(parent, ...children), 0);
    expect(coverSources(complete.patches)).toHaveLength(4);
    expect(complete.patches.every(p => p.source.z === 14)).toBe(true);
  });
  it('缩小期间使用已就绪子级，目标父级就绪后同帧直接接替', () => {
    const detailed = resolveRenderCover([parent], ready(...children), 0);
    expect(detailed.uncovered).toBe(0); expect(detailed.patches).toHaveLength(4); disjoint(detailed.patches);
    const overview = resolveRenderCover([parent], ready(parent, ...children), 0);
    expect(overview.patches).toEqual([{ cell: parent, source: parent, key: canonicalKey(parent) }]);
  });
  it('连续缩小四级仍保留已加载区域，遍历只进入驻留资源的祖先路径', () => {
    let detailed = parent;
    for (let i = 0; i < 4; i++) detailed = childrenOf(detailed)[0]!;
    const available = new TileAvailability(); available.add(canonicalKey(detailed));
    let visited = 0;
    const cover = resolveRenderCover([parent], available, 0, () => { visited++; return true; });
    expect(cover.patches).toEqual([{ cell: detailed, source: detailed, key: canonicalKey(detailed) }]);
    expect(visited).toBe(17); expect(cover.uncovered).toBe(12);
    disjoint(cover.patches);
  });
  it('有效视锥之外的子区域排除，视锥内真实缺口保持可观测', () => {
    const one = resolveRenderCover([parent], ready(children[0]!), 0, a => a.z === 13 || keyOf(a) === keyOf(children[0]!));
    expect(one.uncovered).toBe(0); expect(one.patches).toHaveLength(1);
    expect(resolveRenderCover([parent], ready(children[0]!), 0).uncovered).toBe(3);
  });
  it('世界副本复用同一 canonical 资源且显示地址独立', () => {
    const copy = { ...parent, x: parent.x + 2 ** parent.z };
    const result = resolveRenderCover([parent, copy], ready(parent), 0);
    expect(result.uncovered).toBe(0); expect(new Set(result.patches.map(p => p.key)).size).toBe(1);
    expect(coverSources(result.patches)).toHaveLength(2); disjoint(result.patches);
  });
  it('WebGPU 表面以固定透明度提交，部分区域开启裁剪且完整目标解除裁剪', () => {
    const scene = new Scene(); const surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const bitmap = () => ({ width: 256, height: 256, close() {} }) as ImageBitmap;
    const p = surfaces.create(bitmap(), parent, { segments: new Float32Array([-.5, 0, .5, 0]), styles: new Float32Array([0, 1, 0, 17]), distances: new Float32Array([0]), paints: [{ color: '#ffffff', width: 7 }], colors: new Float32Array([1, 1, 1]) });
    const c = surfaces.create(bitmap(), children[0]!); const geometry = p.mesh.geometry;
    const resources = new Map([[canonicalKey(parent), { surface: p }], [canonicalKey(children[0]!), { surface: c }]]);
    const origin = selectMapOrigin({ lng: 116.39, lat: 39.9 }, 15);
    surfaces.commit(resolveRenderCover(children, new Set(resources.keys()), 0).patches, resources, origin);
    expect(p.mesh.material.stencilWrite).toBe(true); expect(c.mesh.material.stencilWrite).toBe(false);
    expect(p.mesh.material.opacity).toBe(1); expect(c.mesh.material.opacity).toBe(1);
    expect(scene.children).toHaveLength(3); expect(p.mesh.geometry.drawRange.count).toBe(18);
    expect(p.lines!.mesh.material.stencilRef).toBe(p.mesh.material.stencilRef);
    for (const node of [surfaces.fogCenter, surfaces.fogStart, surfaces.fogEnd, surfaces.fogColor]) expect(node.groupNode).toBe(renderGroup);
    surfaces.commit(resolveRenderCover([parent], new Set(resources.keys()), 0).patches, resources, origin);
    expect(p.mesh.material.stencilWrite).toBe(false); expect(c.mesh.visible).toBe(false);
    expect(p.mesh.geometry).toBe(geometry); expect(geometry.drawRange.count).toBe(6);
    surfaces.dispose(); surfaces.release(p); surfaces.release(c);
    expect(surfaces.geometryBytes).toBe(0);
  });
});
