import { buildLineBatches } from '../geometry/lineBatch.js';
import { buildPolygonBatches } from '../geometry/polygonBatch.js';
import type { TileBuildPayloadV1, TileLayerRecipeV1, TileFeatureRecord } from '../geometry/types.js';
import { decodeMvt } from '../mvt/decodeMvt.js';
import type { TileBuildMessageV1 } from './protocol.js';
import { TILE_BUILD_PROTOCOL_VERSION } from './protocol.js';

/** Worker 内执行 decode、filter、project 和 Polygon triangulation。 */
export function buildTilePayload(
  message: TileBuildMessageV1,
): TileBuildPayloadV1 {
  const startedAt = performance.now();
  const decoded = decodeMvt(message.data);
  const decodedAt = performance.now();
  const featureTable: TileFeatureRecord[] = [];
  const featureIdMap = new Map<string, number>();
  const polygon = buildPolygonBatches(
    decoded,
    message.key,
    message.layers.filter(
      (layer): layer is Extract<TileLayerRecipeV1, { type: 'fill' }> =>
        layer.type === 'fill',
    ),
    featureTable,
    featureIdMap,
  );
  const line = buildLineBatches(
    decoded,
    message.key,
    message.layers.filter(
      (layer): layer is Extract<TileLayerRecipeV1, { type: 'line' }> =>
        layer.type === 'line',
    ),
    featureTable,
    featureIdMap,
  );
  const batches = Object.freeze([...polygon.batches, ...line.batches]);
  const completedAt = performance.now();
  const decodedFeatures = Object.values(decoded.layers).reduce(
    (total, layer) => total + layer.features.length,
    0,
  );

  return {
    protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
    key: message.key,
    batches,
    features: Object.freeze(featureTable),
    stats: {
      decodeMs: decodedAt - startedAt,
      buildMs: completedAt - decodedAt,
      totalMs: completedAt - startedAt,
      inputBytes: message.data.byteLength,
      outputBytes: polygon.outputBytes + line.outputBytes,
      decodedFeatures,
      matchedPolygonFeatures: polygon.matchedPolygonFeatures,
      skippedPolygonFeatures: polygon.skippedPolygonFeatures,
      matchedLineFeatures: line.matchedLineFeatures,
      skippedLineFeatures: line.skippedLineFeatures,
      vertices: polygon.vertices + line.vertices,
      triangles: polygon.triangles + line.triangles,
      batches: batches.length,
    },
  };
}
