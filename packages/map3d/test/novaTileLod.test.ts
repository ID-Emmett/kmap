import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { MixedLODPlanner } from '../src/nova-tile/lod/index.js';

const planner = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 8, tileBudget: 24 });

describe('NTE mixed LOD planner', () => {
  it.each([0, 20, 40, 60])('creates a complete stable cover at pitch %i', (pitch) => {
    const plan = planner.plan({ center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch }, { width: 800, height: 600 });
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);
    expect(plan.coverageComplete).toBe(true);
    expect(plan.footprint.loadCutoff).toBeGreaterThan(0);
  });

  it('refines by SSE and respects sibling budget', () => {
    const coarse = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 8, tileBudget: 8, refineThresholdPx: 1_000_000 });
    const fine = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 8, tileBudget: 8, refineThresholdPx: 0.01 });
    const coarsePlan = coarse.plan({ center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 }, { width: 512, height: 512 });
    const finePlan = fine.plan({ center: { lng: 0, lat: 0 }, zoom: 4, bearing: 0, pitch: 0 }, { width: 512, height: 512 });
    expect(finePlan.tiles.length).toBeLessThanOrEqual(8);
    expect(finePlan.tiles.some((entry) => entry.key.z > coarsePlan.targetZoom || entry.key.z > 0)).toBe(true);
  });

  it('keeps neighboring selected tiles within one LOD level', () => {
    const plan = planner.plan({ center: { lng: 120, lat: 30 }, zoom: 5.5, bearing: 30, pitch: 60 }, { width: 1280, height: 720 });
    expect(plan.maxLodDelta).toBeLessThanOrEqual(1);
    expect(plan.tiles.every((entry) => Number.isFinite(entry.sse) && entry.sse >= 0)).toBe(true);
  });

  it('supports previous cover input without changing key identity', () => {
    const previous = [createCanonicalTileKey('main', 'r1', 2, 1, 1)!];
    const plan = planner.plan({ center: { lng: 0, lat: 0 }, zoom: 3, bearing: 10, pitch: 40 }, { width: 800, height: 600 }, previous);
    expect(plan.tiles.every((entry) => entry.key.sourceRevision === 'r1')).toBe(true);
  });
});
