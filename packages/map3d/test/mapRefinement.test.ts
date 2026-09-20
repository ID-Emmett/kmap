import { joinLineChains } from '../src/streaming/lineChains.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { projectLngLat } from '../src/spatial/mercator.js';
import { facesCamera, projectMapPoint, updateProjection } from '../src/globe/projection.js';
import { selectGlobeTiles } from '../src/globe/cover.js';
import { tessellateFills } from '../src/globe/tessellation.js';
import { lineJoin } from '../src/streaming/lineJoins.js';
import { buildLines } from '../src/streaming/lines.js';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { createSyntheticMvt } from './helpers/mvtFixture.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { LabelSystem } from '../src/labels/labelSystem.js';
import { decodeGlyphs } from '../src/labels/glyphs.js';
import type { LabelCandidate } from '../src/labels/candidates.js';

describe('球面瓦片、稳定文字与连续线连接', () => {
  it.each([0, 2, 4.5, 5, 5.5, 15])('z%s 球面投影中心与相机中心严格重合', zoom => {
    const view = { center: { lng: 116, lat: 40 }, zoom, pitch: 0, bearing: 35 }, scene = new Scene();
    const origin = selectMapOrigin(view.center, Math.floor(zoom)), camera = new PerspectiveCamera();
    updateMapCamera(camera, view, { width: 1280, height: 720 }, origin, true);
    const p = updateProjection(scene, view, origin, true), center = projectLngLat(view.center);
    const point = projectMapPoint(new Vector3(center.x - origin.meters.x, 0, origin.meters.y - center.y), p).project(camera);
    expect(point.x).toBeCloseTo(0, 8); expect(point.y).toBeCloseTo(0, 8);
  });
  it('世界球体在最低缩放完整显示，背面标签被遮挡且日期线保持连续', () => {
    for (const center of [{ lng: 179, lat: -20 }, { lng: 0, lat: 80 }]) {
      const view = { center, zoom: 0, pitch: 0, bearing: 0 }, scene = new Scene();
      const origin = selectMapOrigin(center, 0), camera = new PerspectiveCamera();
      updateMapCamera(camera, view, { width: 1280, height: 720 }, origin, true);
      const p = updateProjection(scene, view, origin, true); let visible = 0, hidden = 0;
      for (let lng = -180; lng < 180; lng += 10) for (let lat = -85; lat <= 85; lat += 10) {
        const meters = projectLngLat({ lng, lat });
        const point = new Vector3(meters.x - origin.meters.x, 0, origin.meters.y - meters.y);
        if (facesCamera(point, camera.position, p)) visible++; else hidden++;
        projectMapPoint(point, p).project(camera); expect(Math.abs(point.x)).toBeLessThan(.85); expect(Math.abs(point.y)).toBeLessThan(.85);
      }
      expect(visible).toBeGreaterThan(50); expect(hidden).toBeGreaterThan(50);
      const cover = selectGlobeTiles(camera, origin, view, 17, 128);
      expect(cover.leaves.length).toBeGreaterThan(4); expect(cover.leaves.every(a => a.x >= 0 && a.x < 2 ** a.z)).toBe(true);
    }
  });
  it('三角细分限制球面弦长并保持原始样式和面积', () => {
    const data = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Float32Array(9).fill(.5),
      styles: new Float32Array([0, 25, 1, 0, 25, 1, 0, 25, 1]), indices: new Uint32Array([0, 1, 2]) };
    const tessellated = tessellateFills(data, 2); let area = 0;
    for (let i = 0; i < tessellated.indices.length; i += 3) {
      const p = [0, 1, 2].map(n => { const j = tessellated.indices[i + n]! * 3; return { x: tessellated.positions[j]!, y: tessellated.positions[j + 2]! }; });
      for (let j = 0; j < 3; j++) expect(Math.hypot(p[j]!.x - p[(j + 1) % 3]!.x, p[j]!.y - p[(j + 1) % 3]!.y)).toBeLessThanOrEqual(1 / 32 + 1e-6);
      area += Math.abs((p[1]!.x - p[0]!.x) * (p[2]!.y - p[0]!.y) - (p[2]!.x - p[0]!.x) * (p[1]!.y - p[0]!.y)) / 2;
    }
    expect(area).toBeCloseTo(.5, 9); expect(tessellateFills(data, 6)).toBe(data);
  });
  it('道路链在二度端点合并，三度路口保留独立路径，闭环有限终止', () => {
    const p = (x: number, y = 0) => ({ x, y });
    expect(joinLineChains([[p(0), p(1)], [p(2), p(1)], [p(2), p(3)]])).toEqual([[p(0), p(1), p(2), p(3)]]);
    expect(joinLineChains([[p(0), p(1)], [p(1), p(2)], [p(1), p(1, 1)]])).toHaveLength(3);
    expect(joinLineChains([[p(0), p(1)], [p(1), p(1, 1)], [p(1, 1), p(0)]])[0]).toHaveLength(4);
  });
  it('相邻段共享折点、只在路径端点生成圆帽，锐角挤出有界', () => {
    const tile = decodeVectorTile(createSyntheticMvt());
    const lines = buildLines(tile, [{ id: 'line', sourceLayer: 'synthetic', type: 'line', paint: { color: '#fff' } }]);
    expect(Array.from(lines.caps!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(lines.joins!.slice(2, 4))).toEqual(Array.from(lines.joins!.slice(4, 6)));
    expect(lineJoin({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toEqual([-1, 1]);
    for (let angle = -.99 * Math.PI; angle < Math.PI; angle += .02) {
      expect(Math.hypot(...lineJoin({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1 + Math.cos(angle), y: Math.sin(angle) }))).toBeLessThanOrEqual(2.000001);
    }
  });
  it('层级过滤先于候选限额，点标签跨数据量化变化保留世界锚点和淡入时间', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#fff'));
    const address = { z: 15, x: 26978, y: 12416 }, view = { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15, pitch: 0, bearing: 0 };
    const origin = selectMapOrigin(view.center, 15), camera = new PerspectiveCamera(), viewport = { width: 1280, height: 720 };
    updateMapCamera(camera, view, viewport, origin);
    const label: LabelCandidate = { text: '中', key: 'visible', x: .5, y: .5, endX: .5, endY: .5, line: false, priority: 100,
      minZoom: 0, maxZoom: 25, size: 16, color: '#333', haloColor: '#fff', haloWidth: 1 };
    const labels = [...Array.from({ length: 40 }, (_, n) => ({ ...label, key: `hidden-${n}`, minZoom: 18 })), label];
    const surface = surfaces.create({ width: 1, height: 1, close() {} } as ImageBitmap, address, undefined, undefined, undefined, labels);
    surfaces.commit([{ source: address, cell: address, key: '15/26978/12416' }], new Map([['15/26978/12416', { surface }]]), origin);
    const system = new LabelSystem({ glyphs: '', fontStack: '' }, scene);
    const glyphs = decodeGlyphs(new Uint8Array(readFileSync(new URL('./fixtures/kye-glyph-19968-20223.pbf', import.meta.url))));
    system.atlas.pages.set(78, new Map(glyphs.map(g => [g.id, g])));
    system.update(surfaces, camera, origin, view, 15, viewport, 1, 100, Infinity);
    expect(system.placed).toBe(1);
    const geometry = system.surface.mesh.geometry, first = geometry.getAttribute('labelAnchor').getX(0), born = geometry.getAttribute('labelStyle').getW(0);
    label.x += 1 / 4096;
    system.update(surfaces, camera, origin, view, 15, viewport, 2, 300, Infinity);
    expect(system.placed).toBe(1); expect(geometry.getAttribute('labelAnchor').getX(0)).toBe(first); expect(geometry.getAttribute('labelStyle').getW(0)).toBe(born);
    label.layerId = 'place-label';
    system.setStyle({ sizeScale: 1.25, layers: { 'place-label': { color: '#123456', haloWidth: 2 } } });
    system.update(surfaces, camera, origin, view, 15, viewport, 2, 500, Infinity);
    expect(geometry.getAttribute('labelStyle').getZ(0)).toBeCloseTo(20 / 24);
    expect(geometry.getAttribute('labelStyle').getY(0)).toBe(2);
    expect(geometry.getAttribute('labelColor').getX(0)).toBeCloseTo(new Color('#123456').r);
    surface.labels = [];
    system.update(surfaces, camera, origin, view, 15, viewport, 3, 600, Infinity);
    expect(system.placed).toBe(1); expect(geometry.getAttribute('labelStyle').getW(0)).toBe(born);
    system.update(surfaces, camera, origin, view, 15, viewport, 3, 900, Infinity);
    expect(system.placed).toBe(0);
    surface.labels = labels;
    system.update(surfaces, camera, origin, view, 15, viewport, 4, 1000, Infinity);
    expect(system.placed).toBe(1);
    system.dispose(); surfaces.dispose(); surfaces.release(surface);
  });
});
