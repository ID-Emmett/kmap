/**
 * 迁移兼容入口：生产代码统一使用 TileEngineV2。
 * 旧测试和内部适配器仍可通过该名称引用相同实现，但不会创建第二套运行时。
 */
export {
  TileEngineV2 as TileRuntime,
  TILE_CANCEL_GRACE_MS,
  TILE_PROGRESS_CANCEL_GRACE_MS,
} from './tileEngineV2.js';
