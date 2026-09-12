import type { CanonicalTileKey } from '../types.js';
import type { LineBatchPayload, LineLayerRecipeV1 } from './types.js';

const LINE_TOPOLOGY_VERSION = 'line-bevel-butt-v1';

/** 生成只包含 Line topology 输入的共享 key，不包含 paint 或 renderOrder。 */
export function createLineGeometryKey(
  key: CanonicalTileKey,
  recipe: LineLayerRecipeV1,
): string {
  return JSON.stringify([
    'line',
    LINE_TOPOLOGY_VERSION,
    key.sourceId,
    key.z,
    key.x,
    key.y,
    recipe.sourceLayer,
    recipe.minZoom ?? null,
    recipe.maxZoom ?? null,
    recipe.filters ?? [],
  ]);
}

/** 判断 Line 图层在当前 canonical zoom 是否参与 topology 构建。 */
export function isLineLayerVisibleAtZoom(
  recipe: LineLayerRecipeV1,
  zoom: number,
): boolean {
  return (
    (recipe.minZoom === undefined || zoom >= recipe.minZoom) &&
    (recipe.maxZoom === undefined || zoom < recipe.maxZoom)
  );
}

/** 返回一个共享 Line geometry 实际持有的 TypedArray byte 数。 */
export function getLineGeometryBytes(batch: LineBatchPayload): number {
  return (
    batch.positions.byteLength +
    batch.previous.byteLength +
    batch.next.byteLength +
    batch.sides.byteLength +
    batch.indices.byteLength +
    batch.featureIds.byteLength
  );
}

/** 保留每个 geometryKey 的首个 batch，用于资源统计去重。 */
export function getUniqueLineGeometryBatches(
  batches: readonly LineBatchPayload[],
): readonly LineBatchPayload[] {
  const seen = new Set<string>();
  const unique: LineBatchPayload[] = [];
  for (const batch of batches) {
    if (seen.has(batch.geometryKey)) {
      continue;
    }
    seen.add(batch.geometryKey);
    unique.push(batch);
  }
  return Object.freeze(unique);
}
