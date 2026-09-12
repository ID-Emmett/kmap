import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import type { RenderTileKey } from '../spatial/types.js';
import type { DisplayCoverageRecord } from './displayCoverage.js';
import {
  findReadyDescendants,
  isRenderTileAncestor,
  renderTileKeysOverlap,
} from './displayCoverageSpatial.js';

export interface DisplaySelectionKeyView {
  recordId: string;
  keys: ReadonlyMap<string, RenderTileKey>;
}

export function findIncompleteReplacementFallbacks(
  selections: Iterable<DisplaySelectionKeyView>,
  targets: readonly TileCoverageEntry[],
  records: ReadonlyMap<string, DisplayCoverageRecord>,
): Array<{ recordId: string; key: RenderTileKey }> {
  const incomplete: Array<{ recordId: string; key: RenderTileKey }> = [];
  for (const selection of selections) {
    for (const key of selection.keys.values()) {
      if (isReplacementCoverageComplete(key, targets, records)) {
        continue;
      }
      incomplete.push({ recordId: selection.recordId, key });
    }
  }
  return incomplete;
}

export function flattenSelectionKeys(
  selections: Iterable<DisplaySelectionKeyView>,
): Map<string, RenderTileKey> {
  const keys = new Map<string, RenderTileKey>();
  for (const selection of selections) {
    for (const [keyId, key] of selection.keys) {
      keys.set(keyId, key);
    }
  }
  return keys;
}

export function filterKeysByTargetOverlap(
  keys: ReadonlyMap<string, RenderTileKey>,
  targets: readonly TileCoverageEntry[],
): Map<string, RenderTileKey> {
  return new Map(
    [...keys].filter(([, key]) =>
      targets.some((target) => renderTileKeysOverlap(key, target.key)),
    ),
  );
}

export function hasOverlappingSelectionKeys(
  left: DisplaySelectionKeyView,
  right: DisplaySelectionKeyView,
): boolean {
  for (const leftKey of left.keys.values()) {
    for (const rightKey of right.keys.values()) {
      if (renderTileKeysOverlap(leftKey, rightKey)) {
        return true;
      }
    }
  }
  return false;
}

export function hasAnySpatialLodReplacement(
  outgoing: Iterable<DisplaySelectionKeyView>,
  next: DisplaySelectionKeyView,
): boolean {
  for (const selection of outgoing) {
    if (hasSpatialLodReplacement(selection.keys, next.keys)) {
      return true;
    }
  }
  return false;
}

export function hasOutgoingSpatialLodReplacement(
  outgoing: DisplaySelectionKeyView,
  next: Iterable<DisplaySelectionKeyView>,
): boolean {
  for (const selection of next) {
    if (hasSpatialLodReplacement(outgoing.keys, selection.keys)) {
      return true;
    }
  }
  return false;
}

function hasSpatialLodReplacement(
  outgoing: ReadonlyMap<string, RenderTileKey>,
  next: ReadonlyMap<string, RenderTileKey>,
): boolean {
  for (const outgoingKey of outgoing.values()) {
    for (const nextKey of next.values()) {
      if (
        outgoingKey.canonical.z !== nextKey.canonical.z &&
        (
          isRenderTileAncestor(outgoingKey, nextKey) ||
          isRenderTileAncestor(nextKey, outgoingKey)
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function isReplacementCoverageComplete(
  fallback: RenderTileKey,
  targets: readonly TileCoverageEntry[],
  records: ReadonlyMap<string, DisplayCoverageRecord>,
): boolean {
  const replacements = targets.filter(
    (target) =>
      target.kind === 'visible' &&
      fallback.canonical.z < target.key.canonical.z &&
      isRenderTileAncestor(fallback, target.key),
  );
  if (replacements.length === 0) {
    return true;
  }
  return replacements.every((target) =>
    isTargetCoveredByReadyReplacement(fallback, target.key, records),
  );
}

function isTargetCoveredByReadyReplacement(
  fallback: RenderTileKey,
  target: RenderTileKey,
  records: ReadonlyMap<string, DisplayCoverageRecord>,
): boolean {
  for (const record of records.values()) {
    if (!record.ready) {
      continue;
    }
    for (const key of record.renderKeys) {
      if (
        fallback.canonical.z < key.canonical.z &&
        isRenderTileAncestor(key, target)
      ) {
        return true;
      }
    }
  }
  return findReadyDescendants(target, records).some(
    (descendant) => fallback.canonical.z < descendant.renderKey.canonical.z,
  );
}
