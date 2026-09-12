import type { InteractionMotionSnapshot } from '../interaction/motionSnapshot.js';
import {
  createIdleMotionSnapshot,
  predictViewFromMotion,
} from '../interaction/motionSnapshot.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewportSize, ViewState } from '../types.js';
import {
  getAncestorAtZoom,
  tilesOverlap,
} from '../spatial/mixedLodTileGeometry.js';
import { calculateTileCoverage } from '../spatial/tileCoverage.js';
import type {
  TileCoverageEntry,
  TileCoverageResult,
  TilePriorityRole,
} from '../spatial/tileCoverage.js';
import { renderTileKeyToString } from '../spatial/tileKey.js';

export const TILE_ENGINE_V2_PREDICTION_MS = 240;
export const TILE_ENGINE_V2_MAX_LEADING_PREFETCH_TILES = 24;
const TILE_ENGINE_V2_FAIRNESS_LANES = 4;

export interface TileEngineV2Schedule {
  readonly entries: readonly TileCoverageEntry[];
  readonly diagnostics: Readonly<{
    phase: InteractionMotionSnapshot['phase'];
    coverage: number;
    refinement: number;
    leadingPrefetch: number;
    ordinaryPrefetch: number;
    refinementReadyAt: number;
    delayedByNotBefore: number;
  }>;
}

/** V2 内部请求计划：coverage-critical、refinement、leading prefetch、ordinary prefetch。 */
export class TileEngineV2Scheduler {
  #motion = createIdleMotionSnapshot();

  setMotion(snapshot: InteractionMotionSnapshot): void {
    this.#motion = snapshot;
  }

  reset(timeMs = 0): void {
    this.#motion = createIdleMotionSnapshot(timeMs);
  }

  createSchedule(
    view: ViewState,
    viewport: ViewportSize,
    source: VectorTileSource,
    coverage: TileCoverageResult,
    now: number,
  ): TileEngineV2Schedule {
    const refinementReadyAt = now;
    const coarse = createCoarseCoverage(coverage.visible);
    const coarseIds = new Set(coarse.map((entry) => renderTileKeyToString(entry.key)));
    const current = coverage.visible.map((entry) => {
      const role: TilePriorityRole = coarseIds.has(renderTileKeyToString(entry.key))
        ? 'coverage'
        : 'refinement';
      return withPriority(entry, role);
    });
    const currentIds = new Set(current.map((entry) => renderTileKeyToString(entry.key)));
    const coarseOnly = coarse.filter(
      (entry) => !currentIds.has(renderTileKeyToString(entry.key)),
    );
    const leading = this.#motion.phase === 'idle'
      ? []
      : createLeadingPrefetch(view, viewport, source, coverage, this.#motion);
    // 运动中保留一圈普通预取；预算压力由 Engine 的高低水位策略抑制，不能因运动阶段无条件归零。
    const ordinary = coverage.prefetch.map((entry) => withPriority(entry, 'prefetch'));
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
        leadingPrefetch: entries.filter((entry) => entry.priority.role === 'leading-prefetch').length,
        ordinaryPrefetch: entries.filter((entry) => entry.priority.role === 'prefetch').length,
        refinementReadyAt,
        delayedByNotBefore: entries.filter(
          (entry) => (entry.priority.notBefore ?? 0) > now,
        ).length,
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
    entries.set(renderTileKeyToString(ancestor), {
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
  const predictedView = predictViewFromMotion(view, motion, TILE_ENGINE_V2_PREDICTION_MS);
  const predicted = calculateTileCoverage(predictedView, viewport, source, {
    previousVisible: current.visible,
  });
  const currentCanonicalIds = new Set(current.visible.map(canonicalId));
  return selectFairEntries(
    predicted.visible.filter((candidate) =>
      !currentCanonicalIds.has(canonicalId(candidate)) &&
      !current.visible.some((entry) =>
        candidate.key.canonical.z !== entry.key.canonical.z &&
        tilesOverlap(candidate.key, entry.key),
      ),
    ),
    TILE_ENGINE_V2_MAX_LEADING_PREFETCH_TILES,
  )
    .map((entry) => withPriority({ ...entry, kind: 'prefetch' }, 'leading-prefetch'));
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

function mergeScheduleEntries(entries: readonly TileCoverageEntry[]): TileCoverageEntry[] {
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
  return assignFairCoverageRanks([...merged.values()]).sort(compareScheduleEntries);
}

function compareScheduleEntries(left: TileCoverageEntry, right: TileCoverageEntry): number {
  const roleDifference = roleRank(left.priority.role) - roleRank(right.priority.role);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  const rankDifference =
    (left.priority.coverageRank ?? Number.MAX_SAFE_INTEGER) -
    (right.priority.coverageRank ?? Number.MAX_SAFE_INTEGER);
  if (rankDifference !== 0) {
    return rankDifference;
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

function assignFairCoverageRanks(
  entries: readonly TileCoverageEntry[],
): TileCoverageEntry[] {
  const ranks = new Map<string, number>();
  const roles: readonly TilePriorityRole[] = [
    'coverage',
    'refinement',
    'leading-prefetch',
    'prefetch',
  ];
  for (const role of roles) {
    selectFairEntries(
      entries.filter((entry) => entry.priority.role === role),
    ).forEach((entry, index) => {
      ranks.set(renderTileKeyToString(entry.key), index);
    });
  }
  return entries.map((entry) => ({
    ...entry,
    priority: {
      ...entry.priority,
      coverageRank: ranks.get(renderTileKeyToString(entry.key)) ??
        Number.MAX_SAFE_INTEGER,
    },
  }));
}

function selectFairEntries(
  entries: readonly TileCoverageEntry[],
  limit = entries.length,
): TileCoverageEntry[] {
  const sorted = [...entries].sort(compareByScreenDistance);
  const laneCount = Math.min(TILE_ENGINE_V2_FAIRNESS_LANES, sorted.length);
  if (laneCount <= 1) {
    return sorted.slice(0, limit);
  }
  const laneSize = Math.ceil(sorted.length / laneCount);
  const selected: TileCoverageEntry[] = [];
  for (let offset = 0; offset < laneSize && selected.length < limit; offset += 1) {
    for (let lane = 0; lane < laneCount && selected.length < limit; lane += 1) {
      const entry = sorted[lane * laneSize + offset];
      if (entry !== undefined) {
        selected.push(entry);
      }
    }
  }
  return selected;
}

function compareByScreenDistance(
  left: TileCoverageEntry,
  right: TileCoverageEntry,
): number {
  if (left.priority.screenDistance !== right.priority.screenDistance) {
    return left.priority.screenDistance - right.priority.screenDistance;
  }
  return renderTileKeyToString(left.key).localeCompare(renderTileKeyToString(right.key));
}
