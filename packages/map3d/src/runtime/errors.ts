import type {
  CanonicalTileKey,
  MapError,
  MapErrorCode,
  MapErrorPhase,
} from '../types.js';
import { TileWorkerBuildError } from '../worker/pool.js';

/** 将固定 Tile 纵向链路错误收敛为公共结构化错误字段。 */
export function normalizeMapRuntimeError(
  error: unknown,
  tileKey: CanonicalTileKey,
): Error & MapError {
  if (isMapError(error)) {
    return error;
  }

  if (error instanceof TileWorkerBuildError) {
    return new MapRuntimeError({
      code: normalizeWorkerErrorCode(error.workerError.code),
      message: error.message,
      phase: error.workerError.phase === 'decode' ? 'decode' : 'build',
      recoverable: error.workerError.recoverable,
      tileKey,
      cause: error,
    });
  }

  return new MapRuntimeError({
    code: 'INITIALIZE_FAILED',
    message: error instanceof Error ? error.message : '地图初始化失败。',
    phase: 'initialize',
    recoverable: false,
    tileKey,
    cause: error,
  });
}

export function createMapDisposedError(): Error & MapError {
  return new MapRuntimeError({
    code: 'MAP_DISPOSED',
    message: 'Map3D 已销毁。',
    phase: 'dispose',
    recoverable: false,
  });
}

interface MapRuntimeErrorOptions {
  code: MapErrorCode;
  message: string;
  phase: MapErrorPhase;
  recoverable: boolean;
  tileKey?: CanonicalTileKey;
  cause?: unknown;
}

class MapRuntimeError extends Error implements MapError {
  readonly code: MapErrorCode;
  readonly phase: MapErrorPhase;
  readonly recoverable: boolean;
  readonly tileKey?: CanonicalTileKey;
  override readonly cause?: unknown;

  constructor(options: MapRuntimeErrorOptions) {
    super(options.message);
    this.name = 'MapRuntimeError';
    this.code = options.code;
    this.phase = options.phase;
    this.recoverable = options.recoverable;
    if (options.tileKey !== undefined) {
      this.tileKey = options.tileKey;
    }
    this.cause = options.cause;
  }
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

function normalizeWorkerErrorCode(code: string): MapErrorCode {
  if (code === 'DECODE_ERROR' || code === 'GEOMETRY_ERROR') {
    return code;
  }

  return 'WORKER_ERROR';
}
