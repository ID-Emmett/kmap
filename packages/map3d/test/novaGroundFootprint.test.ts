import { describe, expect, it } from 'vitest';
import { createGroundFootprint, footprintTileBounds, tileAabbIntersectsFootprint } from '../src/nova-tile/coverage/index.js';

const viewport = { width: 800, height: 600 };

describe('NTE GroundFootprint', () => {
  it.each([0, 20, 40, 60])('produces a finite footprint at pitch %i', (pitch) => {
    const footprint = createGroundFootprint({ center: { lng: 0, lat: 0 }, zoom: 8, bearing: 30, pitch }, viewport, { guardBand: 10 });
    expect(footprint.points.length).toBeGreaterThanOrEqual(4);
    expect(footprint.maxX).toBeGreaterThan(footprint.minX);
    expect(footprint.maxY).toBeGreaterThan(footprint.minY);
    expect(footprint.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('includes guard band and returns a bounded tile range', () => {
    const footprint = createGroundFootprint({ center: { lng: 120, lat: 30 }, zoom: 5, bearing: 0, pitch: 60 }, viewport, { guardBand: 100 });
    const bounds = footprintTileBounds(footprint, 5);
    expect(bounds.minX).toBeLessThanOrEqual(bounds.maxX);
    expect(bounds.minY).toBeLessThanOrEqual(bounds.maxY);
    expect(tileAabbIntersectsFootprint({ minX: footprint.minX, maxX: footprint.maxX, minY: footprint.minY, maxY: footprint.maxY }, footprint)).toBe(true);
  });

  it('rejects invalid viewport and load distance', () => {
    expect(() => createGroundFootprint({ center: { lng: 0, lat: 0 }, zoom: 1, bearing: 0, pitch: 0 }, { width: 0, height: 1 })).toThrow();
    expect(() => createGroundFootprint({ center: { lng: 0, lat: 0 }, zoom: 1, bearing: 0, pitch: 0 }, viewport, { maxGroundDistance: 0 })).toThrow();
  });
});
