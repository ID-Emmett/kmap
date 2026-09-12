import type { DecodedMvtFeature } from '../mvt/types.js';
import type { TileFeatureRecord } from './types.js';

/** 记录 Line feature 与 Tile-local feature table 的映射关系。 */
export interface LineFeatureTableEntry {
  id: number;
  created: boolean;
}

/** 获取或追加 Tile-local feature id，确保共享 Line pass 复用同一映射。 */
export function getOrCreateLineFeatureId(
  sourceLayer: string,
  feature: DecodedMvtFeature,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): LineFeatureTableEntry {
  const mapKey = getLineFeatureMapKey(sourceLayer, feature.index);
  const existing = featureIdMap.get(mapKey);
  if (existing !== undefined) {
    return { id: existing, created: false };
  }

  const id = featureTable.length;
  featureIdMap.set(mapKey, id);
  featureTable.push({
    id,
    sourceLayer,
    sourceFeatureIndex: feature.index,
    ...(feature.id === undefined ? {} : { sourceFeatureId: feature.id }),
    properties: feature.properties,
  });
  return { id, created: true };
}

/** 回滚最后追加但未产生有效 geometry 的 Line feature 记录。 */
export function removeUnusedLineFeatureRecord(
  featureId: number,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): void {
  if (featureId !== featureTable.length - 1) {
    return;
  }

  const record = featureTable.pop();
  if (record !== undefined) {
    featureIdMap.delete(
      getLineFeatureMapKey(record.sourceLayer, record.sourceFeatureIndex),
    );
  }
}

function getLineFeatureMapKey(sourceLayer: string, featureIndex: number): string {
  return `${sourceLayer}\u0000${featureIndex}`;
}
