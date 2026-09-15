import { describe, expect, it } from 'vitest';
import { CITIES, flightView } from './cityFlight.js';

describe('城市飞行路径', () => {
  it('北京与上海之间先缩小、连续平移、在目的地放大', () => {
    const start = flightView(CITIES.beijing, CITIES.shanghai, 0);
    const end = flightView(CITIES.beijing, CITIES.shanghai, 1);
    expect(start.zoom).toBe(15); expect(start.center.lng).toBeCloseTo(CITIES.beijing.center.lng);
    expect(end.zoom).toBe(15); expect(end.center.lat).toBeCloseTo(CITIES.shanghai.center.lat);
    const middle = flightView(CITIES.beijing, CITIES.shanghai, .5);
    expect(middle.zoom).toBeLessThan(8); expect(middle.center.lng).toBeGreaterThan(start.center.lng); expect(middle.center.lng).toBeLessThan(end.center.lng);
    let previous = start;
    for (let i = 1; i <= 1000; i++) {
      const current = flightView(CITIES.beijing, CITIES.shanghai, i / 1000);
      expect(Math.abs(current.zoom - previous.zoom)).toBeLessThan(.1); expect(current.center.lng).toBeGreaterThanOrEqual(previous.center.lng); previous = current;
    }
  });
});
