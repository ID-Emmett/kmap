import { PerspectiveCamera } from 'three/webgpu';

import {
  intersectCameraRayWithGround,
  sceneGroundToMercator,
  updateMapCamera,
} from '../rendering/mapCamera.js';
import { normalizeViewport } from '../rendering/viewport.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewportSize, ViewState } from '../types.js';
import {
  calculateTileScreenDistance,
  tilesOverlap,
} from './mixedLodTileGeometry.js';
import {
  selectMixedLodTiles,
} from './mixedLodTileSelector.js';
import type {
  MixedLodSelectionDiagnostics,
  MixedLodTileSelection,
} from './mixedLodTileSelector.js';
import { selectMapOrigin } from './mapOrigin.js';
import { tileIntersectsSourceBounds } from './tileCoverageBounds.js';
import { mercatorPointToTilePoint } from './tileCoverageGeometry.js';
import type { TilePoint } from './tileCoverageGeometry.js';
import {
  createRenderTileKey,
  renderTileKeyToString,
  resolveDataZoom,
} from './tileKey.js';
import type { MapOrigin, MercatorPoint, RenderTileKey } from './types.js';
import { normalizeViewState } from './viewState.js';

const DEFAULT_MAX_TILES = 128;
const PREFETCH_RING = 1;

export type TilePriorityRole =
  | 'coverage'
  | 'refinement'
  | 'leading-prefetch'
  | 'prefetch';

export interface TilePriorityInput {
  role: TilePriorityRole;
  visible: boolean;
  screenDistance: number;
  coverageRank?: number;
  notBefore?: number;
}

export interface TileCoverageEntry {
  key: RenderTileKey;
  kind: 'visible' | 'prefetch';
  priority: TilePriorityInput;
}

export interface TileCoverageResult {
  referenceZoom: number;
  origin: MapOrigin;
  footprint: readonly TilePoint[];
  maxGroundDistance: number;
  tiles: readonly TileCoverageEntry[];
  visible: readonly TileCoverageEntry[];
  prefetch: readonly TileCoverageEntry[];
  truncated: boolean;
  diagnostics: MixedLodSelectionDiagnostics;
}

export interface TileCoverageOptions {
  maxTiles?: number;
  previousVisible?: readonly TileCoverageEntry[];
  refineThresholdPixels?: number;
  coarsenThresholdPixels?: number;
  maxNeighborZoomDifference?: number;
}

/** 计算 mixed-LOD Target Coverage、prefetch 和静态调度优先级。 */
export function calculateTileCoverage(
  view: ViewState,
  viewport: ViewportSize,
  source: VectorTileSource,
  options: TileCoverageOptions = {},
): TileCoverageResult {
  const normalizedView = normalizeViewState(view);
  const normalizedViewport = normalizeViewport(viewport);
  const maxTiles = normalizeMaxTiles(options.maxTiles);
  const referenceZoom = resolveDataZoom(
    normalizedView.zoom,
    source.minZoom,
    source.maxZoom,
  );
  const origin = selectMapOrigin(normalizedView.center, referenceZoom);
  const camera = new PerspectiveCamera();
  updateMapCamera(camera, normalizedView, normalizedViewport, origin);
  const maxGroundDistance = camera.far;
  const footprintMercator = getGroundFootprint(
    camera,
    origin,
    maxGroundDistance,
  );
  const footprint = footprintMercator.map((point) =>
    mercatorPointToTilePoint(point, referenceZoom),
  );
  const selection = selectMixedLodTiles({
    camera,
    origin,
    viewport: normalizedViewport,
    source,
    footprint: footprintMercator,
    maxZoom: referenceZoom,
    maxTiles,
    ...(options.previousVisible === undefined
      ? {}
      : { previous: options.previousVisible.map((entry) => entry.key) }),
    ...(options.refineThresholdPixels === undefined
      ? {}
      : { refineThresholdPixels: options.refineThresholdPixels }),
    ...(options.coarsenThresholdPixels === undefined
      ? {}
      : { coarsenThresholdPixels: options.coarsenThresholdPixels }),
    ...(options.maxNeighborZoomDifference === undefined
      ? {}
      : { maxNeighborZoomDifference: options.maxNeighborZoomDifference }),
  });
  const minimumZoom = selection.tiles.reduce(
    (minimum, tile) => Math.min(minimum, tile.key.canonical.z),
    Number.POSITIVE_INFINITY,
  );
  const visible = selection.tiles
    .map((tile) => createVisibleEntry(tile, minimumZoom))
    .sort(compareCoverageEntries);
  const visibleKeys = new Set(
    visible.map((entry) => renderTileKeyToString(entry.key)),
  );
  const prefetchCandidates = collectPrefetchTiles(
    visible,
    visibleKeys,
    source,
    camera,
    origin,
    normalizedViewport,
  );
  const remaining = Math.max(0, maxTiles - visible.length);
  const prefetch = prefetchCandidates.slice(0, remaining);
  const tiles = [...visible, ...prefetch].sort(compareCoverageEntries);
  const truncated =
    selection.diagnostics.budgetLimited ||
    selection.diagnostics.budgetExceeded ||
    prefetchCandidates.length > prefetch.length;

  return Object.freeze({
    referenceZoom,
    origin,
    footprint: Object.freeze(footprint),
    maxGroundDistance,
    tiles: Object.freeze(tiles),
    visible: Object.freeze(visible),
    prefetch: Object.freeze(prefetch),
    truncated,
    diagnostics: selection.diagnostics,
  });
}

function getGroundFootprint(
  camera: PerspectiveCamera,
  origin: MapOrigin,
  maxGroundDistance: number,
): MercatorPoint[] {
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const;

  return corners.map(([x, y]) =>
    sceneGroundToMercator(
      intersectCameraRayWithGround(camera, x, y, maxGroundDistance),
      origin,
    ),
  );
}

function createVisibleEntry(
  tile: MixedLodTileSelection,
  minimumZoom: number,
): TileCoverageEntry {
  return Object.freeze({
    key: tile.key,
    kind: 'visible' as const,
    priority: Object.freeze({
      role: tile.key.canonical.z === minimumZoom ? 'coverage' : 'refinement',
      visible: true,
      screenDistance: tile.screenDistance,
    }),
  });
}

function collectPrefetchTiles(
  visible: readonly TileCoverageEntry[],
  visibleKeys: ReadonlySet<string>,
  source: VectorTileSource,
  camera: PerspectiveCamera,
  origin: MapOrigin,
  viewport: Required<ViewportSize>,
): TileCoverageEntry[] {
  const candidates = new Map<string, TileCoverageEntry>();

  for (const entry of visible) {
    const key = entry.key;
    const scale = 2 ** key.canonical.z;
    const renderX = key.canonical.x + key.wrap * scale;

    for (let yOffset = -PREFETCH_RING; yOffset <= PREFETCH_RING; yOffset += 1) {
      for (let xOffset = -PREFETCH_RING; xOffset <= PREFETCH_RING; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) {
          continue;
        }
        const candidate = createRenderTileKey(
          source.id,
          key.canonical.z,
          renderX + xOffset,
          key.canonical.y + yOffset,
        );
        if (
          candidate === undefined ||
          !tileIntersectsSourceBounds(candidate, source.bounds)
        ) {
          continue;
        }
        const id = renderTileKeyToString(candidate);
        if (
          visibleKeys.has(id) ||
          visible.some((visibleEntry) => tilesOverlap(candidate, visibleEntry.key))
        ) {
          continue;
        }
        candidates.set(id, {
          key: candidate,
          kind: 'prefetch',
          priority: {
            role: 'prefetch',
            visible: false,
            screenDistance: calculateTileScreenDistance(
              camera,
              viewport,
              origin,
              candidate,
            ),
          },
        });
      }
    }
  }

  const accepted: TileCoverageEntry[] = [];
  for (const candidate of [...candidates.values()].sort(compareCoverageEntries)) {
    if (!accepted.some((entry) => tilesOverlap(candidate.key, entry.key))) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

function compareCoverageEntries(
  left: TileCoverageEntry,
  right: TileCoverageEntry,
): number {
  const roleDifference = priorityRoleRank(left.priority.role) -
    priorityRoleRank(right.priority.role);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  if (left.priority.screenDistance !== right.priority.screenDistance) {
    return left.priority.screenDistance - right.priority.screenDistance;
  }
  return renderTileKeyToString(left.key).localeCompare(
    renderTileKeyToString(right.key),
  );
}

function priorityRoleRank(role: TilePriorityRole): number {
  if (role === 'coverage') {
    return 0;
  }
  if (role === 'refinement') {
    return 1;
  }
  return role === 'leading-prefetch' ? 2 : 3;
}

function normalizeMaxTiles(value: number | undefined): number {
  const maxTiles = value ?? DEFAULT_MAX_TILES;
  if (!Number.isSafeInteger(maxTiles) || maxTiles < 1) {
    throw new RangeError('maxTiles 必须是正安全整数。');
  }
  return maxTiles;
}
