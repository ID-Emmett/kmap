import { roadWidth } from './roadStyle.js';
import type { MapLayerOptions } from '@kmap/map3d';

/** Playground 浅色底图的固定视觉 token。 */
export const PLAYGROUND_STYLE_TOKENS = Object.freeze({
  canvas: '#dbdeff',
  water: '#A9D7E8',
  waterway: '#8CCBE2',
  landuseNeutral: '#ECEDEB',
  vegetation: '#DCEBD7',
  building: '#E1E3E5',
  roadCasing: '#D4D7DA',
  roadFill: '#FFFFFF',
  majorRoadCasing: '#E1C875',
  majorRoadFill: '#F8E7AE',
  boundary: '#C7C4B8',
  chinaBoundary: '#FF586C',
} as const);

/** 真实 KYE road/class 样本和 Style 研究共同确认的主干道路分类。 */
export const MAJOR_ROAD_CLASSES = Object.freeze([
  'motorway',
  'trunk',
  'primary',
] as const);
const LOCAL_ROAD_CLASSES = ['service', 'unclassified', 'pedestrian', 'path', 'footway', 'steps', 'track'] as const;

/** 建筑使用连续视图缩放，在默认 15.8 近景进入可见状态。 */
export const BUILDING_MIN_ZOOM = 15.74;

/** kind 原始代码颜色表；类别业务名称由上游数据字典定义。 */
export const BUILDING_CATEGORY_COLORS = {
  '1002': '#D5DFEB', '1102': '#E1E3E5', '1102_osm': '#E1E3E5',
  '1202': '#DECFC2', '1204': '#DAD1C2', '1403': '#CEDCCE', '1506': '#CDD9E5',
  '1601': '#D8D2E2', '2001': '#C7DCD8', '3002': '#DBD7CD', '4002': '#D0D9E5',
  '6002': '#D6DCCB', '7001': '#E4D4CD', '9002': '#DADDE1', '9004': '#D5DDE0',
} as const;

const ordinary = ['secondary', 'secondary_link'];
const roads = [
  { id: 'local-road', classes: LOCAL_ROAD_CLASSES, width: 5, minZoom: 15 },
  { id: 'street-road', classes: ['street', 'street_limited'], width: 7, minZoom: 13 },
  { id: 'tertiary-road', classes: ['tertiary', 'tertiary_link'], width: 9, minZoom: 12 },
  { id: 'link-road', classes: ['primary_link', 'trunk_link', 'motorway_link'], width: 9, minZoom: 11 },
  { id: 'road', classes: ordinary, width: 9, minZoom: 10 },
  { id: 'major-road', classes: ['primary'], width: 14, minZoom: 9 },
  { id: 'trunk-road', classes: ['trunk'], width: 20, minZoom: 7 },
  { id: 'motorway-road', classes: ['motorway'], width: 26, minZoom: 7 },
];

const overviewRoads = [
  { id: 'motorway', classes: ['motorway'], minZoom: 5 },
  { id: 'trunk', classes: ['trunk'], minZoom: 6 },
] as const;

export const PLAYGROUND_LAYERS: readonly MapLayerOptions[] = [
  // 基础海洋持续覆盖；详细海洋是地理范围稀疏的补充源，二者按内容合成。
  { type: 'fill', id: 'ocean-base', sourceLayer: 'ocean_base', paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'fill', id: 'ocean-fill', sourceLayer: 'ocean', paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'fill', id: 'landuse-neutral', sourceLayer: 'landuse', minZoom: 5,
    filters: [{ operator: '!=', property: 'class', value: 'grass' }], paint: { color: PLAYGROUND_STYLE_TOKENS.landuseNeutral } },
  { type: 'fill', id: 'landuse-vegetation', sourceLayer: 'landuse', minZoom: 5,
    // KYE normal.json 的 landuse_grass 明确筛选 subclass；grassland 是区域草地栅格。
    filters: [{ operator: '==', property: 'class', value: 'grass' }, { operator: '!=', property: 'subclass', value: 'grassland' }], paint: { color: PLAYGROUND_STYLE_TOKENS.vegetation } },
  { type: 'fill', id: 'water-fill', sourceLayer: 'water', minZoom: 0, paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'line', id: 'waterway-line', sourceLayer: 'waterway', minZoom: 4,
    paint: { color: PLAYGROUND_STYLE_TOKENS.waterway, widthUnit: 'pixels', widthStops: [[4, .7], [6, .9], [13, 1], [19, 3]] } },
  ...(['ground', 'bridge'] as const).flatMap(level => (['casing', 'fill'] as const).flatMap(part => roads.map(road => ({
    type: 'line' as const, id: `${road.id}-${part}${level === 'bridge' ? '-bridge' : ''}`, sourceLayer: 'road', minZoom: road.minZoom,
    filters: [{ operator: 'in' as const, property: 'class', values: road.classes }, { operator: '!=' as const, property: 'brunnel', value: 'tunnel' },
      { operator: level === 'bridge' ? '==' as const : '!=' as const, property: 'brunnel', value: 'bridge' }],
    paint: { color: road.width >= 14 ? PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'majorRoadCasing' : 'majorRoadFill']
      : PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'roadCasing' : 'roadFill'], ...roadWidth(road.width >= 14 ? 'major' : road.id === 'link-road' ? 'link' : road.id === 'local-road' ? 'service' : road.id === 'street-road' ? 'minor' : 'secondary', part === 'casing') },
  })))),
  ...overviewRoads.flatMap(road => (['casing', 'fill'] as const).map(part => ({
    type: 'line' as const, id: `transportation-${road.id}-${part}`, sourceLayer: 'transportation', minZoom: road.minZoom, maxZoom: 7,
    filters: [{ operator: 'in' as const, property: 'class', values: road.classes }],
    paint: { color: PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'majorRoadCasing' : 'majorRoadFill'], ...roadWidth('major', part === 'casing') },
  }))),
  { type: 'line', id: 'tunnel', sourceLayer: 'road', minZoom: 10, filters: [{ operator: '==', property: 'brunnel', value: 'tunnel' }],
    paint: { color: '#D8C9A2', ...roadWidth('major'), opacity: .5, dashArray: [.5, .5] } },
  { type: 'line', id: 'ferry', sourceLayer: 'road', minZoom: 9, filters: [{ operator: '==', property: 'class', value: 'ferry' }],
    paint: { color: '#7AACC4', widthUnit: 'pixels', widthStops: [[10, .5], [16, 1]], opacity: .55, dashArray: [2, 3] } },
  { type: 'line', id: 'rail-border', sourceLayer: 'road', minZoom: 9,
    filters: [{ operator: 'in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail'] }],
    paint: { color: '#A6ADB5', widthUnit: 'pixels', widthStops: [[9, .7], [13, 1.4], [18, 2.4]], opacity: .38 } },
  { type: 'line', id: 'rail-dash', sourceLayer: 'road', minZoom: 9,
    filters: [{ operator: 'in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail'] }],
    paint: { color: '#FFFFFF', widthUnit: 'pixels', widthStops: [[9, .35], [13, .7], [18, 1.2]], opacity: .45, dashArray: [4, 6] } },
  { type: 'line', id: 'boundary-country', sourceLayer: 'boundary',
    filters: [{ operator: '==', property: 'admin_level', value: 2 }, { operator: '!in', property: 'ogc_fid', values: [500, 501, 5000, 6000] }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.boundary, widthUnit: 'pixels', widthStops: [[3, 1.5], [5, 1.5], [12, 1]], opacity: .8 } },
  { type: 'line', id: 'boundary-china', sourceLayer: 'boundary',
    filters: [{ operator: '==', property: 'admin_level', value: 2 }, { operator: '==', property: 'ogc_fid', value: 500 }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.chinaBoundary, widthUnit: 'pixels', widthStops: [[3, 1.5], [5, 2], [12, 3]] } },
  { type: 'line', id: 'province-boundary', sourceLayer: 'province_border', minZoom: 3, maxZoom: 10,
    filters: [{ operator: 'in', property: 'level', values: ['1', 1] }],
    paint: { color: '#AEB7BD', widthUnit: 'pixels', widthStops: [[3, .45], [7, .75], [10, 1]], dashArray: [1, 1], opacity: .9 } },
  { type: 'fill-extrusion', id: 'building-3d', sourceLayer: 'building', minZoom: BUILDING_MIN_ZOOM,
    filters: [{ operator: '!=', property: 'type', value: 'building:part' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.building, heightProperty: 'height', colorProperty: 'kind', categoryColors: BUILDING_CATEGORY_COLORS } },
  { type: 'symbol', id: 'country-label', sourceLayer: 'place', minZoom: 0, maxZoom: 3,
    filters: [{ operator: '==', property: 'class', value: 'country' }, { operator: '==', property: 'iso_a2', value: 'CN' }],
    layout: { textFields: ['name'], textSize: 21, priority: 0 }, paint: { color: '#52606A', haloWidth: 1.5 } },
  { type: 'symbol', id: 'province-label', sourceLayer: 'place', minZoom: 3, maxZoom: 4,
    filters: [{ operator: '==', property: 'class', value: 'state' }],
    layout: { textFields: ['name'], textSize: 18, priority: 5 }, paint: { color: '#52606A', haloWidth: 1.4 } },
  { type: 'symbol', id: 'capital-label', sourceLayer: 'place', minZoom: 4,
    filters: [{ operator: '==', property: 'class', value: 'city' }, { operator: 'in', property: 'capital', values: [1, 2] }],
    layout: { textFields: ['name'], textSize: 17, priority: 10, iconByClass: { city: 'capital' } }, paint: { color: '#52606A', haloWidth: 1.4 } },
  { type: 'symbol', id: 'place-label', sourceLayer: 'place', minZoom: 6,
    filters: [{ operator: '==', property: 'class', value: 'city' }, { operator: '!in', property: 'capital', values: [1, 2] }],
    layout: { textFields: ['name', 'name_en'], textSize: 15, priority: 30 }, paint: { color: '#52606A', haloWidth: 1.2 } },
  { type: 'symbol', id: 'poi-label', sourceLayer: 'poi_label', minZoom: 8,
    layout: { textFields: ['short_name', 'name'], textSize: 13, priority: 100, minZoomProperty: 'level',
      priorityByClass: { rail_metro: -70, airport: -80, hospital: -55, school: -20 },
      iconByClass: { rail_metro: 'metro', airport: 'airport', hospital: 'hospital', school: 'school', college: 'school', university: 'school', park: 'park', museum: 'museum', restaurant: 'food', shop: 'shop', mall: 'shop', hotel: 'hotel' } }, paint: { color: '#65716F', haloWidth: 1, colorByClass: { rail_metro: '#3878B8', airport: '#3878B8', hospital: '#B65160', school: '#947139', college: '#947139', university: '#947139', park: '#43805C', museum: '#8C609B', restaurant: '#B97540', shop: '#A06483', mall: '#A06483', hotel: '#7763A8' } } },
  { type: 'symbol', id: 'road-label', sourceLayer: 'road', minZoom: 13,
    filters: [{ operator: '!in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail', 'ferry'] }],
    layout: { textFields: ['name', 'name_en'], textSize: 12, priority: 50, placement: 'line' }, paint: { color: '#817660', haloWidth: 1.2 } },
];

export const PLAYGROUND_STYLE = Object.freeze({ backgroundColor: PLAYGROUND_STYLE_TOKENS.canvas, layers: PLAYGROUND_LAYERS });
