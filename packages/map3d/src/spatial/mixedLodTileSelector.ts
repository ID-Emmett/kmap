import type { Frustum, PerspectiveCamera } from 'three/webgpu';

import { normalizeViewport } from '../rendering/viewport.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewportSize } from '../types.js';
import {
  areEdgeNeighbors,
  calculateProjectedTileSize,
  calculateTileScreenDistance,
  createCameraFrustum,
  getAncestorAtZoom,
  isDescendantOf,
  tileIntersectsFrustum,
} from './mixedLodTileGeometry.js';
import { tileIntersectsSourceBounds } from './tileCoverageBounds.js';
import {
  getTilePolygonBounds,
  mercatorPointToTilePoint,
  tileRectangleIntersectsPolygon,
} from './tileCoverageGeometry.js';
import type { TilePoint } from './tileCoverageGeometry.js';
import {
  createRenderTileKey,
  renderTileKeyToString,
} from './tileKey.js';
import type { MapOrigin, MercatorPoint, RenderTileKey } from './types.js';

const DEFAULT_REFINE_THRESHOLD_PIXELS = 320;
const DEFAULT_COARSEN_THRESHOLD_PIXELS = 224;
const DEFAULT_MAX_NEIGHBOR_ZOOM_DIFFERENCE = 1;

export interface MixedLodTileSelection {
  key: RenderTileKey;
  projectedSize: number;
  screenDistance: number;
}

export interface MixedLodSelectionDiagnostics {
  candidateCount: number;
  evaluatedCount: number;
  refinedCount: number;
  coarsenedCount: number;
  budgetLimited: boolean;
  budgetExceeded: boolean;
  zoomDistribution: readonly Readonly<{ zoom: number; count: number }>[];
}

export interface MixedLodTileSelectorInput {
  camera: PerspectiveCamera;
  origin: MapOrigin;
  viewport: ViewportSize;
  source: VectorTileSource;
  footprint: readonly MercatorPoint[];
  maxZoom: number;
  maxTiles: number;
  previous?: readonly RenderTileKey[];
  refineThresholdPixels?: number;
  coarsenThresholdPixels?: number;
  maxNeighborZoomDifference?: number;
}

export interface MixedLodTileSelectorResult {
  tiles: readonly MixedLodTileSelection[];
  diagnostics: MixedLodSelectionDiagnostics;
}

interface SelectorContext {
  camera: PerspectiveCamera;
  frustum: Frustum;
  origin: MapOrigin;
  viewport: Required<ViewportSize>;
  source: VectorTileSource;
  footprint: readonly MercatorPoint[];
  footprintByZoom: Map<number, readonly TilePoint[]>;
}

/** 从粗层级开始按屏幕误差细分，并在预算内保持完整、非重叠 Coverage。 */
export function selectMixedLodTiles(
  input: MixedLodTileSelectorInput,
): MixedLodTileSelectorResult {
  const maxTiles = requirePositiveInteger(input.maxTiles, 'maxTiles');
  const maxZoom = requireZoomInSource(input.maxZoom, input.source);
  const refineThreshold = requirePositiveFinite(
    input.refineThresholdPixels ?? DEFAULT_REFINE_THRESHOLD_PIXELS,
    'refineThresholdPixels',
  );
  const coarsenThreshold = requirePositiveFinite(
    input.coarsenThresholdPixels ?? DEFAULT_COARSEN_THRESHOLD_PIXELS,
    'coarsenThresholdPixels',
  );
  if (coarsenThreshold >= refineThreshold) {
    throw new RangeError('coarsenThresholdPixels 必须小于 refineThresholdPixels。');
  }
  const maxNeighborZoomDifference = requireNonNegativeInteger(
    input.maxNeighborZoomDifference ?? DEFAULT_MAX_NEIGHBOR_ZOOM_DIFFERENCE,
    'maxNeighborZoomDifference',
  );
  const context = createSelectorContext(input);
  const roots = collectIntersectingTilesAtZoom(
    context,
    input.source.minZoom,
  ).map((key) => createSelection(context, key));
  const selected = new Map(
    roots.map((tile) => [renderTileKeyToString(tile.key), tile]),
  );
  const queue = [...roots];
  const previous = input.previous ?? [];
  let evaluatedCount = 0;
  let refinedCount = 0;
  let budgetLimited = false;

  while (queue.length > 0) {
    queue.sort(compareRefinementPriority);
    const tile = queue.shift();
    if (
      tile === undefined ||
      selected.get(renderTileKeyToString(tile.key)) !== tile ||
      tile.key.canonical.z >= maxZoom
    ) {
      continue;
    }

    evaluatedCount += 1;
    const threshold = wasPreviouslyRefined(tile.key, previous)
      ? coarsenThreshold
      : refineThreshold;
    if (tile.projectedSize <= threshold) {
      continue;
    }

    const children = collectVisibleChildren(context, tile.key).map((key) =>
      createSelection(context, key),
    );
    if (children.length === 0) {
      continue;
    }
    const nextCount = selected.size - 1 + children.length;
    if (nextCount > maxTiles) {
      budgetLimited = true;
      continue;
    }

    selected.delete(renderTileKeyToString(tile.key));
    for (const child of children) {
      selected.set(renderTileKeyToString(child.key), child);
      queue.push(child);
    }
    refinedCount += 1;
  }

  const coarsenedCount = balanceNeighborZooms(
    selected,
    context,
    maxNeighborZoomDifference,
  );
  const tiles = [...selected.values()].sort(compareSelectionStable);
  const candidateCount = collectIntersectingTilesAtZoom(
    context,
    maxZoom,
  ).length;

  return Object.freeze({
    tiles: Object.freeze(tiles),
    diagnostics: Object.freeze({
      candidateCount,
      evaluatedCount,
      refinedCount,
      coarsenedCount,
      budgetLimited,
      budgetExceeded: tiles.length > maxTiles,
      zoomDistribution: Object.freeze(createZoomDistribution(tiles)),
    }),
  });
}

function createSelectorContext(
  input: MixedLodTileSelectorInput,
): SelectorContext {
  return {
    camera: input.camera,
    frustum: createCameraFrustum(input.camera),
    origin: input.origin,
    viewport: normalizeViewport(input.viewport),
    source: input.source,
    footprint: input.footprint,
    footprintByZoom: new Map(),
  };
}

function collectIntersectingTilesAtZoom(
  context: SelectorContext,
  zoom: number,
): RenderTileKey[] {
  const polygon = getFootprintAtZoom(context, zoom);
  const bounds = getTilePolygonBounds(polygon);
  const scale = 2 ** zoom;
  const minY = Math.max(0, bounds.minY);
  const maxY = Math.min(scale - 1, bounds.maxY);
  const keys: RenderTileKey[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!tileRectangleIntersectsPolygon(x, y, polygon)) {
        continue;
      }
      const key = createRenderTileKey(context.source.id, zoom, x, y);
      if (
        key === undefined ||
        !tileIntersectsSourceBounds(key, context.source.bounds) ||
        !tileIntersectsFrustum(context.frustum, context.origin, key)
      ) {
        continue;
      }
      keys.push(key);
    }
  }

  return keys;
}

function collectVisibleChildren(
  context: SelectorContext,
  parent: RenderTileKey,
): RenderTileKey[] {
  const childZoom = parent.canonical.z + 1;
  const globalX =
    parent.canonical.x + parent.wrap * 2 ** parent.canonical.z;
  const polygon = getFootprintAtZoom(context, childZoom);
  const keys: RenderTileKey[] = [];

  for (let yOffset = 0; yOffset < 2; yOffset += 1) {
    for (let xOffset = 0; xOffset < 2; xOffset += 1) {
      const x = globalX * 2 + xOffset;
      const y = parent.canonical.y * 2 + yOffset;
      if (!tileRectangleIntersectsPolygon(x, y, polygon)) {
        continue;
      }
      const key = createRenderTileKey(context.source.id, childZoom, x, y);
      if (
        key === undefined ||
        !tileIntersectsSourceBounds(key, context.source.bounds) ||
        !tileIntersectsFrustum(context.frustum, context.origin, key)
      ) {
        continue;
      }
      keys.push(key);
    }
  }

  return keys;
}

function getFootprintAtZoom(
  context: SelectorContext,
  zoom: number,
): readonly TilePoint[] {
  let polygon = context.footprintByZoom.get(zoom);
  if (polygon === undefined) {
    polygon = Object.freeze(
      context.footprint.map((point) => mercatorPointToTilePoint(point, zoom)),
    );
    context.footprintByZoom.set(zoom, polygon);
  }
  return polygon;
}

function createSelection(
  context: SelectorContext,
  key: RenderTileKey,
): MixedLodTileSelection {
  return {
    key,
    projectedSize: calculateProjectedTileSize(
      context.camera,
      context.viewport,
      context.origin,
      key,
    ),
    screenDistance: calculateTileScreenDistance(
      context.camera,
      context.viewport,
      context.origin,
      key,
    ),
  };
}

function compareRefinementPriority(
  left: MixedLodTileSelection,
  right: MixedLodTileSelection,
): number {
  if (left.projectedSize !== right.projectedSize) {
    return right.projectedSize - left.projectedSize;
  }
  if (left.screenDistance !== right.screenDistance) {
    return left.screenDistance - right.screenDistance;
  }
  return compareSelectionStable(left, right);
}

function compareSelectionStable(
  left: MixedLodTileSelection,
  right: MixedLodTileSelection,
): number {
  return renderTileKeyToString(left.key).localeCompare(
    renderTileKeyToString(right.key),
  );
}

function wasPreviouslyRefined(
  key: RenderTileKey,
  previous: readonly RenderTileKey[],
): boolean {
  return previous.some(
    (candidate) =>
      candidate.canonical.z > key.canonical.z &&
      isDescendantOf(candidate, key),
  );
}

function balanceNeighborZooms(
  selected: Map<string, MixedLodTileSelection>,
  context: SelectorContext,
  maxDifference: number,
): number {
  let coarsenedCount = 0;

  while (true) {
    const tiles = [...selected.values()];
    let fineTile: MixedLodTileSelection | undefined;
    let targetZoom = -1;

    for (let leftIndex = 0; leftIndex < tiles.length; leftIndex += 1) {
      const left = tiles[leftIndex];
      if (left === undefined) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < tiles.length; rightIndex += 1) {
        const right = tiles[rightIndex];
        if (right === undefined || !areEdgeNeighbors(left.key, right.key)) {
          continue;
        }
        const difference = Math.abs(
          left.key.canonical.z - right.key.canonical.z,
        );
        if (difference <= maxDifference) {
          continue;
        }
        const coarse =
          left.key.canonical.z < right.key.canonical.z ? left : right;
        fineTile = coarse === left ? right : left;
        targetZoom = coarse.key.canonical.z + maxDifference;
        break;
      }
      if (fineTile !== undefined) {
        break;
      }
    }

    if (fineTile === undefined) {
      return coarsenedCount;
    }
    const ancestor = getAncestorAtZoom(fineTile.key, targetZoom);
    if (ancestor === undefined) {
      return coarsenedCount;
    }
    for (const [id, tile] of selected) {
      if (isDescendantOf(tile.key, ancestor)) {
        selected.delete(id);
      }
    }
    const replacement = createSelection(context, ancestor);
    selected.set(renderTileKeyToString(ancestor), replacement);
    coarsenedCount += 1;
  }
}

function createZoomDistribution(
  tiles: readonly MixedLodTileSelection[],
): Array<Readonly<{ zoom: number; count: number }>> {
  const counts = new Map<number, number>();
  for (const tile of tiles) {
    const zoom = tile.key.canonical.z;
    counts.set(zoom, (counts.get(zoom) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([zoom, count]) => Object.freeze({ zoom, count }));
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} 必须是正安全整数。`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} 必须是非负安全整数。`);
  }
  return value;
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必须是正有限数值。`);
  }
  return value;
}

function requireZoomInSource(zoom: number, source: VectorTileSource): number {
  if (
    !Number.isSafeInteger(zoom) ||
    zoom < source.minZoom ||
    zoom > source.maxZoom
  ) {
    throw new RangeError('maxZoom 必须位于 source minZoom/maxZoom 范围内。');
  }
  return zoom;
}
