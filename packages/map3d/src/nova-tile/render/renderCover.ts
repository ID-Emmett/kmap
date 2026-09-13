import type { PlanEpoch } from '../epoch.js';
import { TilePyramid } from '../pyramid/index.js';
import { createCoverageCohort, isCohortCurrent, type CoverageCohort } from './cohort.js';
import { resolveRenderCover } from './coverResolver.js';
import type { RenderCoverOptions, RenderCoverResolution, RenderCoverSnapshot, RenderTileCandidate, RenderTransition } from './types.js';
import type { RenderTileKey } from '../tileAddress.js';

/** 管理 Target、Committed、Outgoing Cover 及 Cohort 原子过渡。 */
export class NovaTileRenderCover {
  readonly #pyramid: TilePyramid;
  readonly #durationMs: number;
  #planEpoch: PlanEpoch = 0;
  #target: RenderCoverResolution | undefined;
  #committed: readonly RenderTileCandidate[] = Object.freeze([]);
  #outgoing: readonly RenderTileCandidate[] = Object.freeze([]);
  #transition: RenderTransition | undefined;
  #lastTransitionId = 0;

  constructor(pyramid: TilePyramid, options: RenderCoverOptions = {}) {
    this.#pyramid = pyramid;
    const min = options.minTransitionDurationMs ?? 120;
    const max = options.maxTransitionDurationMs ?? 180;
    const requested = options.transitionDurationMs ?? 150;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || !Number.isFinite(requested)) throw new RangeError('过渡时长参数无效。');
    this.#durationMs = Math.min(max, Math.max(min, requested));
  }

  setTarget(planEpoch: PlanEpoch, targets: readonly RenderTileKey[], candidates: ReadonlyMap<string, RenderTileCandidate>): RenderCoverResolution {
    if (!Number.isSafeInteger(planEpoch) || planEpoch < 0) throw new RangeError('planEpoch 必须是非负安全整数。');
    this.#planEpoch = planEpoch;
    this.#target = resolveRenderCover(targets, candidates, { planEpoch, pyramid: this.#pyramid });
    return this.#target;
  }

  resolve(planEpoch = this.#planEpoch, targets: readonly RenderTileKey[] = [], candidates: ReadonlyMap<string, RenderTileCandidate> = new Map()): RenderCoverResolution {
    return this.setTarget(planEpoch, targets, candidates);
  }

  createCohort(now: number): CoverageCohort | undefined {
    if (this.#target === undefined) return undefined;
    return createCoverageCohort(this.#target, now);
  }

  commit(cohort: CoverageCohort, now: number): boolean {
    if (!Number.isFinite(now) || !isCohortCurrent(cohort, this.#planEpoch)) return false;
    this.#outgoing = this.#committed;
    this.#committed = Object.freeze([...cohort.entries]);
    this.#lastTransitionId += 1;
    this.#transition = Object.freeze({ id: this.#lastTransitionId, planEpoch: cohort.planEpoch, startedAt: now, durationMs: this.#durationMs, outgoing: this.#outgoing, incoming: this.#committed, progress: 0, complete: this.#outgoing.length === 0 });
    if (this.#transition.complete) this.#outgoing = Object.freeze([]);
    return true;
  }

  commitResolution(resolution: RenderCoverResolution, now: number): boolean {
    const cohort = createCoverageCohort(resolution, now);
    return this.commit(cohort, now);
  }

  advance(now: number): RenderTransition | undefined {
    const transition = this.#transition;
    if (transition === undefined) return undefined;
    const progress = transition.durationMs === 0 ? 1 : Math.min(1, Math.max(0, (now - transition.startedAt) / transition.durationMs));
    const complete = progress >= 1;
    this.#transition = Object.freeze({ ...transition, progress, complete });
    if (complete) this.#outgoing = Object.freeze([]);
    return this.#transition;
  }

  invalidate(planEpoch: PlanEpoch): void {
    if (planEpoch < this.#planEpoch) return;
    this.#planEpoch = planEpoch;
    this.#target = undefined;
  }

  get snapshot(): RenderCoverSnapshot {
    const target = this.#target;
    const coverageComplete = target?.coverageComplete ?? (this.#committed.length > 0 || this.#target === undefined);
    return Object.freeze({ planEpoch: this.#planEpoch, target, committed: this.#committed, outgoing: this.#outgoing, transition: this.#transition, coverageComplete, blankArea: coverageComplete ? 0 : target?.blankArea ?? 0 });
  }

  get committed(): readonly RenderTileCandidate[] { return this.#committed; }
  get outgoing(): readonly RenderTileCandidate[] { return this.#outgoing; }
  get transition(): RenderTransition | undefined { return this.#transition; }
  get coverageComplete(): boolean { return this.snapshot.coverageComplete; }
  get blankArea(): number { return this.snapshot.blankArea; }
}

/** 兼容后续模块的简短类名。 */
export { NovaTileRenderCover as RenderCover };
