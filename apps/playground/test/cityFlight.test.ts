import { describe, expect, it } from 'vitest';
import { CITIES, flightView } from '../src/cityFlight.js';

describe('城市飞行路径', () => {
  it('北京与上海之间先缩小、连续平移、在目的地放大', () => {
    const start = flightView(CITIES.beijing, CITIES.shanghai, 0);
    const end = flightView(CITIES.beijing, CITIES.shanghai, 1);
    expect(start.zoom).toBe(CITIES.beijing.zoom); expect(start.center.lng).toBeCloseTo(CITIES.beijing.center.lng);
    expect(end.zoom).toBe(CITIES.shanghai.zoom); expect(end.center.lat).toBeCloseTo(CITIES.shanghai.center.lat);
    const middle = flightView(CITIES.beijing, CITIES.shanghai, .5);
    expect(middle.zoom).toBeLessThan(8); expect(middle.center.lng).toBeGreaterThan(start.center.lng); expect(middle.center.lng).toBeLessThan(end.center.lng);
    let previous = start;
    for (let i = 1; i <= 1000; i++) {
      const current = flightView(CITIES.beijing, CITIES.shanghai, i / 1000);
      expect(Math.abs(current.zoom - previous.zoom)).toBeLessThan(.1); expect(current.center.lng).toBeGreaterThanOrEqual(previous.center.lng); previous = current;
    }
  });
  it('从西经与边界视角飞往广州时路径不越出单世界', () => {
    const origins = [
      { center: { lng: -100, lat: 40 }, zoom: 0, bearing: 0, pitch: 0 },
      { center: { lng: -170, lat: 0 }, zoom: 0, bearing: 0, pitch: 0 },
      { center: { lng: -180, lat: -85.051129 }, zoom: 0, bearing: 0, pitch: 0 },
      { center: { lng: 180, lat: -85.051129 }, zoom: 0, bearing: 0, pitch: 0 },
    ];
    for (const from of origins) {
      for (let i = 0; i <= 200; i++) {
        const current = flightView(from, CITIES.guangzhou, i / 200);
        expect(current.center.lng).toBeGreaterThanOrEqual(-180);
        expect(current.center.lng).toBeLessThanOrEqual(180);
      }
      const end = flightView(from, CITIES.guangzhou, 1);
      expect(end.center.lng).toBeCloseTo(CITIES.guangzhou.center.lng);
      expect(end.center.lat).toBeCloseTo(CITIES.guangzhou.center.lat);
    }
  });
});
