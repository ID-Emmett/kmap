import { describe, expect, it } from 'vitest';

import {
  createIdleMotionSnapshot,
  createInteractionMotionSnapshot,
} from '../src/interaction/motionSnapshot.js';
import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
import { calculateTileCoverage } from '../src/spatial/tileCoverage.js';
import {
  TILE_REFINEMENT_DEBOUNCE_MS,
  TileMotionScheduler,
} from '../src/spatial/tileMotionScheduler.js';
import type { ViewportSize, ViewState } from '../src/types.js';

const SOURCE = normalizeVectorTileSourceOptions({
  id: 'main',
  tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  minZoom: 0,
  maxZoom: 17,
});
const VIEW: ViewState = {
  center: { lng: 116.3946533203125, lat: 39.90552253972854 },
  zoom: 15,
  bearing: 20,
  pitch: 55,
};
const VIEWPORT: ViewportSize = { width: 1280, height: 720 };

describe('TileMotionScheduler', () => {
  it('为 mixed-LOD ideal Coverage 生成最低层级 coarse ancestor', () => {
    const scheduler = new TileMotionScheduler();
    const coverage = calculateTileCoverage(VIEW, VIEWPORT, SOURCE);
    const schedule = scheduler.createSchedule(
      VIEW,
      VIEWPORT,
      SOURCE,
      coverage,
      1_000,
    );
    const minimumZoom = Math.min(
      ...coverage.visible.map((entry) => entry.key.canonical.z),
    );
    const coarse = schedule.entries.filter(
      (entry) => entry.priority.role === 'coverage',
    );

    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.every((entry) => entry.key.canonical.z === minimumZoom)).toBe(true);
    expect(
      coverage.visible.every((target) =>
        coarse.some((entry) => isAncestorOf(entry, target)),
      ),
    ).toBe(true);
  });

  it('运动时仅生成不属于当前 Target 的 leading prefetch，且不标记 visible', () => {
    const scheduler = new TileMotionScheduler();
    const coverage = calculateTileCoverage(VIEW, VIEWPORT, SOURCE);
    scheduler.setMotion(
      createInteractionMotionSnapshot(
        'active',
        1_000,
        { panX: 180_000, panY: 0, bearing: 90, pitch: 0 },
      ),
    );

    const schedule = scheduler.createSchedule(
      VIEW,
      VIEWPORT,
      SOURCE,
      coverage,
      1_000,
    );
    const currentIds = new Set(coverage.visible.map((entry) => canonicalId(entry)));
    const leading = schedule.entries.filter(
      (entry) => entry.priority.role === 'leading-prefetch',
    );

    expect(leading.length).toBeGreaterThan(0);
    expect(leading.every((entry) => entry.kind === 'prefetch')).toBe(true);
    expect(leading.every((entry) => entry.priority.visible === false)).toBe(true);
    expect(leading.every((entry) => !currentIds.has(canonicalId(entry)))).toBe(true);
    expect(schedule.diagnostics.ordinaryPrefetch).toBe(0);
  });

  it('refinement 在最后运动后 debounce，idle 恢复普通 prefetch', () => {
    const scheduler = new TileMotionScheduler();
    const coverage = calculateTileCoverage(VIEW, VIEWPORT, SOURCE);
    scheduler.setMotion(
      createInteractionMotionSnapshot(
        'settling',
        2_000,
        { panX: 60_000, panY: 20_000, bearing: 0, pitch: 0 },
      ),
    );

    const moving = scheduler.createSchedule(
      VIEW,
      VIEWPORT,
      SOURCE,
      coverage,
      2_050,
    );
    const refinements = moving.entries.filter(
      (entry) => entry.priority.role === 'refinement',
    );
    expect(refinements.length).toBeGreaterThan(0);
    expect(
      refinements.every(
        (entry) =>
          entry.priority.notBefore === 2_000 + TILE_REFINEMENT_DEBOUNCE_MS,
      ),
    ).toBe(true);

    scheduler.setMotion(createIdleMotionSnapshot(2_100));
    const idle = scheduler.createSchedule(
      VIEW,
      VIEWPORT,
      SOURCE,
      coverage,
      2_100,
    );
    expect(idle.diagnostics.leadingPrefetch).toBe(0);
    expect(idle.diagnostics.ordinaryPrefetch).toBe(coverage.prefetch.length);
    expect(
      idle.entries
        .filter((entry) => entry.priority.role === 'refinement')
        .every(
          (entry) =>
            entry.priority.notBefore === 2_000 + TILE_REFINEMENT_DEBOUNCE_MS,
        ),
    ).toBe(true);
  });
});

function canonicalId(entry: { key: { canonical: { sourceId: string; z: number; x: number; y: number } } }): string {
  const key = entry.key.canonical;
  return `${key.sourceId}/${key.z}/${key.x}/${key.y}`;
}

function isAncestorOf(
  ancestor: { key: { canonical: { sourceId: string; z: number; x: number; y: number }; wrap: number } },
  descendant: { key: { canonical: { sourceId: string; z: number; x: number; y: number }; wrap: number } },
): boolean {
  const difference = descendant.key.canonical.z - ancestor.key.canonical.z;
  if (difference < 0) {
    return false;
  }
  const scale = 2 ** difference;
  const ancestorGlobalX =
    ancestor.key.canonical.x + ancestor.key.wrap * 2 ** ancestor.key.canonical.z;
  const descendantGlobalX =
    descendant.key.canonical.x + descendant.key.wrap * 2 ** descendant.key.canonical.z;
  return (
    ancestor.key.canonical.sourceId === descendant.key.canonical.sourceId &&
    Math.floor(descendantGlobalX / scale) === ancestorGlobalX &&
    Math.floor(descendant.key.canonical.y / scale) === ancestor.key.canonical.y
  );
}
