import type { VectorTile } from '@mapbox/vector-tile';
import { buildLines } from '../src/streaming/lines.js';
import { describe, expect, it } from 'vitest';
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { projectMapPoint, updateProjection } from '../src/globe/projection.js';
import { selectGlobeTiles } from '../src/globe/cover.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { projectLngLat, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../src/spatial/mercator.js';
import { panViewByPixels } from '../src/interaction/viewTransforms.js';
import { stableTileZoom } from '../src/streaming/lod.js';
import { globeBlend } from '../src/globe/globeCamera.js';
import { selectTiles } from '../src/streaming/selection.js';
import { MapPalette } from '../src/style/palette.js';
import { iconGlyphs } from '../src/labels/icons.js';

describe('平面与地球过渡及运行时外观', () => {
  it.each([0, 4.49, 4.5, 5, 5.49, 5.5, 6, 8, 12, 15, 17])('z%s 的真实曲面覆盖始终包含相机中心', zoom => {
    for (const pitch of [0, 60, 75]) {
      const view = { center: { lng: 179.99, lat: 40 }, zoom, pitch, bearing: 30 };
      const origin = selectMapOrigin(view.center, Math.floor(zoom)), camera = new PerspectiveCamera();
      const frame = updateMapCamera(camera, view, { width: 1280, height: 720 }, origin, true);
      const cover = zoom < 5.5 ? selectGlobeTiles(camera, origin, view, 17, 128, frame) : selectTiles(camera, frame, origin, view, { width: 1280, height: 720 }, 0, 17);
      expect(cover.leaves.length).toBeGreaterThan(0); expect(cover.leaves.length).toBeLessThanOrEqual(128);
      const meters = projectLngLat(view.center), p = updateProjection(new Scene(), view, origin, true);
      expect(p.center.w).toBe(1 - globeBlend(zoom));
      expect(cover.leaves.some(tile => Math.floor((view.center.lng + 180) / 360 * 2 ** tile.z) === tile.x
        && Math.floor((.5 - meters.y / WORLD) * 2 ** tile.z) === tile.y)).toBe(true);
      const point = projectMapPoint(new Vector3(meters.x - origin.meters.x, 0, origin.meters.y - meters.y), p).project(camera);
      expect(Math.abs(point.x) + Math.abs(point.y)).toBeLessThan(1e-8);
      expect(cover.fogEnd).toBeLessThan(1e12);
    }
  });
  it('雾在每个连续缩放边界保持相机距离比例', () => {
    const ends: number[] = [];
    for (const zoom of [5.499, 5.5, 5.501]) {
      const view = { center: { lng: 116, lat: 40 }, zoom, pitch: 75, bearing: 0 }, camera = new PerspectiveCamera();
      const origin = selectMapOrigin(view.center, 5), frame = updateMapCamera(camera, view, { width: 1280, height: 720 }, origin, true);
      const cover = zoom < 5.5 ? selectGlobeTiles(camera, origin, view, 17, 128, frame) : selectTiles(camera, frame, origin, view, { width: 1280, height: 720 }, 0, 17); ends.push(cover.fogEnd / frame.distance);
    }
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(1e-10);
  });
  it('水平球面拖拽完整一圈回到同一投影位置', () => {
    let view = { center: { lng: 0, lat: 0 }, zoom: 2, pitch: 0, bearing: 0 };
    const viewport = { width: 1280, height: 720 }, origin = selectMapOrigin(view.center, 2), camera = new PerspectiveCamera();
    updateMapCamera(camera, view, viewport, origin, true);
    const p = updateProjection(new Scene(), view, origin, true), meters = projectLngLat({ lng: 10, lat: 0 });
    const point = projectMapPoint(new Vector3(meters.x - origin.meters.x, 0, origin.meters.y - meters.y), p).project(camera);
    const dx = point.x * viewport.width / 2;
    for (let n = 0; n < 36; n++) view = panViewByPixels(view, viewport, dx, 0, true);
    expect(view.center.lng).toBeCloseTo(-360, 6); expect(view.center.lat).toBeCloseTo(0, 6);
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
  it('跨瓦片长直线保留球面细分并限制每段弦长', () => {
    const tile = { layers: { road: { extent: 4096, length: 1, feature: () => ({ type: 2, properties: {}, loadGeometry: () => [[{ x: 0, y: 2048 }, { x: 4096, y: 2048 }]] }) } } } as unknown as VectorTile;
    const data = buildLines(tile, [{ id: 'road', type: 'line', sourceLayer: 'road', paint: { color: '#fff' } }], 2);
    expect(data.segments.length / 4).toBeGreaterThanOrEqual(32);
    for (let i = 0; i < data.segments.length; i += 4) expect(Math.hypot(data.segments[i + 2]! - data.segments[i]!, data.segments[i + 3]! - data.segments[i + 1]!)).toBeLessThanOrEqual(1 / 32 + 1e-6);
  });
  it('九种图标具备不同的有效距离场与固定容量', () => {
    const icons = [...iconGlyphs().values()]; expect(icons).toHaveLength(9);
    expect(new Set(icons.map(icon => Array.from(icon.bitmap).join(','))).size).toBe(9);
    for (const icon of icons) { expect(Math.max(...icon.bitmap)).toBeGreaterThan(191); expect(Math.min(...icon.bitmap)).toBe(0); }
  });
});
