import type {
  CanonicalTileKey,
  FillLayerOptions,
  LayerFilter,
  LayerPropertyValue,
  LineLayerOptions,
  MapError,
} from '../types.js';

/** Worker 可结构化克隆的 fill material 描述。 */
export interface PolygonMaterialDescriptor {
  key: string;
  color: string | number;
  opacity: number;
}

/** Worker 协议使用的 Polygon 图层 recipe。 */
export interface PolygonLayerRecipeV1 {
  type: 'fill';
  id: string;
  renderOrder?: number;
  sourceLayer: string;
  minZoom?: number;
  maxZoom?: number;
  filters?: readonly LayerFilter[];
  material: PolygonMaterialDescriptor;
}

/** Worker 协议使用的 Line 图层 recipe。 */
export interface LineLayerRecipeV1 {
  type: 'line';
  id: string;
  renderOrder?: number;
  sourceLayer: string;
  minZoom?: number;
  maxZoom?: number;
  filters?: readonly LayerFilter[];
  material: LineMaterialDescriptor;
}

export type TileLayerRecipeV1 = PolygonLayerRecipeV1 | LineLayerRecipeV1;

/** 屏幕空间 Line 的常量材质描述；宽度单位为 CSS pixel。 */
export interface LineMaterialDescriptor {
  key: string;
  color: string | number;
  opacity: number;
  width: number;
}

/** 批次内单个 feature 对应的连续顶点和索引范围。 */
export interface PolygonFeatureRange {
  featureId: number;
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
}

/** Tile × layer × material 的 Polygon 可上传批次。 */
export interface PolygonBatchPayload {
  type: 'polygon';
  layerId: string;
  renderOrder: number;
  sourceLayer: string;
  material: PolygonMaterialDescriptor;
  /** 每个顶点为 scene X/Y/Z：east、0、south。 */
  positions: Float32Array;
  indices: Uint32Array;
  /** 每个顶点对应的 tile-local feature id。 */
  featureIds: Uint32Array;
  featureRanges: readonly PolygonFeatureRange[];
}

/** Tile × layer × material 的 Line 三角带批次。 */
export interface LineBatchPayload {
  type: 'line';
  layerId: string;
  /** 同一 Tile 内可共享 Line topology/GPU geometry 的稳定 key。 */
  geometryKey: string;
  renderOrder: number;
  sourceLayer: string;
  material: LineMaterialDescriptor;
  /** 当前路径点的 Tile-local scene X/Y/Z：east、0、south。 */
  positions: Float32Array;
  /** 相邻前一点；端点使用沿首段反向外推的虚拟点。 */
  previous: Float32Array;
  /** 相邻后一点；端点使用沿末段正向外推的虚拟点。 */
  next: Float32Array;
  /** 三角带两侧；-1/1 为边缘，0 为 bevel join 中心。 */
  sides: Float32Array;
  indices: Uint32Array;
  /** 每个顶点对应的 tile-local feature id。 */
  featureIds: Uint32Array;
  featureRanges: readonly PolygonFeatureRange[];
}

export type TileBatchPayload = PolygonBatchPayload | LineBatchPayload;

/** Tile 内用于回溯原始 MVT feature 的表。 */
export interface TileFeatureRecord {
  id: number;
  sourceLayer: string;
  sourceFeatureIndex: number;
  sourceFeatureId?: number;
  properties: Readonly<Record<string, LayerPropertyValue>>;
}

/** Worker decode/build 的确定性统计。 */
export interface TileBuildStats {
  decodeMs: number;
  buildMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
  decodedFeatures: number;
  matchedPolygonFeatures: number;
  skippedPolygonFeatures: number;
  matchedLineFeatures: number;
  skippedLineFeatures: number;
  vertices: number;
  triangles: number;
  batches: number;
}

/** Worker 构建成功的 Tile payload。 */
export interface TileBuildPayloadV1 {
  protocolVersion: 1;
  key: CanonicalTileKey;
  batches: readonly TileBatchPayload[];
  features: readonly TileFeatureRecord[];
  stats: TileBuildStats;
}

/** Polygon recipe 由已批准的公共 fill layer 生成。 */
export function createPolygonLayerRecipe(
  layer: FillLayerOptions,
  renderOrder?: number,
): PolygonLayerRecipeV1 {
  const id = requireNonEmpty(layer.id, 'layer.id');
  const sourceLayer = requireNonEmpty(layer.sourceLayer, 'layer.sourceLayer');
  const opacity = layer.paint.opacity ?? 1;

  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('fill opacity 必须位于 0 到 1。');
  }

  if (
    (typeof layer.paint.color === 'string' && layer.paint.color.length === 0) ||
    (typeof layer.paint.color === 'number' && !Number.isFinite(layer.paint.color))
  ) {
    throw new RangeError('fill color 必须是非空字符串或有限数值。');
  }

  const minZoom = normalizeLayerZoom(layer.minZoom, 'layer.minZoom');
  const maxZoom = normalizeLayerZoom(layer.maxZoom, 'layer.maxZoom');

  if (
    minZoom !== undefined &&
    maxZoom !== undefined &&
    minZoom > maxZoom
  ) {
    throw new RangeError('layer.minZoom 不能大于 layer.maxZoom。');
  }

  const filters = layer.filters?.map(cloneFilter);
  const material = Object.freeze({
    key: JSON.stringify(['fill', layer.paint.color, opacity]),
    color: layer.paint.color,
    opacity,
  });

  return Object.freeze({
    type: 'fill',
    id,
    ...(renderOrder === undefined
      ? {}
      : { renderOrder: normalizeRenderOrder(renderOrder) }),
    sourceLayer,
    ...(minZoom === undefined ? {} : { minZoom }),
    ...(maxZoom === undefined ? {} : { maxZoom }),
    ...(filters === undefined ? {} : { filters: Object.freeze(filters) }),
    material,
  });
}

/** Line recipe 由已批准的公共 line layer 生成。 */
export function createLineLayerRecipe(
  layer: LineLayerOptions,
  renderOrder?: number,
): LineLayerRecipeV1 {
  const id = requireNonEmpty(layer.id, 'layer.id');
  const sourceLayer = requireNonEmpty(layer.sourceLayer, 'layer.sourceLayer');
  const opacity = layer.paint.opacity ?? 1;
  const width = layer.paint.width ?? 1;

  validatePaint(opacity, layer.paint.color, 'line');
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError('line width 必须是正有限数值。');
  }

  const minZoom = normalizeLayerZoom(layer.minZoom, 'layer.minZoom');
  const maxZoom = normalizeLayerZoom(layer.maxZoom, 'layer.maxZoom');
  if (minZoom !== undefined && maxZoom !== undefined && minZoom > maxZoom) {
    throw new RangeError('layer.minZoom 不能大于 layer.maxZoom。');
  }

  const filters = layer.filters?.map(cloneFilter);
  const material = Object.freeze({
    key: JSON.stringify(['line', layer.paint.color, opacity, width]),
    color: layer.paint.color,
    opacity,
    width,
  });

  return Object.freeze({
    type: 'line',
    id,
    ...(renderOrder === undefined
      ? {}
      : { renderOrder: normalizeRenderOrder(renderOrder) }),
    sourceLayer,
    ...(minZoom === undefined ? {} : { minZoom }),
    ...(maxZoom === undefined ? {} : { maxZoom }),
    ...(filters === undefined ? {} : { filters: Object.freeze(filters) }),
    material,
  });
}

/** Geometry 阶段的结构化错误。 */
export class GeometryBuildError extends Error implements MapError {
  readonly code = 'GEOMETRY_ERROR';
  readonly phase = 'build';
  readonly recoverable = false;
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GeometryBuildError';
    this.cause = cause;
  }
}

function cloneFilter(filter: LayerFilter): LayerFilter {
  const property = requireNonEmpty(filter.property, 'filter.property');

  switch (filter.operator) {
    case 'has':
      return Object.freeze({ operator: 'has', property });
    case '==':
    case '!=':
      return Object.freeze({
        operator: filter.operator,
        property,
        value: filter.value,
      });
    case 'in':
    case '!in':
      return Object.freeze({
        operator: filter.operator,
        property,
        values: Object.freeze([...filter.values]),
      });
  }
}

function validatePaint(
  opacity: number,
  color: string | number,
  type: 'fill' | 'line',
): void {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`${type} opacity 必须位于 0 到 1。`);
  }
  if (
    (typeof color === 'string' && color.length === 0) ||
    (typeof color === 'number' && !Number.isFinite(color))
  ) {
    throw new RangeError(`${type} color 必须是非空字符串或有限数值。`);
  }
}

function normalizeLayerZoom(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} 必须是非负有限数值。`);
  }

  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) {
    throw new RangeError(`${name} 不能为空。`);
  }

  return value;
}

function normalizeRenderOrder(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('renderOrder 必须是非负安全整数。');
  }
  return value;
}
