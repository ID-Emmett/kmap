import type { CanonicalTileKey, MapError } from '../types.js';
/** 公共错误携带可验证的阶段、代码和恢复性。 */
export function createMapDisposedError(): Error & MapError {
  return Object.assign(new Error('Map3D 已销毁。'), { code: 'MAP_DISPOSED' as const, phase: 'dispose' as const, recoverable: false });
}
export function normalizeMapRuntimeError(error: unknown, tileKey: CanonicalTileKey): Error & MapError {
  if (error instanceof Error && 'code' in error && 'phase' in error && 'recoverable' in error) return error as Error & MapError;
  return Object.assign(new Error(error instanceof Error ? error.message : String(error)), { code: 'INITIALIZE_FAILED' as const, phase: 'initialize' as const, recoverable: false, tileKey, cause: error });
}
