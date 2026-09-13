/** T031 契约聚合入口，供后续 NTE 模块只依赖稳定类型。 */
export type {
  CanonicalTileKey,
  RenderTileKey,
} from './keys.js';
export type {
  NovaTileError,
  NovaTileEventMap,
  TileAsyncCancellation,
  TileAsyncFailure,
  TileAsyncIdentity,
  TileAsyncResult,
  TileAsyncSuccess,
  TilePlanEvent,
  TileStateChangeEvent,
  TileStats,
} from './events.js';
export type {
  NovaTileRecord,
  TileCacheRole,
  TileLifecycleState,
  TileRenderRole,
} from './state.js';
export type {
  FrameTime,
  NovaTileEngineContract,
} from './engine.js';
