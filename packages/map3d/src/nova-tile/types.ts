/** NTE 模块间共享的契约类型入口。 */
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
export type { FrameTime, NovaTileEngineContract } from './engine.js';
