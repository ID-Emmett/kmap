import { describe, expect, it } from 'vitest';
import { Color, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { projectLngLat } from '../src/spatial/mercator.js';
import { stableTileZoom } from '../src/streaming/lod.js';
import { selectTiles } from '../src/streaming/selection.js';
import { MapPalette } from '../src/style/palette.js';
import { iconGlyphs } from '../src/labels/icons.js';

describe('平面覆盖与运行时外观', () => {
  it.each([0, 4.49, 4.5, 5, 5.49, 5.5, 6, 8, 12, 15, 17])('z%s 的平面覆盖包含相机中心且雾有界', zoom => {
    for (const pitch of [0, 60, 75]) {
      const view = { center: { lng: 179.99, lat: 40 }, zoom, pitch, bearing: 30 };
      const origin = selectMapOrigin(view.center, Math.floor(zoom)), camera = new PerspectiveCamera();
      const frame = updateMapCamera(camera, view, { width: 1280, height: 720 }, origin);
      const cover = selectTiles(camera, frame, origin, view, { width: 1280, height: 720 }, 0, 17);
      expect(cover.leaves.length).toBeGreaterThan(0);
      const meters = projectLngLat(view.center);
      const center = new Vector3(meters.x - origin.meters.x, 0, origin.meters.y - meters.y).project(camera);
      expect(Math.abs(center.x) + Math.abs(center.y)).toBeLessThan(1e-8);
      expect(cover.fogEnd).toBeLessThan(1e12);
    }
  });
  it('整数附近反复滚轮缩放保持数据层级', () => {
    let level = 15;
    for (const zoom of [15.03, 14.98, 15.04, 14.95, 15]) { level = stableTileZoom(zoom, level); expect(level).toBe(15); }
    expect(stableTileZoom(14.7, level)).toBe(14); expect(stableTileZoom(16.2, level)).toBe(16);
  });
  it('主题按同一索引原子改色，新上传颜色与重置具有一致结果', () => {
    const palette = new MapPalette(), a = new Color('#A9D7E8'), values = new Float32Array([a.r, a.g, a.b]);
    palette.encode(values); const index = values[0]!;
    palette.set({ backgroundColor: '#123456', colors: { '#a9d7e8': '#123456' } });
    expect(palette.values[index * 4]).toBeCloseTo(new Color('#123456').r);
    const next = new Float32Array([a.r, a.g, a.b]); palette.encode(next); expect(next[0]).toBe(index);
    palette.set({ backgroundColor: '#F5F5F2' }); expect(palette.values[index * 4 + 1]).toBeCloseTo(a.g);
  });
  it('十种图标具备不同的有效距离场与固定容量', () => {
    const icons = [...iconGlyphs().values()]; expect(icons).toHaveLength(10);
    expect(new Set(icons.map(icon => Array.from(icon.bitmap).join(','))).size).toBe(10);
    for (const icon of icons) { expect(Math.max(...icon.bitmap)).toBeGreaterThan(191); expect(Math.min(...icon.bitmap)).toBe(0); }
  });
});
