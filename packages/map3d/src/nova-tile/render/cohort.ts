import type { PlanEpoch } from '../epoch.js';
import type { CoverageCell, RenderCoverResolution, RenderTileCandidate } from './types.js';

/** 帧边界提交的一组完整 Coverage Cell。 */
export interface CoverageCohort {
  readonly id: number;
  readonly planEpoch: PlanEpoch;
  readonly cells: readonly CoverageCell[];
  readonly entries: readonly RenderTileCandidate[];
  readonly complete: boolean;
  readonly createdAt: number;
}

let nextCohortId = 1;

/** 从完整解析结果创建 Cohort；不完整结果保持 pending，不允许原子提交。 */
export function createCoverageCohort(resolution: RenderCoverResolution, now: number): CoverageCohort {
  if (!Number.isFinite(now)) throw new RangeError('now 必须是有限数值。');
  return Object.freeze({ id: nextCohortId++, planEpoch: resolution.planEpoch, cells: resolution.cells, entries: resolution.entries, complete: resolution.coverageComplete, createdAt: now });
}

/** 校验 Cohort 是否仍属于当前计划并保持空间完整。 */
export function isCohortCurrent(cohort: CoverageCohort, planEpoch: PlanEpoch): boolean {
  return cohort.planEpoch === planEpoch && cohort.complete && cohort.cells.every((cell) => cell.complete);
}
