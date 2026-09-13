/** Tile lifecycle 模块的稳定导出入口。 */
export {
  canTransitionNovaTile,
  createNovaTileRecord,
  isNovaTileInFlight,
  isNovaTileTerminal,
  transitionNovaTileRecord,
} from './state.js';
export type { NovaTileRecord, TileCacheRole, TileLifecycleState, TileRenderRole } from './state.js';
