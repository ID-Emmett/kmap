import { GeometryBuildError } from '../geometry/types.js';
import { MvtDecodeError } from '../mvt/types.js';
import { buildTilePayload } from './buildTile.js';
import {
  getTileBuildTransferables,
  TILE_BUILD_PROTOCOL_VERSION,
} from './protocol.js';
import type {
  SerializedTileWorkerError,
  TileBuildMessageV1,
  TileWorkerErrorMessageV1,
  TileWorkerResponseV1,
} from './protocol.js';

export type TileWorkerPostMessage = (
  message: TileWorkerResponseV1,
  transfer: ArrayBuffer[],
) => void;

/** 创建可在真实 Worker 和 Node 受控 adapter 中复用的协议运行时。 */
export function createTileBuildWorkerRuntime(
  postMessage: TileWorkerPostMessage,
): {
  handleMessage: (message: unknown) => void;
} {
  const pendingJobs = new Map<
    number,
    { message: TileBuildMessageV1; timer: ReturnType<typeof setTimeout> }
  >();

  return {
    handleMessage(message: unknown): void {
      const envelope = getEnvelope(message);

      if (envelope.protocolVersion !== TILE_BUILD_PROTOCOL_VERSION) {
        postError(postMessage, envelope.jobId, envelope.generation, {
          code: 'PROTOCOL_VERSION_MISMATCH',
          message: `不支持 protocolVersion ${String(envelope.protocolVersion)}。`,
          phase: 'protocol',
          recoverable: false,
          details: { expected: TILE_BUILD_PROTOCOL_VERSION },
        });
        return;
      }

      if (envelope.type === 'cancel') {
        if (!isCancelMessage(message)) {
          postError(postMessage, envelope.jobId, envelope.generation, {
            code: 'WORKER_ERROR',
            message: 'Worker 收到无效 cancel 消息。',
            phase: 'protocol',
            recoverable: false,
          });
          return;
        }

        const pending = pendingJobs.get(envelope.jobId);

        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pendingJobs.delete(envelope.jobId);
          postError(postMessage, envelope.jobId, pending.message.generation, {
            code: 'JOB_CANCELLED',
            message: 'Worker job 已取消。',
            phase: 'build',
            recoverable: true,
          });
        }
        return;
      }

      if (envelope.type !== 'build' || !isBuildMessage(message)) {
        postError(postMessage, envelope.jobId, envelope.generation, {
          code: 'WORKER_ERROR',
          message: 'Worker 收到无效 build 消息。',
          phase: 'protocol',
          recoverable: false,
        });
        return;
      }

      if (pendingJobs.has(message.jobId)) {
        postError(postMessage, message.jobId, message.generation, {
          code: 'WORKER_ERROR',
          message: `重复的 Worker jobId ${message.jobId}。`,
          phase: 'protocol',
          recoverable: false,
        });
        return;
      }

      const timer = setTimeout(() => {
        pendingJobs.delete(message.jobId);

        try {
          const payload = buildTilePayload(message);
          postMessage(
            {
              type: 'success',
              protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
              jobId: message.jobId,
              generation: message.generation,
              payload,
            },
            getTileBuildTransferables(payload),
          );
        } catch (error) {
          postError(
            postMessage,
            message.jobId,
            message.generation,
            serializeWorkerError(error),
          );
        }
      }, 0);
      pendingJobs.set(message.jobId, { message, timer });
    },
  };
}

function serializeWorkerError(error: unknown): SerializedTileWorkerError {
  if (error instanceof MvtDecodeError) {
    return {
      code: 'DECODE_ERROR',
      message: error.message,
      phase: 'decode',
      recoverable: false,
      details: {
        kind: error.kind,
        ...(error.layerName === undefined ? {} : { layerName: error.layerName }),
        ...(error.featureIndex === undefined
          ? {}
          : { featureIndex: error.featureIndex }),
      },
    };
  }

  if (error instanceof GeometryBuildError) {
    return {
      code: 'GEOMETRY_ERROR',
      message: error.message,
      phase: 'build',
      recoverable: false,
    };
  }

  return {
    code: 'WORKER_ERROR',
    message: error instanceof Error ? error.message : '未知 Worker 错误。',
    phase: 'build',
    recoverable: false,
  };
}

function postError(
  postMessage: TileWorkerPostMessage,
  jobId: number,
  generation: number,
  error: SerializedTileWorkerError,
): void {
  const message: TileWorkerErrorMessageV1 = {
    type: 'error',
    protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
    jobId,
    generation,
    error,
  };
  postMessage(message, []);
}

function isCancelMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as { jobId?: unknown };
  return isNonNegativeSafeInteger(candidate.jobId);
}

function isBuildMessage(message: unknown): message is TileBuildMessageV1 {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as Partial<TileBuildMessageV1>;
  return (
    candidate.type === 'build' &&
    candidate.protocolVersion === TILE_BUILD_PROTOCOL_VERSION &&
    isNonNegativeSafeInteger(candidate.jobId) &&
    isNonNegativeSafeInteger(candidate.generation) &&
    candidate.data instanceof ArrayBuffer &&
    Array.isArray(candidate.layers) &&
    typeof candidate.key === 'object' &&
    candidate.key !== null
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function getEnvelope(message: unknown): {
  type: unknown;
  protocolVersion: unknown;
  jobId: number;
  generation: number;
} {
  if (typeof message !== 'object' || message === null) {
    return {
      type: undefined,
      protocolVersion: undefined,
      jobId: -1,
      generation: 0,
    };
  }

  const candidate = message as {
    type?: unknown;
    protocolVersion?: unknown;
    jobId?: unknown;
    generation?: unknown;
  };

  return {
    type: candidate.type,
    protocolVersion: candidate.protocolVersion,
    jobId: Number.isSafeInteger(candidate.jobId) ? Number(candidate.jobId) : -1,
    generation: Number.isSafeInteger(candidate.generation)
      ? Number(candidate.generation)
      : 0,
  };
}
