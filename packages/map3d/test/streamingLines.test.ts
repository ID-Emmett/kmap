import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { buildLines, lineBytes, linePixelScale, simplifyLine } from '../src/streaming/lines.js';
import { createLineSurface } from '../src/streaming/lineSurface.js';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { WEB_MERCATOR_WORLD_SIZE } from '../src/spatial/mercator.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';

describe('跨数据层级的矢量线宽', () => {
  it('亚像素简化保留端点与超过容差的转折', () => {
    expect(simplifyLine([{ x: 0, y: 0 }, { x: 1, y: .1 }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 0 }], .25))
      .toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 0 }]);
  });
  it('不同瓦片复用相同材质节点程序并独立保存线宽参数', () => {
    const data = { segments: new Float32Array([-.5, 0, .5, 0]), styles: new Float32Array([0, 1, 0, 24]), distances: new Float32Array([0]), paints: [{ color: '#ffffff', width: 7 }], colors: new Float32Array([1, 1, 1]) };
    const a = createLineSurface(data); const b = createLineSurface(data);
    a.pixelScale.value = 1 / 2048; b.pixelScale.value = 1 / 256;
    expect(a.mesh.material.customProgramCacheKey()).toBe(b.mesh.material.customProgramCacheKey());
    expect(a.pixelScale.value).not.toBe(b.pixelScale.value); expect(a.mesh.material.forceSinglePass).toBe(true);
    for (const surface of [a, b]) { surface.mesh.geometry.dispose(); surface.mesh.material.dispose(); }
  });
  it('同一视图使用任意祖先数据时保持相同地面宽度', () => {
    for (const viewZoom of [8, 11.86, 15, 17.5]) {
      const expected = 7 * WEB_MERCATOR_WORLD_SIZE / (256 * 2 ** viewZoom);
      for (let dataZoom = 0; dataZoom <= 17; dataZoom++) {
        const actual = 7 * linePixelScale(dataZoom, viewZoom) * WEB_MERCATOR_WORLD_SIZE / 2 ** dataZoom;
        expect(actual).toBeCloseTo(expected, 8);
      }
    }
  });
  it('真实 MVT 生成有限线段和样式，不把像素宽度乘入地理坐标', () => {
    const tile = decodeVectorTile(readFileSync(new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url)));
    const lines = buildLines(tile, [{ id: 'roads', type: 'line', sourceLayer: 'road', minZoom: 7, paint: { color: '#ffffff', width: 7, opacity: .9 } }]);
    expect(lines.segments.length).toBeGreaterThan(0);
    expect(lines.segments.length % 4).toBe(0);
    expect([...lines.segments].every(Number.isFinite)).toBe(true);
    expect(lines.colors.length).toBe(lines.segments.length / 4 * 3);
    for (let i = 0; i < lines.styles.length; i += 4) {
      expect(lines.styles[i]).toBe(0); expect(lines.styles[i + 1]).toBeCloseTo(.9);
      // 层级范围在构建时按瓦片层级求值，样式缓冲只写宽松范围，渲染期不再按目标层级剔除。
      expect(lines.styles[i + 2]).toBe(0); expect(lines.styles[i + 3]).toBe(25);
    }
    expect(lineBytes(lines)).toBe(lines.segments.length / 4 * 66);
  });
  it('线图层层级范围按承载瓦片层级求值，回退来源不因相机目标层级被剔除', () => {
    const tile = { layers: { line: { extent: 16, length: 1, feature: () => ({ type: 2, properties: {},
      loadGeometry: () => [[{ x: 0, y: 0 }, { x: 16, y: 16 }]] }) } } } as never;
    const limited = { id: 'limited', type: 'line', sourceLayer: 'line', minZoom: 3, maxZoom: 10, paint: { color: '#fff', width: 1 } };
    const open = { id: 'open', type: 'line', sourceLayer: 'line', paint: { color: '#fff', width: 1 } };
    // 默认按瓦片层级 24 求值：越过 limited 的排他上界，不构建。
    expect(buildLines(tile, [limited]).segments.length).toBe(0);
    // 瓦片层级落在范围内：构建，且样式范围写宽松值以免渲染期再按目标层级剔除。
    expect(Array.from(buildLines(tile, [limited], 24, 5).styles.slice(2, 4))).toEqual([0, 25]);
    // 瓦片层级越过排他边界：该图层不参与构建。
    expect(buildLines(tile, [limited], 24, 10).segments.length).toBe(0);
    expect(buildLines(tile, [limited], 24, 2).segments.length).toBe(0);
    // 未声明范围的图层在任意瓦片层级都构建。
    expect(buildLines(tile, [open], 24, 12).segments.length).toBeGreaterThan(0);
  });
  it('像素宽度先换算为地面挤出，倾斜视图远端投影自然收窄', () => {
    const viewport = { width: 1000, height: 800 }, view = { center: { lng: 0, lat: 0 }, zoom: 10, bearing: 0, pitch: 60 };
    const origin = selectMapOrigin(view.center, 10), camera = new PerspectiveCamera();
    const frame = updateMapCamera(camera, view, viewport, origin);
    const width = frame.metersPerPixel * 4;
    const projectedWidth = (z: number) => {
      const left = new Vector3(-width / 2, 0, z).project(camera), right = new Vector3(width / 2, 0, z).project(camera);
      return Math.abs(right.x - left.x) * viewport.width / 2;
    };
    expect(projectedWidth(0)).toBeGreaterThan(4);
    expect(projectedWidth(0)).toBeLessThan(5);
    expect(projectedWidth(-frame.distance * .6)).toBeLessThan(projectedWidth(0) * .75);
  });
});
