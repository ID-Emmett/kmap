import { describe, expect, it } from 'vitest';
import { locationAtPixel, zoomAroundPixel } from '../src/interaction/zoomAnchor.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../src/spatial/mercator.js';

describe('指针地理锚点缩放', () => {
  const viewport = { width: 1280, height: 720 }, pixel = { x: 780, y: 410 };
  it.each([2, 4.4, 4.7, 5, 5.4, 6, 7, 15, 20])('z%s 连续缩放保留鼠标地理位置', zoom => {
    for (const pitch of [0, 45, 70]) for (const bearing of [0, 65]) {
      let view = { center: { lng: 121, lat: 24 }, zoom, pitch, bearing };
      const anchor = locationAtPixel(view, viewport, pixel, true)!;
      expect(anchor).toBeDefined();
      for (let n = 0; n < 8; n++) view = zoomAroundPixel(view, viewport, view.zoom + .06, pixel, true);
      const after = locationAtPixel(view, viewport, pixel, true)!;
      const errorPixels = Math.hypot(anchor.x - after.x, anchor.y - after.y) / (WORLD / (256 * 2 ** view.zoom));
      expect(errorPixels).toBeLessThan(.1);
    }
  });
  it('中心锚点保留中心的精确值，极限层级保持有限数值', () => {
    const view = { center: { lng: 179.999, lat: 80 }, zoom: 22, pitch: 75, bearing: 60 };
    expect(zoomAroundPixel(view, viewport, 22.5, { x: 640, y: 360 }, true).center).toEqual(view.center);
    const next = zoomAroundPixel(view, viewport, 25, pixel, true);
    expect(Number.isFinite(next.center.lat + next.center.lng + next.zoom)).toBe(true);
  });
});
