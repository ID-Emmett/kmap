import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import {
  canonicalTileKeyToString,
  createRenderTileKey,
  renderTileKeyToString,
} from '../spatial/tileKey.js';
import type { RenderTileKey } from '../spatial/types.js';
import type { DisplaySelectionKeyView } from './displayCoverageReplacement.js';
import type { TileEngineV2DisplayRecord } from './tileEngineV2DisplayCoordinator.js';
import {
  findReadyDescendants,
  isRenderTileAncestor,
} from './displayCoverageSpatial.js';
import { flattenSelectionKeys } from './displayCoverageReplacement.js';

/** 判断 ready parent 下的所有目标 child 是否已经可同帧替换。 */
export function isAncestorReplacementComplete(
  fallback: RenderTileKey,
  targets: readonly TileCoverageEntry[],
  records: ReadonlyMap<string, TileEngineV2DisplayRecord>,
): boolean {
  const replacements = targets.filter(
    (target) =>
      fallback.canonical.z < target.key.canonical.z &&
      isRenderTileAncestor(fallback, target.key),
  );
  if (replacements.length === 0) {
    return true;
  }
  return replacements.every((target) => {
    const exact = records.get(canonicalTileKeyToString(target.key.canonical));
    if (exact?.ready) {
      return true;
    }
    return findReadyDescendants(target.key, records).some(
      (descendant) => fallback.canonical.z < descendant.renderKey.canonical.z,
    );
  });
}

/** 确认下一帧 Render Cover 不会只显示局部 Tile。 */
export function hasCompleteTargetCoverage(
  selections: Iterable<DisplaySelectionKeyView>,
  targets: readonly TileCoverageEntry[],
): boolean {
  const keys = [...flattenSelectionKeys(selections).values()];
  return targets.every((target) => isTargetCoveredByKeys(target.key, keys));
}

function isTargetCoveredByKeys(
  target: RenderTileKey,
  keys: readonly RenderTileKey[],
): boolean {
  if (keys.some((key) => isRenderTileAncestor(key, target))) {
    return true;
  }
  return hasCompleteDescendantCoverage(target, keys);
}

function hasCompleteDescendantCoverage(
  target: RenderTileKey,
  keys: readonly RenderTileKey[],
): boolean {
  const byZoom = new Map<number, Set<string>>();
  for (const key of keys) {
    if (
      key.canonical.z <= target.canonical.z ||
      !isRenderTileAncestor(target, key)
    ) {
      continue;
    }
    let descendants = byZoom.get(key.canonical.z);
    if (descendants === undefined) {
      descendants = new Set();
      byZoom.set(key.canonical.z, descendants);
    }
    descendants.add(renderTileKeyToString(key));
  }

  const targetGlobalX =
    target.canonical.x + target.wrap * 2 ** target.canonical.z;
  for (const zoom of [...byZoom.keys()].sort((left, right) => left - right)) {
    const descendants = byZoom.get(zoom);
    if (descendants === undefined) {
      continue;
    }
    const scale = 2 ** (zoom - target.canonical.z);
    if (descendants.size < scale * scale) {
      continue;
    }
    if (hasEveryDescendant(target, zoom, targetGlobalX, descendants)) {
      return true;
    }
  }
  return false;
}

function hasEveryDescendant(
  target: RenderTileKey,
  zoom: number,
  targetGlobalX: number,
  descendants: ReadonlySet<string>,
): boolean {
  const scale = 2 ** (zoom - target.canonical.z);
  const yEnd = (target.canonical.y + 1) * scale;
  const xEnd = (targetGlobalX + 1) * scale;
  for (let y = target.canonical.y * scale; y < yEnd; y += 1) {
    for (let x = targetGlobalX * scale; x < xEnd; x += 1) {
      const key = createRenderTileKey(target.canonical.sourceId, zoom, x, y);
      if (key === undefined || !descendants.has(renderTileKeyToString(key))) {
        return false;
      }
    }
  }
  return true;
}
