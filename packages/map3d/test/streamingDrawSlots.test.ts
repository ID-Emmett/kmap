import { describe, expect, it } from 'vitest';
import { Color, Scene } from 'three/webgpu';
import { canonicalKey, childrenOf } from '../src/streaming/address.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { createLineSurface, releaseLineSurface } from '../src/streaming/lineSurface.js';
import { createBuildingSurface } from '../src/streaming/buildingSurface.js';
import { createFillSurface } from '../src/streaming/fillSurface.js';
import { GeometryPool, capacityTier } from '../src/streaming/geometryPool.js';
import { DrawSlotPool } from '../src/streaming/drawSlots.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import type { Address } from '../src/streaming/address.js';
import type { FillData } from '../src/streaming/fills.js';
import type { LineData } from '../src/streaming/lines.js';
import type { BuildingData } from '../src/streaming/buildings.js';

const address = { z: 4, x: 12, y: 5 };
const origin = selectMapOrigin({ lng: 116, lat: 39 }, 4);
const bitmap = () => ({ width: 1, height: 1, close: () => {} }) as unknown as ImageBitmap;
const lines = (n: number): LineData => ({ segments: new Float32Array(n * 4), styles: new Float32Array(n * 3).fill(1),
  colors: new Float32Array(n * 3).fill(1), distances: new Float32Array(n), paints: [{ color: '#ffffff', width: 7 }] });
const fills = (n: number): FillData => ({ positions: new Float32Array(n * 3), colors: new Float32Array(n * 3).fill(.5),
  styles: new Float32Array(n * 3), indices: new Uint32Array([0, 1, 2]) });
const buildings = (n: number): BuildingData => ({ positions: new Float32Array(n * 3), normals: new Float32Array(n * 3),
  colors: new Float32Array(n * 3), styles: new Float32Array(n * 3), indices: new Uint32Array([0, 1, 2]), features: 0 });

describe('固定绘制槽位', () => {
  it('瓦片释放后线与面的 mesh、材质及样式数组整体复用', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const first = surfaces.create(bitmap(), address, lines(4), fills(3), buildings(3));
    const firstLineMesh = first.lines!.mesh, firstLineMaterial = first.lines!.mesh.material, firstWidths = first.lines!.widths;
    const firstFillMesh = first.fills!.mesh, firstBuildingMesh = first.buildings!.mesh;
    const patchMesh = first.mesh, patchMaterial = first.mesh.material;
    surfaces.release(first);
    const second = surfaces.create(bitmap(), address, lines(4), fills(3), buildings(3));
    expect(second.lines!.mesh).toBe(firstLineMesh);
    expect(second.lines!.mesh.material).toBe(firstLineMaterial);
    expect(second.lines!.widths).toBe(firstWidths);
    expect(second.fills!.mesh).toBe(firstFillMesh);
    expect(second.buildings!.mesh).toBe(firstBuildingMesh);
    expect(second.mesh).toBe(patchMesh); expect(second.mesh.material).toBe(patchMaterial);
    expect(surfaces.slotStats.line[0]).toBeGreaterThan(0);
    surfaces.release(second); surfaces.dispose();
  });
  it('持续换入同档位瓦片不再新建材质，只发生槽位复用', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    for (let i = 0; i < 8; i++) {
      const resource = surfaces.create(bitmap(), { ...address, x: address.x + i }, lines(4), fills(3), buildings(3));
      surfaces.release(resource);
    }
    const stats = surfaces.slotStats;
    // 四类槽位各只新建一次，其余全部复用。
    expect(stats.mask[1]).toBe(1); expect(stats.line[1]).toBe(1); expect(stats.fill[1]).toBe(1); expect(stats.building[1]).toBe(1);
    expect(stats.mask[0]).toBe(7); expect(stats.line[0]).toBe(7);
    surfaces.dispose();
  });
  it('父来源的多个绘制实例各自占用独立槽位并携带独立模板编号', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const parent = surfaces.create(bitmap(), address, lines(4), fills(3), buildings(3));
    const children = childrenOf(address);
    const resources = new Map([[canonicalKey(address), { surface: parent }]]);
    for (const child of children) resources.set(canonicalKey(child), { surface: surfaces.create(bitmap(), child, lines(4), fills(3), buildings(3)) });
    surfaces.commit(resolveRenderCover(children, new Set(resources.keys()), 0).patches, resources, origin);
    const stencils = [...surfaces.instances.values()].map(i => i.lines!.mesh.material.stencilRef);
    expect(new Set(stencils).size).toBe(stencils.length);
    const materials = [...surfaces.instances.values()].map(i => i.lines!.mesh.material);
    expect(new Set(materials).size).toBe(materials.length);
    surfaces.dispose();
    for (const resource of resources.values()) surfaces.release(resource.surface);
  });
  it('几何按容量档位复用，写入不重建属性数组', () => {
    const pool = new GeometryPool(), slots = new DrawSlotPool<ReturnType<typeof createLineSurface>['unit']>(8, () => {});
    const first = createLineSurface(lines(4), false, true, pool, slots);
    const attribute = first.mesh.geometry.getAttribute('lineSegment').array;
    releaseLineSurface(first, pool, slots);
    expect(pool.size).toBe(1);
    const second = createLineSurface(lines(4), false, true, pool, slots);
    expect(second.mesh.geometry.getAttribute('lineSegment').array).toBe(attribute);
    // 几何来自分档池而不是新建，因此取用后池已清空。
    expect(pool.size).toBe(0);
    releaseLineSurface(second, pool, slots);
    expect(pool.size).toBe(1);
  });
  it('容量档位按 2 的幂收敛，避免逐瓦片新增几何', () => {
    expect(capacityTier(1)).toBe(1); expect(capacityTier(3)).toBe(4);
    expect(capacityTier(300)).toBe(512); expect(capacityTier(512)).toBe(512);
    expect(capacityTier(0)).toBe(1);
  });
  it('线与面、建筑的槽位键随布局变化而区分', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const flat = surfaces.create(bitmap(), address, lines(4), fills(3), buildings(3));
    expect(flat.lines!.unit.key).not.toBe(flat.fills!.unit.key);
    // 面与建筑的槽位键同形但分属不同槽位池，互不干扰。
    expect(flat.fills!.unit.key).toBe(flat.buildings!.unit.key);
    expect(surfaces.fillSlots).not.toBe(surfaces.buildingSlots);
    expect(flat.lines!.unit.key).not.toBe(createLineSurface(lines(4), true, true).unit.key);
    expect(createFillSurface(fills(3), false, false).unit.key).not.toBe(flat.fills!.unit.key);
    expect(createBuildingSurface(buildings(3), false, false).unit.key).not.toBe(flat.buildings!.unit.key);
    surfaces.release(flat); surfaces.dispose();
  });
  it('槽位空闲数量受上限约束，超出后不再堆积', () => {
    const pool = new DrawSlotPool<{ mesh: never; label: string }>(2, () => {});
    const spawn = (label: string) => () => ({ mesh: undefined as never, label });
    pool.release('a', { mesh: undefined as never, label: '1' });
    pool.release('a', { mesh: undefined as never, label: '2' });
    pool.release('a', { mesh: undefined as never, label: '3' });
    expect(pool.idleCount).toBe(2);
    expect(pool.acquire('a', spawn('new')).label).toBe('2');
  });
  it('未传入槽位池时保持逐瓦片独占材质', () => {
    const pool = new GeometryPool();
    const a = createLineSurface(lines(4), false, true, pool), b = createLineSurface(lines(4), false, true, pool);
    expect(a.mesh.material).not.toBe(b.mesh.material);
    expect(a.widths).not.toBe(b.widths);
    releaseLineSurface(a, pool); releaseLineSurface(b, pool);
  });
  it('父来源内容按完整地址绘制时沿用同一槽位与几何', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#ffffff'));
    const parent = surfaces.create(bitmap(), address, lines(4), fills(3), buildings(3));
    const key = canonicalKey(address), copy: Address = { ...address, x: address.x + 2 ** address.z };
    const resources = new Map([[key, { surface: parent }]]);
    surfaces.commit(resolveRenderCover([address, copy], new Set(resources.keys()), 0).patches, resources, origin);
    const instance = surfaces.instances.get(`${copy.z}/${copy.x}/${copy.y}`)!;
    expect(instance.lines!.mesh.geometry).toBe(parent.lines!.mesh.geometry);
    expect(instance.lines!.mesh).not.toBe(parent.lines!.mesh);
    expect(instance.lines!.widths).not.toBe(parent.lines!.widths);
    surfaces.dispose(); surfaces.release(parent);
  });
});
