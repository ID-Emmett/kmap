import type { CanonicalTileKey } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import { renderTileKeyToString } from '../spatial/tileKey.js';
import { TilePyramid } from './tilePyramid.js';

export interface RenderCoverCandidate {
  key: RenderTileKey;
  state: 'ready' | 'empty' | 'failed' | 'loading';
}

export interface RenderCoverResult {
  entries: readonly RenderCoverCandidate[];
  complete: boolean;
  uncovered: readonly RenderTileKey[];
}

/** 计算无空洞的 best-available render cover，并保证同一区域原子替换。 */
export class TileRenderCover {
  readonly #pyramid: TilePyramid;

  constructor(pyramid: TilePyramid) {
    this.#pyramid = pyramid;
  }

  resolve(targets: readonly RenderTileKey[], states: ReadonlyMap<string, RenderCoverCandidate['state']>): RenderCoverResult {
    const entries = new Map<string, RenderCoverCandidate>();
    const uncovered: RenderTileKey[] = [];
    for (const target of targets) {
      let candidate: RenderTileKey | undefined = target;
      let resolved: RenderCoverCandidate | undefined;
      while (candidate !== undefined) {
        const id = renderTileKeyToString(candidate);
        const state = states.get(id);
        if (state === 'ready' || state === 'empty' || state === 'failed') {
          resolved = { key: candidate, state };
          break;
        }
        candidate = this.#pyramid.parentRenderKey(candidate);
      }
      if (resolved === undefined) {
        uncovered.push(target);
        continue;
      }
      entries.set(renderTileKeyToString(resolved.key), resolved);
    }
    return {
      entries: Object.freeze([...entries.values()]),
      complete: uncovered.length === 0,
      uncovered: Object.freeze(uncovered),
    };
  }

  isCovered(target: RenderTileKey, cover: readonly RenderCoverCandidate[]): boolean {
    return cover.some((entry) =>
      entry.key.canonical.sourceId === target.canonical.sourceId &&
      (entry.key.canonical.z === target.canonical.z
        ? entry.key.canonical.x === target.canonical.x && entry.key.canonical.y === target.canonical.y && entry.key.wrap === target.wrap
        : entry.key.canonical.z < target.canonical.z && this.#pyramid.isAncestor(entry.key.canonical, target.canonical)),
    );
  }

  keyOf(key: CanonicalTileKey): string { return this.#pyramid.keyOf(key); }
}
