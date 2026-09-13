import { canonicalTileKeyToString, renderTileKeyToString, type RenderTileKey } from '../tileAddress.js';
import { TilePyramid } from '../pyramid/index.js';
import type { PlanEpoch } from '../epoch.js';
import type { CoverageCell, RenderCoverResolution, RenderTileCandidate } from './types.js';

/** 从 Target Cover 和候选状态解析 exact、ancestor、descendant fallback。 */
export function resolveRenderCover(
  targets: readonly RenderTileKey[],
  candidates: ReadonlyMap<string, RenderTileCandidate>,
  options: { readonly planEpoch: PlanEpoch; readonly pyramid: TilePyramid },
): RenderCoverResolution {
  const cells: CoverageCell[] = [];
  const selected = new Map<string, RenderTileCandidate>();
  for (const target of targets) {
    const cell = resolveCoverageCell(target, candidates, options.pyramid);
    cells.push(cell);
    if (cell.complete) {
      for (const entry of cell.entries) selected.set(renderTileKeyToString(entry.key), entry);
    }
  }
  const complete = cells.every((cell) => cell.complete);
  const blankArea = complete ? 0 : cells.filter((cell) => !cell.complete).length;
  return Object.freeze({
    planEpoch: options.planEpoch,
    cells: Object.freeze(cells),
    entries: Object.freeze([...selected.values()]),
    complete,
    coverageComplete: complete,
    blankArea,
  });
}

function resolveCoverageCell(
  target: RenderTileKey,
  candidates: ReadonlyMap<string, RenderTileCandidate>,
  pyramid: TilePyramid,
): CoverageCell {
  const id = renderTileKeyToString(target);
  const exact = getReadyCandidate(target, candidates);
  if (exact !== undefined) return Object.freeze({ id, target, entries: Object.freeze([exact]), complete: true, blankArea: 0, role: 'exact' });

  const ancestors: RenderTileCandidate[] = [];
  let parent = pyramid.parentRenderKey(target);
  while (parent !== undefined) {
    const ancestor = getReadyCandidate(parent, candidates);
    if (ancestor !== undefined) {
      ancestors.push(ancestor);
      break;
    }
    parent = pyramid.parentRenderKey(parent);
  }
  const ancestor = ancestors[0];
  if (ancestor !== undefined) return Object.freeze({ id, target, entries: Object.freeze([ancestor]), complete: true, blankArea: 0, role: 'ancestor' });

  const descendants = [...candidates.values()]
    .filter((candidate) => isRenderableCandidate(candidate) && isRenderDescendant(target, candidate.key, pyramid))
    .sort((left, right) => right.key.canonical.z - left.key.canonical.z || renderTileKeyToString(left.key).localeCompare(renderTileKeyToString(right.key)));
  const covering: RenderTileCandidate[] = [];
  for (const candidate of descendants) {
    if (covering.some((entry) => isRenderDescendant(entry.key, candidate.key, pyramid) || isSameRenderKey(entry.key, candidate.key))) continue;
    covering.push(candidate);
  }
  if (covering.length > 0 && coversTarget(target, covering, pyramid)) return Object.freeze({ id, target, entries: Object.freeze(covering), complete: true, blankArea: 0, role: 'descendant' });

  return Object.freeze({ id, target, entries: Object.freeze([]), complete: false, blankArea: 1, role: 'uncovered' });
}

function getReadyCandidate(key: RenderTileKey, candidates: ReadonlyMap<string, RenderTileCandidate>): RenderTileCandidate | undefined {
  const candidate = candidates.get(renderTileKeyToString(key));
  return candidate !== undefined && isRenderableCandidate(candidate) ? candidate : undefined;
}

function isRenderableCandidate(candidate: RenderTileCandidate): boolean {
  return candidate.availability === 'ready' || candidate.availability === 'empty';
}

function isSameRenderKey(left: RenderTileKey, right: RenderTileKey): boolean {
  return renderTileKeyToString(left) === renderTileKeyToString(right);
}

function isRenderDescendant(ancestor: RenderTileKey, descendant: RenderTileKey, pyramid: TilePyramid): boolean {
  if (ancestor.wrapIndex !== descendant.wrapIndex || ancestor.canonical.z >= descendant.canonical.z) return false;
  const distance = descendant.canonical.z - ancestor.canonical.z;
  return (
    Math.floor(descendant.canonical.x / 2 ** distance) === ancestor.canonical.x &&
    Math.floor(descendant.canonical.y / 2 ** distance) === ancestor.canonical.y &&
    pyramid.sourceId === ancestor.canonical.sourceId &&
    pyramid.sourceRevision === ancestor.canonical.sourceRevision
  );
}

function coversTarget(target: RenderTileKey, entries: readonly RenderTileCandidate[], pyramid: TilePyramid): boolean {
  if (entries.length === 0) return false;
  const targetChildren = entries.filter((entry) => isRenderDescendant(target, entry.key, pyramid));
  if (targetChildren.length === 0) return false;
  const maxZoom = Math.max(...targetChildren.map((entry) => entry.key.canonical.z));
  const distance = maxZoom - target.canonical.z;
  const expected = 2 ** (distance * 2);
  if (targetChildren.length >= expected) return true;
  const covered = new Set<string>();
  for (const entry of targetChildren) {
    const factor = 2 ** (maxZoom - entry.key.canonical.z);
    const baseX = entry.key.canonical.x * factor;
    const baseY = entry.key.canonical.y * factor;
    for (let y = 0; y < factor; y += 1) for (let x = 0; x < factor; x += 1) covered.add(`${baseX + x},${baseY + y}`);
  }
  return covered.size >= expected;
}

/** 根据 canonical key 判断是否属于另一个 key 的同 wrap 后代。 */
export function isDescendantRenderKey(ancestor: RenderTileKey, descendant: RenderTileKey): boolean {
  if (ancestor.wrapIndex !== descendant.wrapIndex || ancestor.canonical.z >= descendant.canonical.z) return false;
  const distance = descendant.canonical.z - ancestor.canonical.z;
  return Math.floor(descendant.canonical.x / 2 ** distance) === ancestor.canonical.x && Math.floor(descendant.canonical.y / 2 ** distance) === ancestor.canonical.y;
}

/** 返回候选集合中对应 canonical Tile 的稳定去重键。 */
export function canonicalCandidateId(candidate: RenderTileCandidate): string {
  return canonicalTileKeyToString(candidate.key.canonical);
}
