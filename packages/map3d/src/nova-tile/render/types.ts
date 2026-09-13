import type { PlanEpoch, TileGeneration } from '../epoch.js';
import type { RenderTileKey } from '../tileAddress.js';

/** Render Cover 可解析的 Tile 状态。 */
export type RenderTileAvailability = 'ready' | 'loading' | 'empty' | 'failed';

/** Cover 候选项；epoch/generation 用于拒绝迟到的异步结果。 */
export interface RenderTileCandidate {
  readonly key: RenderTileKey;
  readonly availability: RenderTileAvailability;
  readonly planEpoch?: PlanEpoch;
  readonly generation?: TileGeneration;
  readonly opacity?: number;
}

/** 单个 Target Tile 的空间覆盖 Cell。 */
export interface CoverageCell {
  readonly id: string;
  readonly target: RenderTileKey;
  readonly entries: readonly RenderTileCandidate[];
  readonly complete: boolean;
  readonly blankArea: number;
  readonly role: 'exact' | 'ancestor' | 'descendant' | 'uncovered';
}

/** Render Cover 解析结果。 */
export interface RenderCoverResolution {
  readonly planEpoch: PlanEpoch;
  readonly cells: readonly CoverageCell[];
  readonly entries: readonly RenderTileCandidate[];
  readonly complete: boolean;
  readonly coverageComplete: boolean;
  readonly blankArea: number;
}

/** 正在执行的 exact/fallback Cohort 过渡。 */
export interface RenderTransition {
  readonly id: number;
  readonly planEpoch: PlanEpoch;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outgoing: readonly RenderTileCandidate[];
  readonly incoming: readonly RenderTileCandidate[];
  readonly progress: number;
  readonly complete: boolean;
}

/** 当前 Render Cover 的不可变快照。 */
export interface RenderCoverSnapshot {
  readonly planEpoch: PlanEpoch;
  readonly target: RenderCoverResolution | undefined;
  readonly committed: readonly RenderTileCandidate[];
  readonly outgoing: readonly RenderTileCandidate[];
  readonly transition: RenderTransition | undefined;
  readonly coverageComplete: boolean;
  readonly blankArea: number;
}

export interface RenderCoverOptions {
  readonly transitionDurationMs?: number;
  readonly minTransitionDurationMs?: number;
  readonly maxTransitionDurationMs?: number;
}
