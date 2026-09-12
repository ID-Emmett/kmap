import type {
  DecodedMvtLayer,
  DecodedMvtPoint,
  DecodedMvtTile,
} from '../mvt/types.js';
import { getTileSpanMeters } from '../spatial/mercator.js';
import type { CanonicalTileKey } from '../types.js';
import { matchesLayerFilters } from './filter.js';
import {
  createLineGeometryKey,
  getLineGeometryBytes,
  isLineLayerVisibleAtZoom,
} from './lineGeometrySharing.js';
import {
  getOrCreateLineFeatureId,
  removeUnusedLineFeatureRecord,
} from './lineFeatureTable.js';
import type {
  LineBatchPayload,
  LineLayerRecipeV1,
  PolygonFeatureRange,
  TileFeatureRecord,
} from './types.js';
import { GeometryBuildError } from './types.js';

export interface LineBuildResult {
  batches: readonly LineBatchPayload[];
  matchedLineFeatures: number;
  skippedLineFeatures: number;
  outputBytes: number;
  vertices: number;
  triangles: number;
}

/** 将 MVT LineString 生成为屏幕空间段 quad 与 bevel join 拓扑。 */
export function buildLineBatches(
  tile: DecodedMvtTile,
  key: CanonicalTileKey,
  recipes: readonly LineLayerRecipeV1[],
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): LineBuildResult {
  const batches: LineBatchPayload[] = [];
  let matchedLineFeatures = 0;
  let skippedLineFeatures = 0;
  let outputBytes = 0;
  let vertices = 0;
  let triangles = 0;
  const sharedBatches = new Map<string, LayerBatchResult>();

  for (let recipeIndex = 0; recipeIndex < recipes.length; recipeIndex += 1) {
    const recipe = recipes[recipeIndex]!;
    if (!isLineLayerVisibleAtZoom(recipe, key.z)) {
      continue;
    }

    const sourceLayer = tile.layers[recipe.sourceLayer];
    if (sourceLayer === undefined) {
      continue;
    }

    const geometryKey = createLineGeometryKey(key, recipe);
    let result = sharedBatches.get(geometryKey);
    if (result === undefined) {
      result = buildLineLayerBatch(
        sourceLayer,
        key,
        recipe,
        recipe.renderOrder ?? recipeIndex,
        geometryKey,
        featureTable,
        featureIdMap,
      );
      sharedBatches.set(geometryKey, result);
      if (result.payload !== undefined) {
        outputBytes += getLineGeometryBytes(result.payload);
        vertices += result.payload.positions.length / 3;
        triangles += result.payload.indices.length / 3;
      }
    }
    matchedLineFeatures += result.matchedLineFeatures;
    skippedLineFeatures += result.skippedLineFeatures;
    if (result.payload === undefined) {
      continue;
    }

    batches.push(
      createLineRenderPass(
        result.payload,
        recipe,
        recipe.renderOrder ?? recipeIndex,
      ),
    );
  }

  return {
    batches: Object.freeze(batches),
    matchedLineFeatures,
    skippedLineFeatures,
    outputBytes,
    vertices,
    triangles,
  };
}

interface LayerBatchResult {
  payload?: LineBatchPayload;
  matchedLineFeatures: number;
  skippedLineFeatures: number;
}

function buildLineLayerBatch(
  sourceLayer: DecodedMvtLayer,
  key: CanonicalTileKey,
  recipe: LineLayerRecipeV1,
  renderOrder: number,
  geometryKey: string,
  featureTable: TileFeatureRecord[],
  featureIdMap: Map<string, number>,
): LayerBatchResult {
  const positions: number[] = [];
  const previous: number[] = [];
  const next: number[] = [];
  const sides: number[] = [];
  const indices: number[] = [];
  const vertexFeatureIds: number[] = [];
  const featureRanges: PolygonFeatureRange[] = [];
  const metersPerExtent = getTileSpanMeters(key.z) / sourceLayer.extent;
  let matchedLineFeatures = 0;
  let skippedLineFeatures = 0;

  for (const feature of sourceLayer.features) {
    if (
      feature.type !== 'line' ||
      !matchesLayerFilters(feature.properties, recipe.filters)
    ) {
      continue;
    }

    const featureRecord = getOrCreateLineFeatureId(
      sourceLayer.name,
      feature,
      featureTable,
      featureIdMap,
    );
    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;

    try {
      for (const path of feature.geometry) {
        appendLinePath(
          path,
          metersPerExtent,
          featureRecord.id,
          positions,
          previous,
          next,
          sides,
          indices,
          vertexFeatureIds,
        );
      }
    } catch (cause) {
      rollbackLineGeometry(
        vertexOffset,
        indexOffset,
        positions,
        previous,
        next,
        sides,
        indices,
        vertexFeatureIds,
      );
      if (featureRecord.created) {
        removeUnusedLineFeatureRecord(
          featureRecord.id,
          featureTable,
          featureIdMap,
        );
      }
      throw new GeometryBuildError(
        `source-layer ${sourceLayer.name} feature ${feature.index} Line 构建失败。`,
        cause,
      );
    }

    const vertexCount = positions.length / 3 - vertexOffset;
    const indexCount = indices.length - indexOffset;
    if (vertexCount === 0 || indexCount === 0) {
      rollbackLineGeometry(
        vertexOffset,
        indexOffset,
        positions,
        previous,
        next,
        sides,
        indices,
        vertexFeatureIds,
      );
      skippedLineFeatures += 1;
      if (featureRecord.created) {
        removeUnusedLineFeatureRecord(
          featureRecord.id,
          featureTable,
          featureIdMap,
        );
      }
      continue;
    }

    matchedLineFeatures += 1;
    featureRanges.push({
      featureId: featureRecord.id,
      vertexOffset,
      vertexCount,
      indexOffset,
      indexCount,
    });
  }

  if (indices.length === 0) {
    return { matchedLineFeatures, skippedLineFeatures };
  }

  return {
    matchedLineFeatures,
    skippedLineFeatures,
    payload: {
      type: 'line',
      layerId: recipe.id,
      geometryKey,
      renderOrder,
      sourceLayer: recipe.sourceLayer,
      material: recipe.material,
      positions: new Float32Array(positions),
      previous: new Float32Array(previous),
      next: new Float32Array(next),
      sides: new Float32Array(sides),
      indices: new Uint32Array(indices),
      featureIds: new Uint32Array(vertexFeatureIds),
      featureRanges: Object.freeze(featureRanges),
    },
  };
}

function createLineRenderPass(
  shared: LineBatchPayload,
  recipe: LineLayerRecipeV1,
  renderOrder: number,
): LineBatchPayload {
  return {
    ...shared,
    layerId: recipe.id,
    renderOrder,
    material: recipe.material,
  };
}

function appendLinePath(
  rawPath: readonly DecodedMvtPoint[],
  metersPerExtent: number,
  featureId: number,
  positions: number[],
  previous: number[],
  next: number[],
  sides: number[],
  indices: number[],
  featureIds: number[],
): void {
  const path = cleanPath(rawPath);
  if (path.length < 2) {
    return;
  }

  for (let index = 0; index + 1 < path.length; index += 1) {
    const start = path[index]!;
    const end = path[index + 1]!;
    const base = positions.length / 3;
    const beforeStart = reflectPoint(start, end);
    const afterEnd = reflectPoint(end, start);
    pushVertex(
      start,
      beforeStart,
      end,
      -1,
      metersPerExtent,
      positions,
      previous,
      next,
      sides,
      featureIds,
      featureId,
    );
    pushVertex(
      start,
      beforeStart,
      end,
      1,
      metersPerExtent,
      positions,
      previous,
      next,
      sides,
      featureIds,
      featureId,
    );
    pushVertex(
      end,
      start,
      afterEnd,
      -1,
      metersPerExtent,
      positions,
      previous,
      next,
      sides,
      featureIds,
      featureId,
    );
    pushVertex(
      end,
      start,
      afterEnd,
      1,
      metersPerExtent,
      positions,
      previous,
      next,
      sides,
      featureIds,
      featureId,
    );
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  for (let index = 1; index + 1 < path.length; index += 1) {
    appendBevelJoin(
      path[index - 1]!,
      path[index]!,
      path[index + 1]!,
      metersPerExtent,
      featureId,
      positions,
      previous,
      next,
      sides,
      indices,
      featureIds,
    );
  }
}

function appendBevelJoin(
  before: DecodedMvtPoint,
  point: DecodedMvtPoint,
  after: DecodedMvtPoint,
  metersPerExtent: number,
  featureId: number,
  positions: number[],
  previous: number[],
  next: number[],
  sides: number[],
  indices: number[],
  featureIds: number[],
): void {
  const incoming = { x: point.x - before.x, y: point.y - before.y };
  const outgoing = { x: after.x - point.x, y: after.y - point.y };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  if (Math.abs(cross) < 1e-9) {
    return;
  }

  const side = Math.sign(cross);
  const base = positions.length / 3;
  pushVertex(
    point,
    before,
    reflectPoint(point, before),
    side,
    metersPerExtent,
    positions,
    previous,
    next,
    sides,
    featureIds,
    featureId,
  );
  pushVertex(
    point,
    before,
    after,
    0,
    metersPerExtent,
    positions,
    previous,
    next,
    sides,
    featureIds,
    featureId,
  );
  pushVertex(
    point,
    reflectPoint(point, after),
    after,
    side,
    metersPerExtent,
    positions,
    previous,
    next,
    sides,
    featureIds,
    featureId,
  );
  indices.push(base, base + 1, base + 2);
}

function pushVertex(
  point: DecodedMvtPoint,
  previousPoint: DecodedMvtPoint,
  nextPoint: DecodedMvtPoint,
  side: number,
  metersPerExtent: number,
  positions: number[],
  previous: number[],
  next: number[],
  sides: number[],
  featureIds: number[],
  featureId: number,
): void {
  pushPoint(point, metersPerExtent, positions);
  pushPoint(previousPoint, metersPerExtent, previous);
  pushPoint(nextPoint, metersPerExtent, next);
  sides.push(side);
  featureIds.push(featureId);
}

function pushPoint(
  point: DecodedMvtPoint,
  metersPerExtent: number,
  output: number[],
): void {
  output.push(point.x * metersPerExtent, 0, point.y * metersPerExtent);
}

function reflectPoint(
  point: DecodedMvtPoint,
  neighbor: DecodedMvtPoint,
): DecodedMvtPoint {
  return {
    x: point.x * 2 - neighbor.x,
    y: point.y * 2 - neighbor.y,
  };
}

function cleanPath(path: readonly DecodedMvtPoint[]): DecodedMvtPoint[] {
  const cleaned: DecodedMvtPoint[] = [];
  for (const point of path) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('Line 顶点必须是有限数值。');
    }
    const previous = cleaned.at(-1);
    if (previous?.x === point.x && previous.y === point.y) {
      continue;
    }
    cleaned.push(point);
  }
  return cleaned;
}

function rollbackLineGeometry(
  vertexOffset: number,
  indexOffset: number,
  positions: number[],
  previous: number[],
  next: number[],
  sides: number[],
  indices: number[],
  featureIds: number[],
): void {
  positions.length = vertexOffset * 3;
  previous.length = vertexOffset * 3;
  next.length = vertexOffset * 3;
  sides.length = vertexOffset;
  indices.length = indexOffset;
  featureIds.length = vertexOffset;
}
