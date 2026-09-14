import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { MixedLODPlanner } from '../src/nova-tile/lod/index.js';

const planner = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 8, tileBudget: 24 });
const productionView = { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15, bearing: 0, pitch: 0 } as const;
const productionViewport = { width: 800, height: 600 } as const;

function levels(plan: { readonly tiles: readonly { readonly key: { readonly z: number } }[] }): readonly number[] {
  return [...new Set(plan.tiles.map((entry) => entry.key.z))].sort((left, right) => left - right);
}

describe('NTE mixed LOD planner', () => {
  it('seeds the D033 bootstrap zoom and clamps it to source bounds', () => {
    const noRefinement = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 17, tileBudget: 96, refineThresholdPx: 1e12 });
    const highZoom = noRefinement.plan(productionView, productionViewport);
    expect(levels(highZoom)).toEqual([13]);

    const minZoom = noRefinement.plan({ ...productionView, zoom: 0 }, productionViewport);
    expect(levels(minZoom)).toEqual([0]);

    const lowZoom = noRefinement.plan({ ...productionView, zoom: 1 }, productionViewport);
    expect(levels(lowZoom)).toEqual([0]);

    const bounded = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 5, maxZoom: 12, tileBudget: 96, refineThresholdPx: 1e12 });
    expect(levels(bounded.plan(productionView, productionViewport))).toEqual([12]);
    expect(levels(bounded.plan({ ...productionView, zoom: 3 }, productionViewport))).toEqual([5]);
  });

  it('refines the production high-zoom view beyond bootstrap without root-only coverage', () => {
    const plan = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 17, tileBudget: 96 }).plan(productionView, productionViewport);
    expect(plan.targetZoom).toBe(15);
    expect(plan.tiles.some((entry) => entry.key.z >= 13)).toBe(true);
    expect(plan.tiles.some((entry) => entry.key.z >= 15)).toBe(true);
    expect(plan.tiles.every((entry) => entry.key.z > 0)).toBe(true);
    expect(plan.tiles.length).toBeLessThanOrEqual(96);
    expect(plan.coverageComplete).toBe(true);
    expect(plan.maxLodDelta).toBeLessThanOrEqual(1);
  });

  it.each([0, 20, 40, 60])('keeps production coverage complete at pitch %i', (pitch) => {
    const plan = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 17, tileBudget: 96 }).plan({ ...productionView, pitch }, productionViewport);
    expect(plan.coverageComplete).toBe(true);
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.length).toBeLessThanOrEqual(96);
    expect(plan.maxLodDelta).toBeLessThanOrEqual(1);
  });

  it('honors exact source maxZoom and tight budgets', () => {
    const plannerAtMax = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 12, tileBudget: 24 });
    const plan = plannerAtMax.plan(productionView, productionViewport);
    expect(plan.targetZoom).toBe(12);
    expect(plan.tiles.every((entry) => entry.key.z <= 12)).toBe(true);
    expect(plan.coverageComplete).toBe(true);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);

    const tight = new MixedLODPlanner({ sourceId: 'main', sourceRevision: 'r1', minZoom: 0, maxZoom: 17, tileBudget: 8 }).plan(productionView, productionViewport);
    expect(tight.tiles.length).toBeLessThanOrEqual(8);
    expect(tight.coverageComplete).toBe(true);
    expect(tight.maxLodDelta).toBeLessThanOrEqual(1);
  });

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
    expect(plan.coverageComplete).toBe(true);
    expect(plan.maxLodDelta).toBeLessThanOrEqual(1);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);
  });
});
