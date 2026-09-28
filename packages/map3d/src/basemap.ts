import type { BasemapState, MapLayerOptions, RasterTileSourceOptions } from './types.js';

export const DEFAULT_BASEMAP: BasemapState = Object.freeze({ satellite: false, vectorLines: true, labels: true });

export function normalizeBasemap(state: Partial<BasemapState> = {}, fallback: BasemapState = DEFAULT_BASEMAP): BasemapState {
  const result = { ...fallback, ...state };
  if (typeof result.satellite !== 'boolean' || typeof result.vectorLines !== 'boolean' || typeof result.labels !== 'boolean') {
    throw new TypeError('底图开关必须为布尔值。');
  }
  return result;
}

/** 卫星影像关闭所有矢量面与建筑；纯卫星的图层集合为空。 */
export function activeVectorLayers(layers: readonly MapLayerOptions[], state: BasemapState): readonly MapLayerOptions[] {
  return layers.filter(layer => layer.type === 'line' ? state.vectorLines
    : layer.type === 'symbol' ? state.labels : !state.satellite);
}

export function validateSatelliteSource(source: RasterTileSourceOptions): void {
  if (!source.id || !source.tiles.length || source.tiles.some(url => !['{z}', '{x}', '{y}'].every(part => url.includes(part)))) {
    throw new TypeError('卫星 Source 必须包含有效 XYZ URL 模板。');
  }
  if (!Number.isInteger(source.minZoom) || !Number.isInteger(source.maxZoom) || source.minZoom < 0 || source.maxZoom > 22 || source.maxZoom < source.minZoom) {
    throw new TypeError('卫星 Source 原生层级范围无效。');
  }
  if (!Number.isInteger(source.tileSize) || source.tileSize < 128 || source.tileSize > 1024 || (source.tileSize & (source.tileSize - 1)) !== 0) {
    throw new TypeError('卫星 Source tileSize 必须是 128～1024 的 2 的幂。');
  }
  if (source.missingTileHashes?.some(hash => !/^[0-9a-f]{64}$/i.test(hash))) {
    throw new TypeError('卫星 Source 占位图片哈希必须为 SHA-256。');
  }
}
