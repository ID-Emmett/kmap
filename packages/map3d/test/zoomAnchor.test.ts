import { describe, expect, it } from 'vitest';
import { locationAtPixel, zoomAroundPixel } from '../src/interaction/zoomAnchor.js';
import { projectLngLat, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../src/spatial/mercator.js';

describe('指针地理锚点缩放', () => {
  const viewport = { width: 1280, height: 720 }, pixel = { x: 780, y: 410 };
  it.each([2, 4.4, 4.7, 5, 5.4, 6, 7, 15, 20])('z%s 连续缩放保留鼠标地理位置', zoom => {
    for (const pitch of [0, 45, 70]) for (const bearing of [0, 65]) {
      let view = { center: { lng: 121, lat: 24 }, zoom, pitch, bearing };
      const anchor = locationAtPixel(view, viewport, pixel)!;
      expect(anchor).toBeDefined();
      for (let n = 0; n < 8; n++) view = zoomAroundPixel(view, viewport, view.zoom + .06, pixel);
      const after = locationAtPixel(view, viewport, pixel)!;
      const errorPixels = Math.hypot(anchor.x - after.x, anchor.y - after.y) / (WORLD / (256 * 2 ** view.zoom));
      expect(errorPixels).toBeLessThan(.1);
    }
  });
  it('最低缩放边界视角的中心像素锚点等于视图中心', () => {
    const edge = { width: 1707, height: 932 }, view = { center: { lng: 180, lat: -85.051129 }, zoom: 0, pitch: 0, bearing: 0 };
    const anchor = locationAtPixel(view, edge, { x: edge.width / 2, y: edge.height / 2 })!;
    const expected = projectLngLat(view.center);
    expect(Math.hypot(anchor.x - expected.x, anchor.y - expected.y)).toBeLessThan(1);
  });
  it('中心锚点保留中心的精确值，极限层级保持有限数值', () => {
    const view = { center: { lng: 179.999, lat: 80 }, zoom: 22, pitch: 75, bearing: 60 };
    expect(zoomAroundPixel(view, viewport, 22.5, { x: 640, y: 360 }).center).toEqual(view.center);
    const next = zoomAroundPixel(view, viewport, 25, pixel);
    expect(Number.isFinite(next.center.lat + next.center.lng + next.zoom)).toBe(true);
  });
});
