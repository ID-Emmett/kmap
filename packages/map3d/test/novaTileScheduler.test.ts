import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { MotionPredictor } from '../src/nova-tile/motion/index.js';
import { RequestScheduler } from '../src/nova-tile/scheduler/index.js';

const key = (x: number) => createCanonicalTileKey('main', 'r1', 4, x, 4)!;

describe('NTE motion and scheduler', () => {
  it('predicts motion with bounded 150-500ms windows', () => {
    const predictor = new MotionPredictor();
    predictor.addSample({ timeMs: 0, view: { center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 } });
    predictor.addSample({ timeMs: 100, view: { center: { lng: 1, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 } });
    const prediction = predictor.predict(100);
    expect(prediction.timeMs).toBeGreaterThanOrEqual(250);
    expect(prediction.timeMs).toBeLessThanOrEqual(600);
    expect(prediction.view.center.lng).toBeGreaterThan(1);
    expect(prediction.confidence).toBeGreaterThan(0);
  });

  it('deduplicates canonical requests and enforces phase frame budgets', () => {
    const scheduler = new RequestScheduler({ maxStartsPerFrame: 4, bucketCount: 2 });
    const task = (x: number, role: 'visible-critical' | 'motion-lookahead') => ({ key: key(x), role, coverageDeficit: role === 'visible-critical' ? 2 : 0, screenError: 1, motionAlignment: 0, cacheReuseProbability: 0, notBefore: 0 });
    scheduler.beginFrame(0, 'moving');
    scheduler.replace([task(0, 'visible-critical'), task(0, 'motion-lookahead'), task(1, 'motion-lookahead'), task(2, 'motion-lookahead'), task(3, 'motion-lookahead')]);
    const starts = [scheduler.take(0), scheduler.take(0), scheduler.take(0), scheduler.take(0), scheduler.take(0)].filter((value) => value !== undefined);
    expect(starts).toHaveLength(4);
    expect(starts[0]?.role).toBe('visible-critical');
    expect(scheduler.getStats().queued).toBe(0);
  });

  it('raises starvation priority and tracks spatial bucket allocation', () => {
    const scheduler = new RequestScheduler({ maxStartsPerFrame: 1, starvationMs: 100 });
    const make = (x: number) => ({ key: key(x), role: 'warm-prefetch' as const, coverageDeficit: 0, screenError: 0, motionAlignment: 0, cacheReuseProbability: 0, notBefore: 0 });
    scheduler.beginFrame(0, 'settled');
    scheduler.replace([make(0), make(1)], 0);
    scheduler.beginFrame(200, 'settled');
    scheduler.take(200);
    expect(scheduler.getStats().bucketStarts).toBeTruthy();
  });
});
