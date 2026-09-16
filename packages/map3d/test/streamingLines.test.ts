import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { buildLines, lineBytes, linePixelScale, simplifyLine } from '../src/streaming/lines.js';
import { createLineSurface } from '../src/streaming/lineSurface.js';
import { WEB_MERCATOR_WORLD_SIZE } from '../src/spatial/mercator.js';

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
      expect(lines.styles[i]).toBe(0); expect(lines.styles[i + 1]).toBeCloseTo(.9); expect(lines.styles[i + 2]).toBe(7);
    }
    expect(lineBytes(lines)).toBe(lines.segments.length / 4 * 48);
  });
});
