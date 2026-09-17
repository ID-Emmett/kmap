import { describe, expect, it } from 'vitest';
import { Color, Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { measureGlyphRun } from '../src/labels/glyphRun.js';
import type { AtlasGlyph } from '../src/labels/glyphAtlas.js';
import { MapPalette } from '../src/style/palette.js';
import { facesCamera, projectMapPoint, updateProjection } from '../src/globe/projection.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { projectLngLat, unprojectMercator } from '../src/spatial/mercator.js';
import { tessellateFills } from '../src/globe/tessellation.js';

describe('近景稳定性和独立元素样式', () => {
  it.each([4.51, 4.7, 5, 5.49])('z%s 过渡只显示正面地理半球，经度整周副本投影一致', zoom => {
    const view = { center: { lng: 116, lat: 40 }, zoom, pitch: 0, bearing: 0 }, origin = selectMapOrigin(view.center, 5), camera = new PerspectiveCamera();
    updateMapCamera(camera, view, { width: 1280, height: 720 }, origin, true);
    const p = updateProjection(new Scene(), view, origin, true);
    const position = (lng: number, lat = 40) => { const m = projectLngLat({ lng, lat }); return new Vector3(m.x - origin.meters.x, 0, origin.meters.y - m.y); };
    expect(facesCamera(position(116), camera.position, p)).toBe(true);
    expect(facesCamera(position(-64, -40), camera.position, p)).toBe(false);
    expect(projectMapPoint(position(120), p).distanceTo(projectMapPoint(position(480), p))).toBeLessThan(.000001);
  });
  it('共用基础色的不同图层及建筑类别可以独立改色、隐藏、调节尺寸并重置', () => {
    const p = new MapPalette(), c = new Color('#fff'), data = new Float32Array(Array(4).fill([c.r, c.g, c.b]).flat());
    p.encode(data, { colorIds: new Uint16Array([0, 1, 2, 3]), colorKeys: ['water', 'road', 'building/a', 'building/b'] });
    expect(new Set([data[0], data[3], data[6], data[9]]).size).toBe(4);
    p.set({ backgroundColor: '#fff', elements: { water: { color: '#ff0000', opacity: .4 }, road: { visible: false, widthScale: 2 }, building: { heightScale: 1.5 }, 'building/a': { color: '#00ff00' } } });
    expect(p.values[data[0]! * 4]).toBe(1); expect(p.values[data[0]! * 4 + 1]).toBe(0);
    expect(p.values[data[0]! * 4 + 3]).toBeCloseTo(.4); expect(p.values[data[3]! * 4 + 3]).toBe(0);
    expect(p.parameters[data[3]! * 4]).toBe(2); expect(p.parameters[data[9]! * 4 + 1]).toBe(1.5);
    expect(p.values[data[6]! * 4]).toBe(0); expect(p.values[data[9]! * 4]).toBe(1);
    p.set({ backgroundColor: '#fff' }); expect(p.values[data[3]! * 4 + 3]).toBe(1); expect(p.parameters[data[9]! * 4 + 1]).toBe(1);
  });
  it('字形高低不同的中英文混排行和图标共享视觉中心', () => {
    const glyphs = [{ width: 22, height: 23, top: 21, advance: 24 }, { width: 13, height: 18, top: 14, advance: 14 }] as AtlasGlyph[];
    for (const size of [10, 13, 17, 24]) {
      const run = measureGlyphRun(glyphs, size, 16, 5);
      const top = Math.min(...glyphs.map(g => -g.top * run.scale)) + run.baseline;
      const bottom = Math.max(...glyphs.map(g => (g.height - g.top) * run.scale)) + run.baseline;
      expect((top + bottom) / 2).toBeCloseTo(0, 12); expect(run.width).toBeCloseTo(38 * size / 24 + 21, 10);
      expect(run.height).toBeGreaterThanOrEqual(16);
    }
  });
  it('低缩放细分后的顶点保持图层归属', () => {
    const data = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Float32Array(9), styles: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), colorIds: new Uint16Array([2, 2, 2]), colorKeys: ['land', 'park', 'water'] };
    const result = tessellateFills(data, 2);
    expect(result.colorIds?.length).toBe(result.positions.length / 3); expect(new Set(result.colorIds)).toEqual(new Set([2]));
    expect(result.colorKeys).toEqual(data.colorKeys);
  });
  it.each([18, 20, 22])('z%s 逐像素平移跨越浮动原点时保持平面与 GPU 浮点精度', zoom => {
    const center = { lng: 116.3946533203125, lat: 39.90552253972854 }, meters = projectLngLat(center), camera = new PerspectiveCamera();
    const viewport = { width: 1280, height: 720 }, mpp = 40075016.68557849 / (256 * 2 ** zoom);
    const anchor = selectMapOrigin(center, 17).meters, local = new Vector3(meters.x - anchor.x, 0, anchor.y - meters.y);
    for (let n = -60; n <= 60; n++) {
      const view = { center: unprojectMercator({ x: meters.x + n * .25 * mpp, y: meters.y }), zoom, pitch: 0, bearing: 0 };
      const origin = selectMapOrigin(view.center, zoom); updateMapCamera(camera, view, viewport, origin, true);
      const projection = updateProjection(new Scene(), view, origin, true);
      expect(projection.center.w).toBe(0); expect(projectMapPoint(local.clone(), projection)).toEqual(local);
      const model = new Matrix4().makeTranslation(anchor.x - origin.meters.x, 0, origin.meters.y - anchor.y);
      const modelView = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, model);
      modelView.elements.forEach((value, index) => { modelView.elements[index] = Math.fround(value); });
      const point = local.clone().applyMatrix4(modelView).applyMatrix4(camera.projectionMatrix);
      expect(Math.abs(point.x * viewport.width / 2 + n * .25)).toBeLessThan(.02);
    }
  });
  it('z4.5–5.5 投影在边界具有连续位置和斜率', () => {
    const view = { center: { lng: 116, lat: 40 }, zoom: 5, pitch: 0, bearing: 0 }, origin = selectMapOrigin(view.center, 5);
    const point = new Vector3(150000, 20, 100000), position = (zoom: number) => projectMapPoint(point.clone(), updateProjection(new Scene(), { ...view, zoom }, origin, true));
    for (const boundary of [4.5, 5.5]) {
      expect(position(boundary - .00001).distanceTo(position(boundary + .00001))).toBeLessThan(.001);
    }
  });
});
