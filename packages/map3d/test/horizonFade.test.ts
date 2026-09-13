import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
  calculateHorizonFadeParameters,
} from '../src/rendering/horizonFade.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { createGroundFootprint } from '../src/nova-tile/coverage/index.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import type { ViewState, ViewportSize } from '../src/types.js';

const CENTER = { lng: 116.4074, lat: 39.9042 } as const;

describe('horizon fade parameters', () => {
  it('pitch 0 禁用远景渐隐但保留有限距离参数', () => {
    const sample = calculateSample({ pitch: 0 });

    expect(sample.params.strength).toBe(0);
    expect(sample.params.start).toBeGreaterThan(sample.frame.distance);
    expect(sample.params.end).toBeGreaterThan(sample.params.start);
    expect(Object.values(sample.params).every(Number.isFinite)).toBe(true);
  });

  it('随 pitch 增大平滑增强且保持 start/end 有序', () => {
    const pitch20 = calculateSample({ pitch: 20 });
    const pitch40 = calculateSample({ pitch: 40 });
    const pitch60 = calculateSample({ pitch: 60 });

    expect(pitch20.params.strength).toBeGreaterThan(0);
    expect(pitch40.params.strength).toBeGreaterThan(pitch20.params.strength);
    expect(pitch60.params.strength).toBeGreaterThan(pitch40.params.strength);
    for (const sample of [pitch20, pitch40, pitch60]) {
      expect(sample.params.start).toBeGreaterThan(sample.frame.distance);
      expect(sample.params.end).toBeGreaterThan(sample.params.start);
      expect(sample.params.strength).toBeLessThanOrEqual(0.78);
    }
  });

  it('距离随 zoom 和 viewport 以 camera frame 相对缩放', () => {
    const base = calculateSample({ pitch: 45, zoom: 15 });
    const zoomedOut = calculateSample({ pitch: 45, zoom: 14 });
    const taller = calculateSample({
      pitch: 45,
      viewport: { width: 1280, height: 1440 },
    });

    expect(normalizedStart(zoomedOut)).toBeCloseTo(normalizedStart(base), 1);
    expect(normalizedEnd(zoomedOut)).toBeCloseTo(normalizedEnd(base), 1);
    expect(normalizedStart(taller)).toBeCloseTo(normalizedStart(base), 1);
    expect(normalizedEnd(taller)).toBeCloseTo(normalizedEnd(base), 1);
  });
});

function calculateSample({
  pitch,
  zoom = 15,
  viewport = { width: 1280, height: 720 },
}: {
  pitch: number;
  zoom?: number;
  viewport?: ViewportSize;
}) {
  const view: ViewState = {
    center: CENTER,
    zoom,
    bearing: 15,
    pitch,
  };
  const origin = selectMapOrigin(view.center, Math.floor(zoom));
  const footprint = createGroundFootprint(view, viewport);
  const camera = new PerspectiveCamera();
  const frame = updateMapCamera(camera, view, viewport, origin);
  const params = calculateHorizonFadeParameters({
    view,
    camera: frame,
    origin,
    footprint: footprint.points,
  });

  return { frame, params };
}

function normalizedStart(sample: ReturnType<typeof calculateSample>): number {
  return sample.params.start / sample.frame.distance;
}

function normalizedEnd(sample: ReturnType<typeof calculateSample>): number {
  return sample.params.end / sample.frame.distance;
}
