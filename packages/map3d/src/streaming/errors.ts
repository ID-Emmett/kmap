import type { CanonicalTileKey, MapError } from '../types.js';
import { TileWorkerBuildError } from '../worker/pool.js';

export function isStreamingAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 新引擎独立收敛 Source、Worker 和 Upload 错误。 */
export function normalizeStreamingError(
  error: unknown,
  key: CanonicalTileKey,
  phase: 'request' | 'upload',
): MapError {
  if (error instanceof Error) {
    const candidate = error as Partial<MapError>;
    if (typeof candidate.code === 'string' && typeof candidate.phase === 'string' && typeof candidate.recoverable === 'boolean') {
      return { ...candidate, tileKey: candidate.tileKey ?? key } as MapError;
    }
  }
  if (error instanceof TileWorkerBuildError) {
    return {
      code: error.workerError.code === 'DECODE_ERROR' || error.workerError.code === 'GEOMETRY_ERROR' ? error.workerError.code : 'WORKER_ERROR',
      message: error.message,
      phase: error.workerError.phase === 'decode' ? 'decode' : 'build',
      recoverable: error.workerError.recoverable,
      tileKey: key,
      cause: error,
    };
  }
  return {
    code: phase === 'request' ? 'NETWORK_ERROR' : 'INITIALIZE_FAILED',
    message: error instanceof Error ? error.message : `Tile ${phase} 失败。`,
    phase,
    recoverable: phase === 'request',
    tileKey: key,
    cause: error,
  };
}
