import {
  canonicalTileKeyToString,
  createRenderTileKey,
  renderTileKeyToString,
} from '../spatial/tileKey.js';
import type { RenderTileKey } from '../spatial/types.js';
import type { DisplayCoverageRecord } from './displayCoverage.js';

export function findReadyAncestor(
  key: RenderTileKey,
  records: ReadonlyMap<string, DisplayCoverageRecord>,
  minZoom = 0,
): { record: DisplayCoverageRecord; renderKey: RenderTileKey } | undefined {
  let parent = getParentRenderTileKey(key);
  while (parent !== undefined) {
    if (parent.canonical.z < minZoom) {
      break;
    }
    const record = records.get(canonicalTileKeyToString(parent.canonical));
    if (record?.ready) {
      return { record, renderKey: parent };
    }
    parent = getParentRenderTileKey(parent);
  }
  return undefined;
}

/** 只返回能够完整覆盖目标区域的同层 descendants，避免提交局部空洞。 */
export function findReadyDescendants(
  target: RenderTileKey,
  records: ReadonlyMap<string, DisplayCoverageRecord>,
): Array<{ record: DisplayCoverageRecord; renderKey: RenderTileKey }> {
  const byZoom = new Map<
    number,
    Map<string, { record: DisplayCoverageRecord; renderKey: RenderTileKey }>
  >();
  for (const record of records.values()) {
    if (!record.ready || record.key.z <= target.canonical.z) {
      continue;
    }
    for (const key of record.renderKeys) {
      if (!isDescendantOf(key, target)) {
        continue;
      }
      let descendants = byZoom.get(key.canonical.z);
      if (descendants === undefined) {
        descendants = new Map();
        byZoom.set(key.canonical.z, descendants);
      }
      descendants.set(renderTileKeyToString(key), { record, renderKey: key });
    }
  }

  const targetGlobalX =
    target.canonical.x + target.wrap * 2 ** target.canonical.z;
  for (const zoom of [...byZoom.keys()].sort((left, right) => left - right)) {
    const descendants = byZoom.get(zoom);
    if (descendants === undefined) {
      continue;
    }
    const scale = 2 ** (zoom - target.canonical.z);
    const expectedCount = scale * scale;
    if (descendants.size < expectedCount) {
      continue;
    }
    const complete: Array<{
      record: DisplayCoverageRecord;
      renderKey: RenderTileKey;
    }> = [];
    for (let y = target.canonical.y * scale; y < (target.canonical.y + 1) * scale; y += 1) {
      for (let x = targetGlobalX * scale; x < (targetGlobalX + 1) * scale; x += 1) {
        const key = createRenderTileKey(target.canonical.sourceId, zoom, x, y);
        const descendant = key === undefined
          ? undefined
          : descendants.get(renderTileKeyToString(key));
        if (descendant === undefined) {
          complete.length = 0;
          break;
        }
        complete.push(descendant);
      }
      if (complete.length === 0) {
        break;
      }
    }
    if (complete.length === expectedCount) {
      return complete;
    }
  }
  return [];
}

export function getAncestorRenderTileKeys(
  key: RenderTileKey,
  levels: number,
  minZoom = 0,
): RenderTileKey[] {
  const ancestors: RenderTileKey[] = [];
  let current: RenderTileKey | undefined = key;
  for (let level = 0; level < levels; level += 1) {
    current = getParentRenderTileKey(current);
    if (current === undefined) {
      break;
    }
    if (current.canonical.z < minZoom) {
      break;
    }
    ancestors.push(current);
  }
  return ancestors;
}

export function getParentRenderTileKey(
  key: RenderTileKey,
): RenderTileKey | undefined {
  if (key.canonical.z === 0) {
    return undefined;
  }
  const globalX = key.canonical.x + key.wrap * 2 ** key.canonical.z;
  return createRenderTileKey(
    key.canonical.sourceId,
    key.canonical.z - 1,
    Math.floor(globalX / 2),
    Math.floor(key.canonical.y / 2),
  );
}

/** 判断 ancestor 是否在空间上覆盖 descendant。 */
export function isRenderTileAncestor(
  ancestor: RenderTileKey,
  descendant: RenderTileKey,
): boolean {
  const difference = descendant.canonical.z - ancestor.canonical.z;
  if (
    difference < 0 ||
    ancestor.canonical.sourceId !== descendant.canonical.sourceId
  ) {
    return false;
  }
  const scale = 2 ** difference;
  const ancestorGlobalX =
    ancestor.canonical.x + ancestor.wrap * 2 ** ancestor.canonical.z;
  const descendantGlobalX =
    descendant.canonical.x + descendant.wrap * 2 ** descendant.canonical.z;
  return (
    Math.floor(descendantGlobalX / scale) === ancestorGlobalX &&
    Math.floor(descendant.canonical.y / scale) === ancestor.canonical.y
  );
}

/** 判断两个 Render Tile 是否存在空间重叠。 */
export function renderTileKeysOverlap(
  left: RenderTileKey,
  right: RenderTileKey,
): boolean {
  return isRenderTileAncestor(left, right) || isRenderTileAncestor(right, left);
}

function isDescendantOf(
  descendant: RenderTileKey,
  ancestor: RenderTileKey,
): boolean {
  return isRenderTileAncestor(ancestor, descendant);
}
