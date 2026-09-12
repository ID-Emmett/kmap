import type { MapLayerOptions } from '@nova/map3d';

/** Playground 浅色底图的固定视觉 token。 */
export const PLAYGROUND_STYLE_TOKENS = Object.freeze({
  canvas: '#F5F5F2',
  water: '#A9D7E8',
  waterway: '#8CCBE2',
  landuseNeutral: '#ECEDEB',
  vegetation: '#DCEBD7',
  building: '#E1E3E5',
  roadCasing: '#D4D7DA',
  roadFill: '#FFFFFF',
  majorRoadCasing: '#E1C875',
  majorRoadFill: '#F8E7AE',
  boundary: '#B9BEC4',
} as const);

/** 真实 KYE road/class 样本和 Style 研究共同确认的主干道路分类。 */
export const MAJOR_ROAD_CLASSES = Object.freeze([
  'motorway',
  'trunk',
  'primary',
] as const);

/** 官方 Playground 的无文字浅色矢量底图图层配方。 */
export const PLAYGROUND_LAYERS = [
  {
    type: 'fill',
    id: 'landuse-neutral',
    sourceLayer: 'landuse',
    minZoom: 5,
    filters: [{ operator: '!=', property: 'class', value: 'grass' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.landuseNeutral },
  },
  {
    type: 'fill',
    id: 'landuse-vegetation',
    sourceLayer: 'landuse',
    minZoom: 5,
    filters: [{ operator: '==', property: 'class', value: 'grass' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.vegetation },
  },
  {
    type: 'fill',
    id: 'water-fill',
    sourceLayer: 'water',
    minZoom: 0,
    paint: { color: PLAYGROUND_STYLE_TOKENS.water },
  },
  {
    type: 'line',
    id: 'waterway-line',
    sourceLayer: 'waterway',
    minZoom: 5,
    paint: { color: PLAYGROUND_STYLE_TOKENS.waterway, opacity: 0.9, width: 2 },
  },
  {
    type: 'fill',
    id: 'building-fill',
    sourceLayer: 'building',
    minZoom: 15,
    filters: [{ operator: 'has', property: 'buildingId' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.building },
  },
  {
    type: 'line',
    id: 'road-casing',
    sourceLayer: 'road',
    minZoom: 9,
    filters: [{ operator: '!in', property: 'class', values: MAJOR_ROAD_CLASSES }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.roadCasing, width: 4.5 },
  },
  {
    type: 'line',
    id: 'road-fill',
    sourceLayer: 'road',
    minZoom: 9,
    filters: [{ operator: '!in', property: 'class', values: MAJOR_ROAD_CLASSES }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.roadFill, width: 2.5 },
  },
  {
    type: 'line',
    id: 'major-road-casing',
    sourceLayer: 'road',
    minZoom: 7,
    filters: [{ operator: 'in', property: 'class', values: MAJOR_ROAD_CLASSES }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.majorRoadCasing, width: 7 },
  },
  {
    type: 'line',
    id: 'major-road-fill',
    sourceLayer: 'road',
    minZoom: 7,
    filters: [{ operator: 'in', property: 'class', values: MAJOR_ROAD_CLASSES }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.majorRoadFill, width: 4.5 },
  },
  {
    type: 'line',
    id: 'transportation-casing',
    sourceLayer: 'transportation',
    minZoom: 5,
    maxZoom: 8,
    filters: [{ operator: '==', property: 'class', value: 'trunk' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.majorRoadCasing, width: 5 },
  },
  {
    type: 'line',
    id: 'transportation-fill',
    sourceLayer: 'transportation',
    minZoom: 5,
    maxZoom: 8,
    filters: [{ operator: '==', property: 'class', value: 'trunk' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.majorRoadFill, width: 3 },
  },
] as const satisfies readonly MapLayerOptions[];

export const PLAYGROUND_STYLE = Object.freeze({
  backgroundColor: PLAYGROUND_STYLE_TOKENS.canvas,
  layers: PLAYGROUND_LAYERS,
});
