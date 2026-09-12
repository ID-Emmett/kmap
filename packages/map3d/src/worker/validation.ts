import type { TileBuildPayloadV1 } from '../geometry/types.js';
import type {
  SerializedTileWorkerError,
  TileWorkerErrorMessageV1,
  TileWorkerSuccessMessageV1,
} from './protocol.js';
import { TILE_BUILD_PROTOCOL_VERSION } from './protocol.js';

export type TileWorkerResponseEnvelopeV1 =
  | Omit<TileWorkerSuccessMessageV1, 'payload'> & { payload: unknown }
  | TileWorkerErrorMessageV1;

/** 在使用 Worker 响应前验证公共 envelope 和错误结构。 */
export function isTileWorkerResponseEnvelopeV1(
  data: unknown,
): data is TileWorkerResponseEnvelopeV1 {
  if (!isRecord(data)) {
    return false;
  }

  if (
    data.protocolVersion !== TILE_BUILD_PROTOCOL_VERSION ||
    !isNonNegativeSafeInteger(data.jobId) ||
    !isNonNegativeSafeInteger(data.generation)
  ) {
    return false;
  }

  if (data.type === 'success') {
    return Object.hasOwn(data, 'payload');
  }

  return data.type === 'error' && isSerializedWorkerError(data.error);
}

/** 验证主线程即将挂载的 version 1 Tile payload 基本结构。 */
export function isTileBuildPayloadV1(
  payload: unknown,
): payload is TileBuildPayloadV1 {
  if (
    !isRecord(payload) ||
    payload.protocolVersion !== TILE_BUILD_PROTOCOL_VERSION
  ) {
    return false;
  }

  return (
    isCanonicalTileKey(payload.key) &&
    Array.isArray(payload.batches) &&
    payload.batches.every(isTileBatch) &&
    Array.isArray(payload.features) &&
    payload.features.every(isFeatureRecord) &&
    isBuildStats(payload.stats)
  );
}

export function getWorkerResponseEnvelope(data: unknown): {
  protocolVersion: unknown;
} {
  return {
    protocolVersion: isRecord(data) ? data.protocolVersion : undefined,
  };
}

function isSerializedWorkerError(
  error: unknown,
): error is SerializedTileWorkerError {
  if (!isRecord(error)) {
    return false;
  }

  return (
    typeof error.code === 'string' &&
    [
      'PROTOCOL_VERSION_MISMATCH',
      'JOB_CANCELLED',
      'DECODE_ERROR',
      'GEOMETRY_ERROR',
      'WORKER_ERROR',
    ].includes(error.code) &&
    typeof error.message === 'string' &&
    typeof error.phase === 'string' &&
    ['protocol', 'decode', 'build'].includes(error.phase) &&
    typeof error.recoverable === 'boolean'
  );
}

function isCanonicalTileKey(key: unknown): boolean {
  return (
    isRecord(key) &&
    typeof key.sourceId === 'string' &&
    isNonNegativeSafeInteger(key.z) &&
    isNonNegativeSafeInteger(key.x) &&
    isNonNegativeSafeInteger(key.y)
  );
}

function isPolygonBatch(batch: unknown): boolean {
  if (!isRecord(batch)) {
    return false;
  }

  return (
    batch.type === 'polygon' &&
    typeof batch.layerId === 'string' &&
    isNonNegativeSafeInteger(batch.renderOrder) &&
    typeof batch.sourceLayer === 'string' &&
    isMaterialDescriptor(batch.material) &&
    batch.positions instanceof Float32Array &&
    batch.positions.length % 3 === 0 &&
    batch.indices instanceof Uint32Array &&
    batch.indices.length % 3 === 0 &&
    batch.featureIds instanceof Uint32Array &&
    batch.featureIds.length === batch.positions.length / 3 &&
    Array.isArray(batch.featureRanges) &&
    batch.featureRanges.every(isFeatureRange)
  );
}

function isTileBatch(batch: unknown): boolean {
  return isPolygonBatch(batch) || isLineBatch(batch);
}

function isLineBatch(batch: unknown): boolean {
  if (!isRecord(batch)) {
    return false;
  }

  return (
    batch.type === 'line' &&
    typeof batch.layerId === 'string' &&
    typeof batch.geometryKey === 'string' &&
    isNonNegativeSafeInteger(batch.renderOrder) &&
    typeof batch.sourceLayer === 'string' &&
    isLineMaterialDescriptor(batch.material) &&
    batch.positions instanceof Float32Array &&
    batch.positions.length % 3 === 0 &&
    batch.previous instanceof Float32Array &&
    batch.previous.length === batch.positions.length &&
    batch.next instanceof Float32Array &&
    batch.next.length === batch.positions.length &&
    batch.sides instanceof Float32Array &&
    batch.sides.length === batch.positions.length / 3 &&
    batch.indices instanceof Uint32Array &&
    batch.indices.length % 3 === 0 &&
    batch.featureIds instanceof Uint32Array &&
    batch.featureIds.length === batch.positions.length / 3 &&
    Array.isArray(batch.featureRanges) &&
    batch.featureRanges.every(isFeatureRange)
  );
}

function isLineMaterialDescriptor(material: unknown): boolean {
  if (!isMaterialDescriptor(material)) {
    return false;
  }
  const candidate = material as Record<string, unknown>;
  return (
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    candidate.width > 0
  );
}

function isMaterialDescriptor(material: unknown): boolean {
  return (
    isRecord(material) &&
    typeof material.key === 'string' &&
    (typeof material.color === 'string' ||
      (typeof material.color === 'number' && Number.isFinite(material.color))) &&
    typeof material.opacity === 'number' &&
    Number.isFinite(material.opacity)
  );
}

function isFeatureRange(range: unknown): boolean {
  return (
    isRecord(range) &&
    isNonNegativeSafeInteger(range.featureId) &&
    isNonNegativeSafeInteger(range.vertexOffset) &&
    isNonNegativeSafeInteger(range.vertexCount) &&
    isNonNegativeSafeInteger(range.indexOffset) &&
    isNonNegativeSafeInteger(range.indexCount)
  );
}

function isFeatureRecord(feature: unknown): boolean {
  return (
    isRecord(feature) &&
    isNonNegativeSafeInteger(feature.id) &&
    typeof feature.sourceLayer === 'string' &&
    isNonNegativeSafeInteger(feature.sourceFeatureIndex) &&
    (feature.sourceFeatureId === undefined ||
      (typeof feature.sourceFeatureId === 'number' &&
        Number.isFinite(feature.sourceFeatureId))) &&
    isRecord(feature.properties)
  );
}

function isBuildStats(stats: unknown): boolean {
  if (!isRecord(stats)) {
    return false;
  }

  return [
    'decodeMs',
    'buildMs',
    'totalMs',
    'inputBytes',
    'outputBytes',
    'decodedFeatures',
    'matchedPolygonFeatures',
    'skippedPolygonFeatures',
    'matchedLineFeatures',
    'skippedLineFeatures',
    'vertices',
    'triangles',
    'batches',
  ].every(
    (key) =>
      typeof stats[key] === 'number' &&
      Number.isFinite(stats[key]) &&
      Number(stats[key]) >= 0,
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
