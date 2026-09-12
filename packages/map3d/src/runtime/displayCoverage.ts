import {
  canonicalTileKeyToString,
  renderTileKeyToString,
} from '../spatial/tileKey.js';
import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import type { CanonicalTileKey } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import {
  findReadyAncestor,
  findReadyDescendants,
  getAncestorRenderTileKeys,
  isRenderTileAncestor,
} from './displayCoverageSpatial.js';
import {
  filterKeysByTargetOverlap,
  findIncompleteReplacementFallbacks,
  flattenSelectionKeys,
  hasAnySpatialLodReplacement,
  hasOutgoingSpatialLodReplacement,
  hasOverlappingSelectionKeys,
} from './displayCoverageReplacement.js';

const DEFAULT_TRANSITION_MS = 180;
const FALLBACK_WARM_ANCESTOR_LEVELS = 2;

export interface DisplayCoverageRecord {
  id: string;
  key: CanonicalTileKey;
  ready: boolean;
  renderKeys: readonly RenderTileKey[];
  /** 记录存在但已确认不可通过父 Tile 解决时，禁止重复派生请求。 */
  fallbackEligible?: boolean;
}

export interface DisplaySelection {
  recordId: string;
  keys: readonly RenderTileKey[];
  opacity: number;
  role: 'exact' | 'fallback' | 'outgoing';
}

export interface DisplayCoveragePlan {
  token: number;
  selections: readonly DisplaySelection[];
  requestedFallbacks: readonly RenderTileKey[];
  requiredFallbacks: readonly RenderTileKey[];
  animating: boolean;
}

interface MutableSelection {
  recordId: string;
  keys: Map<string, RenderTileKey>;
  opacity: number;
  role: DisplaySelection['role'];
  transitionStartedAt: number | undefined;
}

/** 在 Target Coverage 与实际显示资源之间协调 fallback、过渡和 display pin。 */
export class DisplayCoverageCoordinator {
  readonly #durationMs: number;
  readonly #reducedMotion: boolean;
  readonly #minZoom: number;
  #targetSignature = '';
  #targetToken = 0;
  #active = new Map<string, MutableSelection>();
  #outgoing = new Map<string, MutableSelection>();
  #transitionNow = 0;

  constructor(
    options: {
      durationMs?: number;
      reducedMotion?: boolean;
      minZoom?: number;
    } = {},
  ) {
    const durationMs = options.durationMs ?? DEFAULT_TRANSITION_MS;
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('Tile transition duration 必须是非负有限数值。');
    }
    this.#durationMs = durationMs;
    this.#reducedMotion = options.reducedMotion ?? false;
    const minZoom = options.minZoom ?? 0;
    if (!Number.isSafeInteger(minZoom) || minZoom < 0) {
      throw new RangeError('Tile fallback minZoom 必须是非负安全整数。');
    }
    this.#minZoom = minZoom;
  }

  update(
    targets: readonly TileCoverageEntry[],
    records: ReadonlyMap<string, DisplayCoverageRecord>,
    now: number,
  ): DisplayCoveragePlan {
    this.advance(now);
    const visibleTargets = targets.filter((entry) => entry.kind === 'visible');
    const signature = visibleTargets
      .map((entry) => renderTileKeyToString(entry.key))
      .sort()
      .join('|');
    if (signature !== this.#targetSignature) {
      this.#targetSignature = signature;
      this.#targetToken += 1;
    }
    if (visibleTargets.length === 0) {
      this.#outgoing.clear();
    }
    this.#transitionNow = now;

    const next = this.#selectTargets(visibleTargets, records);
    this.#preserveOutgoing(next, visibleTargets);
    this.#startExactTransitions(next, now);
    this.#startOutgoingTransitions(next, now);
    this.#active = next;
    this.#removeOverlappingOutgoing(next);
    this.#applyTransitionOpacity(now);
    return this.#createPlan(records, targets);
  }

  advance(now: number): DisplayCoveragePlan {
    this.#transitionNow = now;
    this.#applyTransitionOpacity(now);
    for (const [recordId, selection] of this.#outgoing) {
      if (selection.transitionStartedAt === undefined) {
        continue;
      }
      if (this.#reducedMotion || now - selection.transitionStartedAt >= this.#durationMs) {
        this.#outgoing.delete(recordId);
      }
    }
    return this.#createPlan(new Map(), []);
  }

  dispose(): void {
    this.#active.clear();
    this.#outgoing.clear();
    this.#targetSignature = '';
    this.#targetToken = 0;
  }

  #selectTargets(
    targets: readonly TileCoverageEntry[],
    records: ReadonlyMap<string, DisplayCoverageRecord>,
  ): Map<string, MutableSelection> {
    const selections = new Map<string, MutableSelection>();
    const requestedTargets = new Set<string>();
    const incompleteFallbacks = findIncompleteReplacementFallbacks(
      this.#active.values(),
      targets,
      records,
    );

    for (const target of targets) {
      const targetId = canonicalTileKeyToString(target.key.canonical);
      if (requestedTargets.has(`${targetId}@${target.key.wrap}`)) {
        continue;
      }
      requestedTargets.add(`${targetId}@${target.key.wrap}`);

      const blockedFallback = incompleteFallbacks.find(
        (fallback) =>
          fallback.key.canonical.z < target.key.canonical.z &&
          isRenderTileAncestor(fallback.key, target.key),
      );
      if (blockedFallback !== undefined) {
        addSelectionKey(
          selections,
          blockedFallback.recordId,
          blockedFallback.key,
          'fallback',
        );
        continue;
      }

      const exact = records.get(targetId);
      if (exact?.ready) {
        addSelectionKey(selections, exact.id, target.key, 'exact');
        continue;
      }

      const ancestor = findReadyAncestor(target.key, records, this.#minZoom);
      if (ancestor !== undefined) {
        addSelectionKey(selections, ancestor.record.id, ancestor.renderKey, 'fallback');
        continue;
      }

      const descendants = findReadyDescendants(target.key, records);
      if (descendants.length > 0) {
        for (const descendant of descendants) {
          addSelectionKey(
            selections,
            descendant.record.id,
            descendant.renderKey,
            'fallback',
          );
        }
      }
    }

    return selections;
  }

  #preserveOutgoing(
    next: ReadonlyMap<string, MutableSelection>,
    targets: readonly TileCoverageEntry[],
  ): void {
    const nextKeys = flattenSelectionKeys(next.values());

    // 过时 outgoing 只在其空间完全脱离当前目标后移除，不能因无关区域变化而全局清空。
    for (const [recordId, selection] of this.#outgoing) {
      const retainedKeys = filterKeysByTargetOverlap(selection.keys, targets);
      if (retainedKeys.size === 0) {
        this.#outgoing.delete(recordId);
        continue;
      }
      selection.keys = retainedKeys;
    }

    for (const [recordId, previous] of this.#active) {
      if (targets.length === 0) {
        continue;
      }
      const retainedKeys = new Map(previous.keys);
      for (const keyId of [...retainedKeys.keys()]) {
        if (nextKeys.has(keyId)) {
          retainedKeys.delete(keyId);
        }
      }
      if (retainedKeys.size === 0) {
        continue;
      }

      const existing = this.#outgoing.get(recordId);
      if (existing === undefined) {
        this.#outgoing.set(recordId, {
          ...previous,
          keys: retainedKeys,
          role: 'outgoing',
          opacity: 1,
          transitionStartedAt: undefined,
        });
      } else {
        for (const [keyId, key] of retainedKeys) {
          existing.keys.set(keyId, key);
        }
      }
    }
  }

  #startExactTransitions(
    next: ReadonlyMap<string, MutableSelection>,
    now: number,
  ): void {
    for (const selection of next.values()) {
      if (selection.role !== 'exact') {
        continue;
      }
      const previous = this.#active.get(selection.recordId);
      if (previous?.role === 'exact') {
        if (hasOverlappingSelectionKeys(previous, selection)) {
          selection.transitionStartedAt = previous.transitionStartedAt;
          selection.opacity = previous.opacity;
        } else {
          selection.transitionStartedAt = undefined;
          selection.opacity = 1;
        }
        continue;
      }
      if (
        this.#reducedMotion ||
        !hasAnySpatialLodReplacement(this.#outgoing.values(), selection)
      ) {
        selection.transitionStartedAt = undefined;
        selection.opacity = 1;
      } else {
        selection.transitionStartedAt = now;
        selection.opacity = 0;
      }
    }
  }

  #startOutgoingTransitions(
    next: ReadonlyMap<string, MutableSelection>,
    now: number,
  ): void {
    for (const [recordId, selection] of this.#outgoing) {
      const replacement = hasOutgoingSpatialLodReplacement(
        selection,
        [...next.values()].filter((candidate) => candidate.role === 'exact'),
      );
      if (!replacement) {
        continue;
      }
      if (this.#reducedMotion || this.#durationMs === 0) {
        this.#outgoing.delete(recordId);
        continue;
      }
      selection.transitionStartedAt ??= now;
    }
  }

  #removeOverlappingOutgoing(next: ReadonlyMap<string, MutableSelection>): void {
    const nextKeys = flattenSelectionKeys(next.values());
    for (const [recordId, selection] of this.#outgoing) {
      for (const keyId of nextKeys.keys()) {
        selection.keys.delete(keyId);
      }
      if (next.size > 0) {
        for (const [keyId, key] of selection.keys) {
          if (
            ![...nextKeys.values()].some((nextKey) =>
              isRenderTileAncestor(key, nextKey) ||
              isRenderTileAncestor(nextKey, key),
            )
          ) {
            selection.keys.delete(keyId);
          }
        }
      }
      if (selection.keys.size === 0) {
        this.#outgoing.delete(recordId);
      }
    }
  }

  #applyTransitionOpacity(now: number): void {
    for (const selection of this.#active.values()) {
      if (selection.role !== 'exact' || this.#reducedMotion) {
        selection.opacity = 1;
        continue;
      }
      if (selection.transitionStartedAt === undefined) {
        selection.opacity = 1;
        continue;
      }
      const elapsed = now - selection.transitionStartedAt;
      selection.opacity = this.#durationMs === 0
        ? 1
        : clamp01(elapsed / this.#durationMs);
      if (selection.opacity >= 1) {
        selection.transitionStartedAt = undefined;
      }
    }
    for (const selection of this.#outgoing.values()) {
      if (selection.transitionStartedAt === undefined) {
        continue;
      }
      const elapsed = now - selection.transitionStartedAt;
      const progress = this.#durationMs === 0
        ? 1
        : clamp01(elapsed / this.#durationMs);
      selection.opacity = 1 - progress;
    }
  }

  #createPlan(
    records: ReadonlyMap<string, DisplayCoverageRecord>,
    fallbackTargets: readonly TileCoverageEntry[],
  ): DisplayCoveragePlan {
    const selections = [...this.#active.values(), ...this.#outgoing.values()]
      .map((selection) => ({
        recordId: selection.recordId,
        keys: Object.freeze([...selection.keys.values()]),
        opacity: selection.opacity,
        role: selection.role,
      }))
      .filter((selection) => {
        if (records.size === 0) {
          return true;
        }
        return records.get(selection.recordId)?.ready === true;
      });

    const requestedFallbacks: RenderTileKey[] = [];
    // 首次建立显示覆盖时直接请求目标 Tile；已有显示资源后才需要额外父 Tile。
    const canRequestFallback = this.#active.size > 0 || this.#outgoing.size > 0;
    if (!canRequestFallback) {
      return Object.freeze({
        token: this.#targetToken,
        selections: Object.freeze(selections),
        requestedFallbacks: Object.freeze([]),
        requiredFallbacks: Object.freeze([]),
        animating: this.#activeTransition(nowOr(this.#transitionNow)),
      });
    }
    const seen = new Set<string>();
    const requiredFallbacks: RenderTileKey[] = [];
    for (const target of fallbackTargets) {
      if (target.kind !== 'visible') {
        continue;
      }
      const targetId = canonicalTileKeyToString(target.key.canonical);
      const targetRecord = records.get(targetId);
      const hasDisplayFallback =
        findReadyAncestor(target.key, records) !== undefined ||
        findReadyDescendants(target.key, records).length > 0;
      const required =
        target.kind === 'visible' &&
        targetRecord?.ready !== true &&
        targetRecord?.fallbackEligible !== false &&
        !hasDisplayFallback;
      const warm = targetRecord?.ready === true;
      if (!required && !warm) {
        continue;
      }
      const ancestors = getAncestorRenderTileKeys(
        target.key,
        warm ? FALLBACK_WARM_ANCESTOR_LEVELS : 1,
        this.#minZoom,
      );
      for (const [index, ancestor] of ancestors.entries()) {
        const ancestorRecord = records.get(
          canonicalTileKeyToString(ancestor.canonical),
        );
        if (
          ancestorRecord?.ready === true ||
          ancestorRecord?.fallbackEligible === false
        ) {
          continue;
        }
        const id = renderTileKeyToString(ancestor);
        if (!seen.has(id)) {
          seen.add(id);
          requestedFallbacks.push(ancestor);
          if (required && index === 0) {
            requiredFallbacks.push(ancestor);
          }
        }
      }
    }

    return Object.freeze({
      token: this.#targetToken,
      selections: Object.freeze(selections),
      requestedFallbacks: Object.freeze(requestedFallbacks),
      requiredFallbacks: Object.freeze(requiredFallbacks),
      animating: this.#activeTransition(nowOr(this.#transitionNow)),
    });
  }

  #activeTransition(now: number): boolean {
    if (this.#reducedMotion || this.#durationMs === 0) {
      return false;
    }
    return [...this.#active.values(), ...this.#outgoing.values()].some(
      (selection) => selection.transitionStartedAt !== undefined &&
        now - selection.transitionStartedAt < this.#durationMs,
    );
  }
}

function addSelectionKey(
  selections: Map<string, MutableSelection>,
  recordId: string,
  key: RenderTileKey,
  role: MutableSelection['role'],
): void {
  let selection = selections.get(recordId);
  if (selection === undefined) {
    selection = {
      recordId,
      keys: new Map(),
      opacity: 1,
      role,
      transitionStartedAt: undefined,
    };
    selections.set(recordId, selection);
  }
  selection.keys.set(renderTileKeyToString(key), key);
  if (role === 'exact') {
    selection.role = 'exact';
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nowOr(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
