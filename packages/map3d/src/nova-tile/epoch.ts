/** NTE 规划轮次；每次 ViewState 计划替换都递增。 */
export type PlanEpoch = number;

/** 异步 Tile generation；同一 canonical key 的新管线拥有更大的 generation。 */
export type TileGeneration = number;

/** 创建初始合法 epoch。 */
export function createPlanEpoch(initial = 0): PlanEpoch {
  return requireCounter(initial, 'planEpoch');
}

/** 创建初始合法 generation。 */
export function createTileGeneration(initial = 0): TileGeneration {
  return requireCounter(initial, 'generation');
}

/** 推进 plan epoch；溢出会显式失败而不是复用旧异步身份。 */
export function advancePlanEpoch(epoch: PlanEpoch): PlanEpoch {
  const current = requireCounter(epoch, 'planEpoch');
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('planEpoch 已达到安全整数上限。');
  }
  return current + 1;
}

/** 推进 Tile generation。 */
export function advanceTileGeneration(generation: TileGeneration): TileGeneration {
  const current = requireCounter(generation, 'generation');
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('generation 已达到安全整数上限。');
  }
  return current + 1;
}

/** 严格比较异步结果是否仍属于当前计划和 generation。 */
export function isCurrentAsyncIdentity(
  identity: { planEpoch: PlanEpoch; generation: TileGeneration },
  current: { planEpoch: PlanEpoch; generation: TileGeneration },
): boolean {
  const currentPlanEpoch = requireCounter(current.planEpoch, 'planEpoch');
  const currentGeneration = requireCounter(current.generation, 'generation');
  return (
    requireCounter(identity.planEpoch, 'planEpoch') === currentPlanEpoch &&
    requireCounter(identity.generation, 'generation') === currentGeneration
  );
}

function requireCounter(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} 必须是非负安全整数。`);
  }
  return value;
}
