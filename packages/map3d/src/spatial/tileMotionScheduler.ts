import {
  createIdleMotionSnapshot,
  predictViewFromMotion,
} from '../interaction/motionSnapshot.js';
import type { InteractionMotionSnapshot } from '../interaction/motionSnapshot.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewportSize, ViewState } from '../types.js';
import {
  getAncestorAtZoom,
  tilesOverlap,
} from './mixedLodTileGeometry.js';
import { calculateTileCoverage } from './tileCoverage.js';
import type {
  TileCoverageEntry,
  TileCoverageResult,
  TilePriorityRole,
} from './tileCoverage.js';
import { renderTileKeyToString } from './tileKey.js';

export const TILE_MOTION_PREDICTION_MS = 240;
export const TILE_REFINEMENT_DEBOUNCE_MS = 180;
export const MAX_LEADING_PREFETCH_TILES = 24;

export interface TileMotionScheduleDiagnostics {
  readonly phase: InteractionMotionSnapshot['phase'];
  readonly coverage: number;
  readonly refinement: number;
  readonly leadingPrefetch: number;
  readonly ordinaryPrefetch: number;
  readonly refinementReadyAt: number;
}

export interface TileMotionSchedule {
  readonly entries: readonly TileCoverageEntry[];
  readonly diagnostics: TileMotionScheduleDiagnostics;
}

/** 将 T017 ideal Coverage 扩展为 coarse-first、预测式内部请求计划。 */
export class TileMotionScheduler {
  #motion = createIdleMotionSnapshot();
  #lastMotionAt = Number.NEGATIVE_INFINITY;

  setMotion(snapshot: InteractionMotionSnapshot): void {
    this.#motion = snapshot;
    if (snapshot.phase !== 'idle') {
      this.#lastMotionAt = snapshot.timeMs;
    }
  }

  reset(timeMs = 0): void {
    this.#motion = createIdleMotionSnapshot(timeMs);
    this.#lastMotionAt = Number.NEGATIVE_INFINITY;
  }

  createSchedule(
    view: ViewState,
    viewport: ViewportSize,
    source: VectorTileSource,
    coverage: TileCoverageResult,
    now: number,
  ): TileMotionSchedule {
    const refinementReadyAt = Number.isFinite(this.#lastMotionAt)
      ? this.#lastMotionAt + TILE_REFINEMENT_DEBOUNCE_MS
      : now;
    const coarse = createCoarseCoverage(coverage.visible);
    const coarseIds = new Set(coarse.map((entry) => renderTileKeyToString(entry.key)));
    const current = coverage.visible.map((entry) => {
      const role: TilePriorityRole = coarseIds.has(renderTileKeyToString(entry.key))
        ? 'coverage'
        : 'refinement';
      return withPriority(
        entry,
        role,
        role === 'refinement' && refinementReadyAt > now
          ? refinementReadyAt
          : undefined,
      );
    });
    const currentIds = new Set(
      current.map((entry) => renderTileKeyToString(entry.key)),
    );
    const coarseOnly = coarse.filter(
      (entry) => !currentIds.has(renderTileKeyToString(entry.key)),
    );
    const leading = this.#motion.phase === 'idle'
      ? []
      : createLeadingPrefetch(
          view,
          viewport,
          source,
          coverage,
          this.#motion,
        );
    const ordinary = this.#motion.phase === 'idle'
      ? coverage.prefetch.map((entry) => withPriority(entry, 'prefetch'))
      : [];
    const entries = mergeScheduleEntries([
      ...current,
      ...coarseOnly,
      ...leading,
      ...ordinary,
    ]);

    return Object.freeze({
      entries: Object.freeze(entries),
      diagnostics: Object.freeze({
        phase: this.#motion.phase,
        coverage: entries.filter((entry) => entry.priority.role === 'coverage').length,
        refinement: entries.filter((entry) => entry.priority.role === 'refinement').length,
        leadingPrefetch: entries.filter(
          (entry) => entry.priority.role === 'leading-prefetch',
        ).length,
        ordinaryPrefetch: entries.filter(
          (entry) => entry.priority.role === 'prefetch',
        ).length,
        refinementReadyAt,
      }),
    });
  }
}

function createCoarseCoverage(
  visible: readonly TileCoverageEntry[],
): TileCoverageEntry[] {
  if (visible.length === 0) {
    return [];
  }
  const zoom = Math.min(...visible.map((entry) => entry.key.canonical.z));
  const entries = new Map<string, TileCoverageEntry>();

  for (const entry of visible) {
    const ancestor = getAncestorAtZoom(entry.key, zoom);
    if (ancestor === undefined) {
      continue;
    }
    const id = renderTileKeyToString(ancestor);
    entries.set(id, {
      key: ancestor,
      kind: 'prefetch',
      priority: {
        role: 'coverage',
        visible: false,
        screenDistance: entry.priority.screenDistance,
      },
    });
  }
  return [...entries.values()];
}

function createLeadingPrefetch(
  view: ViewState,
  viewport: ViewportSize,
  source: VectorTileSource,
  current: TileCoverageResult,
  motion: InteractionMotionSnapshot,
): TileCoverageEntry[] {
  const predictedView = predictViewFromMotion(
    view,
    motion,
    TILE_MOTION_PREDICTION_MS,
  );
  const predicted = calculateTileCoverage(
    predictedView,
    viewport,
    source,
    { previousVisible: current.visible },
  );
  const currentCanonicalIds = new Set(
    current.visible.map((entry) => canonicalId(entry)),
  );

  return predicted.visible
    .filter(
      (candidate) =>
        !currentCanonicalIds.has(canonicalId(candidate)) &&
        !current.visible.some(
          (entry) =>
            candidate.key.canonical.z !== entry.key.canonical.z &&
            tilesOverlap(candidate.key, entry.key),
        ),
    )
    .sort(
      (left, right) =>
        left.priority.screenDistance - right.priority.screenDistance,
    )
    .slice(0, MAX_LEADING_PREFETCH_TILES)
    .map((entry) =>
      withPriority(
        { ...entry, kind: 'prefetch' },
        'leading-prefetch',
      ),
    );
}

function canonicalId(entry: TileCoverageEntry): string {
  const key = entry.key.canonical;
  return `${key.sourceId}/${key.z}/${key.x}/${key.y}`;
}

function withPriority(
  entry: TileCoverageEntry,
  role: TilePriorityRole,
  notBefore?: number,
): TileCoverageEntry {
  return {
    key: entry.key,
    kind: entry.kind,
    priority: {
      role,
      visible: entry.kind === 'visible',
      screenDistance: entry.priority.screenDistance,
      ...(notBefore === undefined ? {} : { notBefore }),
    },
  };
}

function mergeScheduleEntries(
  entries: readonly TileCoverageEntry[],
): TileCoverageEntry[] {
  const merged = new Map<string, TileCoverageEntry>();
  for (const entry of entries) {
    const id = renderTileKeyToString(entry.key);
    const existing = merged.get(id);
    if (existing === undefined) {
      merged.set(id, entry);
      continue;
    }
    const role = roleRank(entry.priority.role) < roleRank(existing.priority.role)
      ? entry.priority.role
      : existing.priority.role;
    const notBefore = Math.min(
      entry.priority.notBefore ?? Number.POSITIVE_INFINITY,
      existing.priority.notBefore ?? Number.POSITIVE_INFINITY,
    );
    const visible = entry.priority.visible || existing.priority.visible;
    merged.set(id, {
      key: existing.key,
      kind: visible ? 'visible' : 'prefetch',
      priority: {
        role,
        visible,
        screenDistance: Math.min(
          entry.priority.screenDistance,
          existing.priority.screenDistance,
        ),
        ...(Number.isFinite(notBefore) ? { notBefore } : {}),
      },
    });
  }
  return [...merged.values()].sort(compareScheduleEntries);
}

function compareScheduleEntries(
  left: TileCoverageEntry,
  right: TileCoverageEntry,
): number {
  const roleDifference = roleRank(left.priority.role) - roleRank(right.priority.role);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  if (left.priority.screenDistance !== right.priority.screenDistance) {
    return left.priority.screenDistance - right.priority.screenDistance;
  }
  return renderTileKeyToString(left.key).localeCompare(renderTileKeyToString(right.key));
}

function roleRank(role: TilePriorityRole): number {
  if (role === 'coverage') {
    return 0;
  }
  if (role === 'refinement') {
    return 1;
  }
  return role === 'leading-prefetch' ? 2 : 3;
}
