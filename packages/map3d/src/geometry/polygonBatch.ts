import earcut from 'earcut';

import type {
  DecodedMvtFeature,
  DecodedMvtLayer,
  DecodedMvtPoint,
  DecodedMvtTile,
} from '../mvt/types.js';
import { getTileSpanMeters } from '../spatial/mercator.js';
import type { CanonicalTileKey } from '../types.js';
import { matchesLayerFilters } from './filter.js';
import { clipTriangleToTileExtent } from './polygonClip.js';
import { classifyPolygonRings } from './polygonRings.js';
import type {
  PolygonBatchPayload,
  PolygonFeatureRange,
  PolygonLayerRecipeV1,
  TileFeatureRecord,
} from './types.js';
import { GeometryBuildError } from './types.js';

export interface PolygonBuildResult {
  batches: readonly PolygonBatchPayload[];
  features: readonly TileFeatureRecord[];
  matchedPolygonFeatures: number;
  skippedPolygonFeatures: number;
  outputBytes: number;
  vertices: number;
  triangles: number;
}

/** 将已解码 MVT Polygon 合并为 Tile 内有限批次。 */
export function buildPolygonBatches(
  tile: DecodedMvtTile,
  key: CanonicalTileKey,
  recipes: readonly PolygonLayerRecipeV1[],
  featureTable: TileFeatureRecord[] = [],
  featureIdMap: Map<string, number> = new Map(),
): PolygonBuildResult {
  validateRecipes(recipes);
  const batches: PolygonBatchPayload[] = [];
  let matchedPolygonFeatures = 0;
  let skippedPolygonFeatures = 0;
  let outputBytes = 0;
  let vertices = 0;
  let triangles = 0;

  for (let recipeIndex = 0; recipeIndex < recipes.length; recipeIndex += 1) {
    const recipe = recipes[recipeIndex]!;
    if (!isLayerVisibleAtZoom(recipe, key.z)) {
      continue;
    }

    const sourceLayer = tile.layers[recipe.sourceLayer];

    if (sourceLayer === undefined) {
      continue;
    }

    const batch = buildLayerBatch(
      sourceLayer,
      key,
      recipe,
      recipe.renderOrder ?? recipeIndex,
      featureTable,
      featureIdMap,
    );
    matchedPolygonFeatures += batch.matchedPolygonFeatures;
    skippedPolygonFeatures += batch.skippedPolygonFeatures;

    if (batch.payload === undefined) {
      continue;
    }

    batches.push(batch.payload);
    outputBytes +=
      batch.payload.positions.byteLength +
      batch.payload.indices.byteLength +
      batch.payload.featureIds.byteLength;
    vertices += batch.payload.positions.length / 3;
    triangles += batch.payload.indices.length / 3;
  }

  return {
    batches: Object.freeze(batches),
    features: Object.freeze([...featureTable]),
    matchedPolygonFeatures,
    skippedPolygonFeatures,
    outputBytes,
    vertices,
    triangles,
  };
}

interface LayerBatchBuildResult {
  payload?: PolygonBatchPayload;
  matchedPolygonFeatures: number;
  skippedPolygonFeatures: number;
}

function buildLayerBatch(
  sourceLayer: DecodedMvtLayer,
  key: CanonicalTileKey,
  recipe: PolygonLayerRecipeV1,
  renderOrder: number,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): LayerBatchBuildResult {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexFeatureIds: number[] = [];
  const featureRanges: PolygonFeatureRange[] = [];
  const metersPerExtent = getTileSpanMeters(key.z) / sourceLayer.extent;
  let matchedPolygonFeatures = 0;
  let skippedPolygonFeatures = 0;

  for (const feature of sourceLayer.features) {
    if (
      feature.type !== 'polygon' ||
      !matchesLayerFilters(feature.properties, recipe.filters)
    ) {
      continue;
    }

    const polygons = classifyPolygonRings(feature.geometry);

    if (polygons.length === 0) {
      skippedPolygonFeatures += 1;
      continue;
    }

    const featureRecord = getOrCreateFeatureId(
      sourceLayer.name,
      feature,
      featureTable,
      featureIdMap,
    );
    const featureId = featureRecord.id;
    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;

    try {
      for (const polygon of polygons) {
        appendTriangulatedPolygon(
          polygon,
          sourceLayer.extent,
          metersPerExtent,
          featureId,
          positions,
          indices,
          vertexFeatureIds,
        );
      }
    } catch (cause) {
      rollbackFeatureGeometry(
        vertexOffset,
        indexOffset,
        positions,
        indices,
        vertexFeatureIds,
      );
      if (featureRecord.created) {
        removeUnusedFeatureRecord(featureId, featureTable, featureIdMap);
      }
      throw new GeometryBuildError(
        `source-layer ${sourceLayer.name} feature ${feature.index} 三角化失败。`,
        cause,
      );
    }

    const vertexCount = positions.length / 3 - vertexOffset;
    const indexCount = indices.length - indexOffset;

    if (vertexCount === 0 || indexCount === 0) {
      rollbackFeatureGeometry(
        vertexOffset,
        indexOffset,
        positions,
        indices,
        vertexFeatureIds,
      );
      skippedPolygonFeatures += 1;
      if (featureRecord.created) {
        removeUnusedFeatureRecord(featureId, featureTable, featureIdMap);
      }
      continue;
    }

    matchedPolygonFeatures += 1;
    featureRanges.push({
      featureId,
      vertexOffset,
      vertexCount,
      indexOffset,
      indexCount,
    });
  }

  if (indices.length === 0) {
    return { matchedPolygonFeatures, skippedPolygonFeatures };
  }

  return {
    matchedPolygonFeatures,
    skippedPolygonFeatures,
    payload: {
      type: 'polygon',
      layerId: recipe.id,
      renderOrder,
      sourceLayer: recipe.sourceLayer,
      material: recipe.material,
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      featureIds: new Uint32Array(vertexFeatureIds),
      featureRanges: Object.freeze(featureRanges),
    },
  };
}

function appendTriangulatedPolygon(
  polygon: readonly (readonly DecodedMvtPoint[])[],
  extent: number,
  metersPerExtent: number,
  featureId: number,
  positions: number[],
  indices: number[],
  vertexFeatureIds: number[],
): void {
  const flat: number[] = [];
  const holes: number[] = [];

  for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
    const ring = polygon[ringIndex];

    if (ring === undefined) {
      continue;
    }

    if (ringIndex > 0) {
      holes.push(flat.length / 2);
    }

    for (const point of ring) {
      flat.push(point.x, point.y);
    }
  }

  const triangulated = earcut(flat, holes, 2);

  if (triangulated.length === 0) {
    return;
  }

  for (let index = 0; index < triangulated.length; index += 3) {
    const a = triangulated[index];
    const b = triangulated[index + 1];
    const c = triangulated[index + 2];

    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      isDegenerateTriangle(flat, a, b, c)
    ) {
      continue;
    }

    const ax = flat[a * 2];
    const ay = flat[a * 2 + 1];
    const bx = flat[b * 2];
    const by = flat[b * 2 + 1];
    const cx = flat[c * 2];
    const cy = flat[c * 2 + 1];
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined ||
      cx === undefined ||
      cy === undefined
    ) {
      continue;
    }
    appendClippedTriangle(
      [
        { x: ax, y: ay },
        { x: bx, y: by },
        { x: cx, y: cy },
      ],
      extent,
      metersPerExtent,
      featureId,
      positions,
      indices,
      vertexFeatureIds,
    );
  }
}

function appendClippedTriangle(
  triangle: readonly [DecodedMvtPoint, DecodedMvtPoint, DecodedMvtPoint],
  extent: number,
  metersPerExtent: number,
  featureId: number,
  positions: number[],
  indices: number[],
  vertexFeatureIds: number[],
): void {
  const clipped = clipTriangleToTileExtent(triangle, extent);
  if (clipped.length < 3) {
    return;
  }

  const vertexOffset = positions.length / 3;
  for (const point of clipped) {
    positions.push(point.x * metersPerExtent, 0, point.y * metersPerExtent);
    vertexFeatureIds.push(featureId);
  }

  for (let index = 1; index + 1 < clipped.length; index += 1) {
    if (!isPointTriangleDegenerate(clipped[0]!, clipped[index]!, clipped[index + 1]!)) {
      indices.push(vertexOffset, vertexOffset + index, vertexOffset + index + 1);
    }
  }
}

function isPointTriangleDegenerate(
  a: DecodedMvtPoint,
  b: DecodedMvtPoint,
  c: DecodedMvtPoint,
): boolean {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) === 0;
}

function isDegenerateTriangle(
  coordinates: readonly number[],
  a: number,
  b: number,
  c: number,
): boolean {
  const ax = coordinates[a * 2];
  const ay = coordinates[a * 2 + 1];
  const bx = coordinates[b * 2];
  const by = coordinates[b * 2 + 1];
  const cx = coordinates[c * 2];
  const cy = coordinates[c * 2 + 1];

  if (
    ax === undefined ||
    ay === undefined ||
    bx === undefined ||
    by === undefined ||
    cx === undefined ||
    cy === undefined
  ) {
    return true;
  }

  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) === 0;
}

function getOrCreateFeatureId(
  sourceLayer: string,
  feature: DecodedMvtFeature,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): { id: number; created: boolean } {
  const key = `${sourceLayer}\u0000${feature.index}`;
  const existing = featureIdMap.get(key);

  if (existing !== undefined) {
    return { id: existing, created: false };
  }

  const id = featureTable.length;
  featureIdMap.set(key, id);
  featureTable.push({
    id,
    sourceLayer,
    sourceFeatureIndex: feature.index,
    ...(feature.id === undefined ? {} : { sourceFeatureId: feature.id }),
    properties: feature.properties,
  });
  return { id, created: true };
}

function rollbackFeatureGeometry(
  vertexOffset: number,
  indexOffset: number,
  positions: number[],
  indices: number[],
  featureIds: number[],
): void {
  positions.length = vertexOffset * 3;
  indices.length = indexOffset;
  featureIds.length = vertexOffset;
}

function removeUnusedFeatureRecord(
  featureId: number,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): void {
  if (featureId !== featureTable.length - 1) {
    return;
  }

  const record = featureTable.pop();

  if (record !== undefined) {
    featureIdMap.delete(`${record.sourceLayer}\u0000${record.sourceFeatureIndex}`);
  }
}

function isLayerVisibleAtZoom(
  recipe: PolygonLayerRecipeV1,
  zoom: number,
): boolean {
  return (
    (recipe.minZoom === undefined || zoom >= recipe.minZoom) &&
    (recipe.maxZoom === undefined || zoom < recipe.maxZoom)
  );
}

function validateRecipes(recipes: readonly PolygonLayerRecipeV1[]): void {
  const layerIds = new Set<string>();

  for (const recipe of recipes) {
    if (layerIds.has(recipe.id)) {
      throw new GeometryBuildError(`重复的 layer id：${recipe.id}。`);
    }
    layerIds.add(recipe.id);
  }
}
