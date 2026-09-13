import type { TileCoverageEntry, TilePriorityRole } from '../spatial/tileCoverage.js';
import { createRenderTileKey, renderTileKeyToString, resolveDataZoom } from '../spatial/tileKey.js';
import { lngLatToTilePosition } from '../spatial/mercator.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewState, ViewportSize } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import { tileIntersectsSourceBounds } from '../spatial/tileCoverageBounds.js';

export interface TileCoverSelectorInput {
  view: ViewState;
  viewport: ViewportSize;
  source: VectorTileSource;
  maxTiles?: number;
  guardBandTiles?: number;
  prefetchRing?: number;
  previous?: readonly RenderTileKey[];
}

export interface TileCoverSelection {
  referenceZoom: number;
  visible: readonly TileCoverageEntry[];
  prefetch: readonly TileCoverageEntry[];
  tiles: readonly TileCoverageEntry[];
  diagnostics: Readonly<{
    candidateCount: number;
    visibleCount: number;
    prefetchCount: number;
    truncated: boolean;
  }>;
}

/** 根据视图中心、视口尺寸和 guard band 生成稳定、可复用的 Tile cover。 */
export class TileCoverSelector {
  select(input: TileCoverSelectorInput): TileCoverSelection {
    const referenceZoom = resolveDataZoom(
      input.view.zoom,
      input.source.minZoom,
      input.source.maxZoom,
    );
    const maxTiles = normalizePositiveInteger(input.maxTiles ?? 128, 'maxTiles');
    const guardBand = normalizeNonNegativeInteger(input.guardBandTiles ?? 1, 'guardBandTiles');
    const prefetchRing = normalizeNonNegativeInteger(input.prefetchRing ?? 1, 'prefetchRing');
    const center = lngLatToTilePosition(input.view.center, referenceZoom);
    const tilePixels = 256;
    const radiusX = Math.max(1, Math.ceil(input.viewport.width / tilePixels / 2) + guardBand);
    const radiusY = Math.max(1, Math.ceil(input.viewport.height / tilePixels / 2) + guardBand);
    const candidates: TileCoverageEntry[] = [];
    const seen = new Set<string>();
    for (let y = Math.floor(center.y) - radiusY; y <= Math.floor(center.y) + radiusY; y += 1) {
      for (let x = Math.floor(center.x) - radiusX; x <= Math.floor(center.x) + radiusX; x += 1) {
        const key = createRenderTileKey(input.source.id, referenceZoom, x, y);
        if (key === undefined || !tileIntersectsSourceBounds(key, input.source.bounds)) {
          continue;
        }
        const id = renderTileKeyToString(key);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        candidates.push(createEntry(key, center.x, center.y, 'coverage', true));
      }
    }
    candidates.sort(compareEntries);
    const visible = candidates.slice(0, maxTiles);
    const visibleIds = new Set(visible.map((entry) => renderTileKeyToString(entry.key)));
    const prefetchCandidates: TileCoverageEntry[] = [];
    const prefetchSeen = new Set<string>();
    for (const entry of visible) {
      const key = entry.key;
      const globalX = key.canonical.x + key.wrap * 2 ** key.canonical.z;
      for (let yOffset = -prefetchRing; yOffset <= prefetchRing; yOffset += 1) {
        for (let xOffset = -prefetchRing; xOffset <= prefetchRing; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const candidate = createRenderTileKey(
            input.source.id,
            key.canonical.z,
            globalX + xOffset,
            key.canonical.y + yOffset,
          );
          if (candidate === undefined || !tileIntersectsSourceBounds(candidate, input.source.bounds)) continue;
          const id = renderTileKeyToString(candidate);
          if (visibleIds.has(id) || prefetchSeen.has(id)) continue;
          prefetchSeen.add(id);
          prefetchCandidates.push(createEntry(candidate, center.x, center.y, 'prefetch', false));
        }
      }
    }
    prefetchCandidates.sort(compareEntries);
    const prefetch = prefetchCandidates.slice(0, Math.max(0, maxTiles - visible.length));
    const tiles = [...visible, ...prefetch];
    return Object.freeze({
      referenceZoom,
      visible: Object.freeze(visible),
      prefetch: Object.freeze(prefetch),
      tiles: Object.freeze(tiles),
      diagnostics: Object.freeze({
        candidateCount: candidates.length,
        visibleCount: visible.length,
        prefetchCount: prefetch.length,
        truncated: candidates.length > visible.length || prefetchCandidates.length > prefetch.length,
      }),
    });
  }
}

function createEntry(
  key: RenderTileKey,
  centerX: number,
  centerY: number,
  role: TilePriorityRole,
  visible: boolean,
): TileCoverageEntry {
  const scale = 2 ** key.canonical.z;
  const globalX = key.canonical.x + key.wrap * scale;
  const dx = globalX + 0.5 - centerX;
  const dy = key.canonical.y + 0.5 - centerY;
  return {
    key,
    kind: visible ? 'visible' : 'prefetch',
    priority: {
      role,
      visible,
      screenDistance: Math.hypot(dx, dy),
      coverageRank: Math.round(Math.hypot(dx, dy) * 1_000),
    },
  };
}

function compareEntries(left: TileCoverageEntry, right: TileCoverageEntry): number {
  if (left.priority.screenDistance !== right.priority.screenDistance) {
    return left.priority.screenDistance - right.priority.screenDistance;
  }
  return renderTileKeyToString(left.key).localeCompare(renderTileKeyToString(right.key));
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`);
  return value;
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} 必须是非负安全整数。`);
  return value;
}
