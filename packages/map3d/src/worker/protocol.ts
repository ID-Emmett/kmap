import type { CanonicalTileKey } from '../types.js';
import type { TileBuildPayloadV1, TileLayerRecipeV1 } from '../geometry/types.js';

export const TILE_BUILD_PROTOCOL_VERSION = 1 as const;

export interface TileBuildMessageV1 {
  type: 'build';
  protocolVersion: 1;
  jobId: number;
  generation: number;
  key: CanonicalTileKey;
  data: ArrayBuffer;
  layers: readonly TileLayerRecipeV1[];
}

export interface TileCancelMessageV1 {
  type: 'cancel';
  protocolVersion: 1;
  jobId: number;
}

export type TileWorkerRequestV1 = TileBuildMessageV1 | TileCancelMessageV1;

export interface SerializedTileWorkerError {
  code:
    | 'PROTOCOL_VERSION_MISMATCH'
    | 'JOB_CANCELLED'
    | 'DECODE_ERROR'
    | 'GEOMETRY_ERROR'
    | 'WORKER_ERROR';
  message: string;
  phase: 'protocol' | 'decode' | 'build';
  recoverable: boolean;
  details?: Readonly<Record<string, unknown>>;
}

export interface TileWorkerSuccessMessageV1 {
  type: 'success';
  protocolVersion: 1;
  jobId: number;
  generation: number;
  payload: TileBuildPayloadV1;
}

export interface TileWorkerErrorMessageV1 {
  type: 'error';
  protocolVersion: 1;
  jobId: number;
  generation: number;
  error: SerializedTileWorkerError;
}

export type TileWorkerResponseV1 =
  | TileWorkerSuccessMessageV1
  | TileWorkerErrorMessageV1;

/** 收集 Worker success 消息中的主要 transferable buffers。 */
export function getTileBuildTransferables(
  payload: TileBuildPayloadV1,
): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();

  for (const batch of payload.batches) {
    pushTransferable(buffers, seen, batch.positions.buffer);
    if (batch.type === 'line') {
      pushTransferable(buffers, seen, batch.previous.buffer);
      pushTransferable(buffers, seen, batch.next.buffer);
      pushTransferable(buffers, seen, batch.sides.buffer);
    }
    pushTransferable(buffers, seen, batch.indices.buffer);
    pushTransferable(buffers, seen, batch.featureIds.buffer);
  }

  return buffers;
}

function pushTransferable(
  buffers: ArrayBuffer[],
  seen: Set<ArrayBuffer>,
  buffer: ArrayBufferLike,
): void {
  const transferable = requireArrayBuffer(buffer);
  if (seen.has(transferable)) {
    return;
  }
  seen.add(transferable);
  buffers.push(transferable);
}

function requireArrayBuffer(buffer: ArrayBufferLike): ArrayBuffer {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError('Worker payload 不支持 SharedArrayBuffer。');
  }

  return buffer;
}
