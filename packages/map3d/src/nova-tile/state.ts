import { createPlanEpoch, createTileGeneration, type PlanEpoch, type TileGeneration } from './epoch.js';
import { normalizeCanonicalTileKey, type CanonicalTileKey, type RenderTileKey } from './keys.js';

/** Tile 数据处理生命周期；renderRole 和 cacheRole 独立保存。 */
export type TileLifecycleState =
  | 'planned'
  | 'fetching'
  | 'decoded'
  | 'built'
  | 'uploadQueued'
  | 'ready'
  | 'committed'
  | 'retained'
  | 'evicted'
  | 'empty'
  | 'retryable'
  | 'failed'
  | 'cancelled'
  | 'stale';

/** Tile 在 Render Cover 中承担的角色。 */
export type TileRenderRole = 'exact' | 'ancestor' | 'descendant' | 'outgoing' | 'none';

/** Tile 在分层缓存中的角色。 */
export type TileCacheRole = 'resident' | 'warm' | 'cold' | 'none';

/** NTE Tile 记录的最小状态模型。 */
export interface NovaTileRecord<Payload = unknown> {
  readonly key: CanonicalTileKey;
  readonly generation: TileGeneration;
  planEpoch: PlanEpoch;
  lifecycleState: TileLifecycleState;
  renderRole: TileRenderRole;
  cacheRole: TileCacheRole;
  renderKeys: readonly RenderTileKey[];
  payload?: Payload;
  error?: unknown;
  updatedAt: number;
}

/** 创建处于 planned 状态的不可变身份、可变状态记录。 */
export function createNovaTileRecord<Payload>(input: {
  key: CanonicalTileKey;
  generation: TileGeneration;
  planEpoch: PlanEpoch;
  now: number;
  renderRole?: TileRenderRole;
  cacheRole?: TileCacheRole;
  renderKeys?: readonly RenderTileKey[];
}): NovaTileRecord<Payload> {
  if (!Number.isFinite(input.now)) {
    throw new RangeError('now 必须是有限数值。');
  }
  const key = normalizeCanonicalTileKey(input.key);
  const generation = createTileGeneration(input.generation);
  const planEpoch = createPlanEpoch(input.planEpoch);
  const renderKeys = [...(input.renderKeys ?? [])];
  for (const renderKey of renderKeys) {
    if (
      renderKey.canonical.sourceId !== key.sourceId ||
      renderKey.canonical.sourceRevision !== key.sourceRevision ||
      renderKey.canonical.z !== key.z ||
      renderKey.canonical.x !== key.x ||
      renderKey.canonical.y !== key.y
    ) {
      throw new RangeError('RenderTileKey 必须指向记录的 canonical key。');
    }
  }
  return {
    key,
    generation,
    planEpoch,
    lifecycleState: 'planned',
    renderRole: input.renderRole ?? 'none',
    cacheRole: input.cacheRole ?? 'none',
    renderKeys: Object.freeze(renderKeys),
    updatedAt: input.now,
  };
}

const LEGAL_TRANSITIONS: Readonly<Record<TileLifecycleState, ReadonlySet<TileLifecycleState>>> = {
  planned: new Set(['fetching', 'cancelled', 'stale', 'evicted']),
  fetching: new Set(['decoded', 'empty', 'retryable', 'failed', 'cancelled', 'stale', 'evicted']),
  decoded: new Set(['built', 'failed', 'cancelled', 'stale', 'evicted']),
  built: new Set(['uploadQueued', 'failed', 'cancelled', 'stale', 'evicted']),
  uploadQueued: new Set(['ready', 'failed', 'cancelled', 'stale', 'evicted']),
  ready: new Set(['committed', 'retained', 'evicted', 'stale', 'cancelled']),
  committed: new Set(['retained', 'uploadQueued', 'evicted', 'stale', 'cancelled']),
  retained: new Set(['planned', 'committed', 'evicted', 'stale']),
  evicted: new Set(),
  empty: new Set(['retained', 'evicted', 'stale']),
  retryable: new Set(['planned', 'fetching', 'retained', 'evicted', 'stale']),
  failed: new Set(['planned', 'retained', 'evicted', 'stale']),
  cancelled: new Set(['planned', 'evicted', 'stale']),
  stale: new Set(['evicted']),
};

/** 验证并应用一个生命周期转换。 */
export function transitionNovaTileRecord<Payload>(
  record: NovaTileRecord<Payload>,
  next: TileLifecycleState,
  now: number,
): { readonly from: TileLifecycleState; readonly to: TileLifecycleState } {
  if (!Number.isFinite(now)) {
    throw new RangeError('now 必须是有限数值。');
  }
  const from = record.lifecycleState;
  if (!LEGAL_TRANSITIONS[from].has(next)) {
    throw new Error(`Tile 不能从 ${from} 转换到 ${next}。`);
  }
  record.lifecycleState = next;
  record.updatedAt = now;
  return Object.freeze({ from, to: next });
}

/** 查询状态转换是否合法，供调度和测试在不修改记录时使用。 */
export function canTransitionNovaTile(
  from: TileLifecycleState,
  to: TileLifecycleState,
): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

export function isNovaTileTerminal(state: TileLifecycleState): boolean {
  return state === 'evicted' || state === 'empty' || state === 'failed' || state === 'cancelled' || state === 'stale';
}

export function isNovaTileInFlight(state: TileLifecycleState): boolean {
  return state === 'planned' || state === 'fetching' || state === 'decoded' || state === 'built' || state === 'uploadQueued';
}
