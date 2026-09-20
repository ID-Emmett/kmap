import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import type { VectorTile } from '@mapbox/vector-tile';
import type { MapLayerOptions } from '../src/types.js';
import { buildBuildings, buildingBytes } from '../src/streaming/buildings.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { canonicalKey, childrenOf } from '../src/streaming/address.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { buildLines } from '../src/streaming/lines.js';
import { createLineState, lineWidth, updateLineState } from '../src/streaming/lineStyle.js';
import { decodeTileSources, overlayAddress, packTileSources } from '../src/streaming/tileSources.js';
import { fogDistances } from '../src/streaming/fog.js';
import { selectTiles } from '../src/streaming/selection.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../src/spatial/mercator.js';

const address = { z: 15, x: 26978, y: 12416 };
const fixture = (name = 'kye-main-z15-26978-12416') => readFileSync(new URL(`./fixtures/${name}.mvt`, import.meta.url));
const layer: MapLayerOptions = { type: 'fill-extrusion', id: 'building', sourceLayer: 'building', minZoom: 15.74,
  paint: { color: '#e1e3e5', colorProperty: 'kind', categoryColors: { '1102': '#ff0000' } } };

describe('建筑几何、连续线宽与大倾角画质', () => {
  it('真实建筑高度、分类颜色和索引有限，零高建筑保持地面', () => {
    const tile = decodeVectorTile(fixture()); const data = buildBuildings(tile, [layer], address);
    expect(data.features).toBe(232);
    expect(data.indices.length).toBeGreaterThan(data.features * 6);
    expect(Math.max(...data.indices)).toBeLessThan(data.positions.length / 3);
    expect([...data.positions, ...data.normals].every(Number.isFinite)).toBe(true);
    const scale = Math.cosh(Math.PI * (1 - 2 * (address.y + .5) / 2 ** address.z));
    let height = 0, red = 0, neutral = 0;
    for (let i = 0; i < data.positions.length; i += 3) {
      height = Math.max(height, data.positions[i + 1]! / scale);
      if (data.colors[i] === 1 && data.colors[i + 1] === 0) red++; else neutral++;
      expect(Math.hypot(...data.normals.slice(i, i + 3))).toBeCloseTo(1, 5);
    }
    expect(height).toBeCloseTo(47, 4); expect(red).toBeGreaterThan(0); expect(neutral).toBeGreaterThan(0);
    expect(buildingBytes(data)).toBe(data.positions.byteLength * 4 + data.indices.byteLength);
  });

  it('屋顶孔洞保留、底高有效、瓦片裁切边不生成伪墙', () => {
    const ring = (points: number[][]) => points.map(([x, y]) => ({ x: x!, y: y! }));
    const tile = { layers: { building: { extent: 16, length: 1, feature: () => ({ type: 3, properties: { height: 20, min_height: 5 },
      loadGeometry: () => [ring([[0, 0], [16, 0], [16, 16], [0, 16], [0, 0]]), ring([[4, 4], [4, 12], [12, 12], [12, 4], [4, 4]])] }) } } } as unknown as VectorTile;
    const data = buildBuildings(tile, [layer], { z: 1, x: 1, y: 0 });
    let area = 0, walls = 0;
    for (let i = 0; i < data.indices.length; i += 3) {
      const [a, b, c] = Array.from(data.indices.slice(i, i + 3)).map(n => n * 3);
      if (data.normals[a! + 1] === 0) { walls++; continue; }
      area += Math.abs((data.positions[b!]! - data.positions[a!]!) * (data.positions[c! + 2]! - data.positions[a! + 2]!)
        - (data.positions[c!]! - data.positions[a!]!) * (data.positions[b! + 2]! - data.positions[a! + 2]!)) / 2;
    }
    expect(area).toBeCloseTo(.75); expect(walls).toBe(8);
    expect(Math.min(...Array.from(data.positions).filter((_, i) => i % 3 === 1))).toBeCloseTo(5 * Math.cosh(Math.PI / 2), 4);
  });

  it('15.74 门槛、合批、父子裁剪、世界副本与几何释放保持一致', () => {
    const data = buildBuildings(decodeVectorTile(fixture()), [layer], address);
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
    const bitmap = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const resource = surfaces.create(bitmap, address, undefined, undefined, data);
    const resources = new Map([[canonicalKey(address), { surface: resource }]]);
    const origin = selectMapOrigin({ lng: 116.39465, lat: 39.90552 }, 15);
    const cells = childrenOf(address).slice(0, 2);
    surfaces.commit(resolveRenderCover(cells, new Set(resources.keys()), 0).patches, resources, origin);
    expect(resource.buildings!.mesh.userData.buildingState.clipCount).toBe(2);
    for (const zoom of [15, 15.739, 15.74, 16, 15.5]) {
      surfaces.update(origin, zoom); expect(resource.buildings!.mesh.visible).toBe(zoom >= 15.74);
    }
    expect(resource.buildings!.mesh.material.depthWrite).toBe(true);
    expect(resource.buildings!.mesh.children).toHaveLength(0);
    const copy = { ...address, x: address.x + 2 ** address.z };
    surfaces.commit(resolveRenderCover([address, copy], new Set(resources.keys()), 0).patches, resources, origin);
    expect(surfaces.instances.size).toBe(2);
    const dispose = vi.fn(); resource.buildings!.mesh.geometry.addEventListener('dispose', dispose);
    surfaces.dispose(); surfaces.release(resource); expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('米制线宽在数据层级切换和 overzoom 时保持物理尺寸，投影宽度随缩放增长', () => {
    const data = buildLines(decodeVectorTile(fixture()), [{ type: 'line', id: 'r', sourceLayer: 'road', paint: { color: '#fff', width: 12 } }]);
    const state = createLineState(data);
    for (const z of [13, 15, 17]) {
      const a = { z, x: 0, y: 0 }; state.viewZoom.value = -1;
      updateLineState(state, a, 18);
      expect(state.widths[0]! * WORLD / 2 ** z / Math.cosh(Math.PI * (1 - 1 / 2 ** z))).toBeCloseTo(12, 5);
    }
    const projected: number[] = [];
    for (const zoom of [15, 16, 18]) { updateLineState(state, address, zoom); projected.push(state.widths[0]! / state.pixelScale.value); }
    expect(projected[1]! / projected[0]!).toBeCloseTo(2); expect(projected[2]! / projected[0]!).toBeCloseTo(8);
    const paint = { color: '#fff', widthBase: 1.5, widthStops: [[10, 8], [12, 18]] as const };
    expect(lineWidth(paint, 11)).toBeCloseTo(12);
    expect(lineWidth(paint, 9)).toBe(8); expect(lineWidth(paint, 13)).toBe(18);
  });

  it('虚线累计长度跨线段连续，四项点划线进入样式表', () => {
    const tile = { layers: { road: { extent: 16, length: 1, feature: () => ({ type: 2, properties: {},
      loadGeometry: () => [[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }]] }) } } } as unknown as VectorTile;
    const data = buildLines(tile, [{ type: 'line', id: 'dash', sourceLayer: 'road', paint: { color: '#fff', width: 5, dashArray: [2, 2, 6, 2] } }]);
    expect(Array.from(data.distances)).toEqual([0, .5]); expect(Array.from(createLineState(data).dashes.slice(0, 4))).toEqual([2, 2, 6, 2]);
  });

  it('省界使用真实专用数据，祖先边界正确变换到子瓦片', () => {
    const main = fixture('kye-v8Maptile-z5-26-12'), admin = fixture('kye-kye_admin_pro-z5-26-12');
    const overlay = { tiles: [], minZoom: 2, maxZoom: 5, sourceLayer: 'border', targetLayer: 'province_border' };
    const source = { z: 5, x: 26, y: 12 }; const child = { z: 7, x: 105, y: 49 };
    const packed = packTileSources([Uint8Array.from(main).buffer, Uint8Array.from(admin).buffer]);
    const tile = decodeTileSources(packed, source, [overlay]); expect(tile.layers.province_border!.length).toBe(12);
    const data = decodeTileSources(packed, child, [overlay]);
    expect(overlayAddress(child, overlay)).toEqual(source);
    const points = Array.from({ length: tile.layers.province_border!.length }, (_, i) => tile.layers.province_border!.feature(i).loadGeometry()[0]![0]!);
    expect(data.layers.province_border!.length).toBeGreaterThan(0);
    for (let i = 0; i < data.layers.province_border!.length; i++) {
      const q = data.layers.province_border!.feature(i).loadGeometry()[0]![0]!;
      expect(points.some(p => q.x === p.x * 4 - 4096 && q.y === p.y * 4 - 4096)).toBe(true);
    }
  });

  it.each([0, 45, 135, 270])('75° 倾角、方位 %s° 顶部 40%% 完全入雾且统一层级', bearing => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 16, pitch: 75, bearing };
    const camera = new PerspectiveCamera(), viewport = { width: 2560, height: 1305 };
    const origin = selectMapOrigin(view.center, 16), frame = updateMapCamera(camera, view, viewport, origin);
    const ray = new Vector3(0, .2, .5).unproject(camera).sub(camera.position).normalize();
    const distance = -camera.position.y / ray.y;
    expect(fogDistances(frame, 75).end).toBeCloseTo(distance, 5);
    const result = selectTiles(camera, frame, origin, view, viewport, 0, 17);
    expect(result.leaves.length).toBeLessThanOrEqual(128); expect(new Set(result.leaves.map(a => a.z)).size).toBe(1);
    expect(result.fogCulled).toBeGreaterThan(0);
  });
});
