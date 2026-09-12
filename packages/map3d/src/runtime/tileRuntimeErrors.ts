import type { CanonicalTileKey, MapError, MapErrorPhase } from '../types.js';
import { TileWorkerBuildError } from '../worker/pool.js';

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 将 Source/Worker/Upload adapter 错误收敛为公共 MapError 字段。 */
export function normalizeTileRuntimeError(
  error: unknown,
  key: CanonicalTileKey,
  phase: Extract<MapErrorPhase, 'request' | 'build' | 'upload'>,
): MapError {
  if (isMapError(error)) {
    return error;
  }

  if (error instanceof TileWorkerBuildError) {
    return {
      code:
        error.workerError.code === 'DECODE_ERROR' ||
        error.workerError.code === 'GEOMETRY_ERROR'
          ? error.workerError.code
          : 'WORKER_ERROR',
      message: error.message,
      phase: error.workerError.phase === 'decode' ? 'decode' : 'build',
      recoverable: error.workerError.recoverable,
      tileKey: key,
      cause: error,
    };
  }

  return {
    code:
      phase === 'request'
        ? 'NETWORK_ERROR'
        : phase === 'build'
          ? 'WORKER_ERROR'
          : 'INITIALIZE_FAILED',
    message: error instanceof Error ? error.message : `Tile ${phase} 失败。`,
    phase,
    recoverable: phase === 'request',
    tileKey: key,
    cause: error,
  };
}

function isMapError(error: unknown): error is Error & MapError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Partial<MapError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.phase === 'string' &&
    typeof candidate.recoverable === 'boolean'
  );
}
