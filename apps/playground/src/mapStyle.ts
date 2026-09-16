import type { MapLayerOptions } from '@kmap/map3d';

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
const LOCAL_ROAD_CLASSES = ['service', 'unclassified', 'pedestrian', 'path', 'footway', 'steps', 'track'] as const;

/** 米制线宽 stop 控制概览制图概化，街区级保留真实地图平面宽度。 */
const roadWidth = (meters: number, casing = false) => ({
  widthUnit: 'meters' as const, widthBase: .5,
  widthStops: [[5, (casing ? 1.3 : 1) * 1800], [10, (casing ? 1.3 : 1) * 180], [15, meters + (casing ? 2 : 0)], [20, meters + (casing ? 2 : 0)]] as const,
});

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
  { id: 'motorway-road', classes: ['motorway'], width: 26, minZoom: 5 },
];

export const PLAYGROUND_LAYERS: readonly MapLayerOptions[] = [
  { type: 'fill', id: 'ocean-base', sourceLayer: 'ocean_base', paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'fill', id: 'ocean-fill', sourceLayer: 'ocean', minZoom: 7, paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'fill', id: 'landuse-neutral', sourceLayer: 'landuse', minZoom: 5,
    filters: [{ operator: '!=', property: 'class', value: 'grass' }], paint: { color: PLAYGROUND_STYLE_TOKENS.landuseNeutral } },
  { type: 'fill', id: 'landuse-vegetation', sourceLayer: 'landuse', minZoom: 5,
    filters: [{ operator: '==', property: 'class', value: 'grass' }], paint: { color: PLAYGROUND_STYLE_TOKENS.vegetation } },
  { type: 'fill', id: 'water-fill', sourceLayer: 'water', minZoom: 0, paint: { color: PLAYGROUND_STYLE_TOKENS.water } },
  { type: 'line', id: 'waterway-line', sourceLayer: 'waterway', minZoom: 5,
    paint: { color: PLAYGROUND_STYLE_TOKENS.waterway, ...roadWidth(5) } },
  ...(['ground', 'bridge'] as const).flatMap(level => (['casing', 'fill'] as const).flatMap(part => roads.map(road => ({
    type: 'line' as const, id: `${road.id}-${part}${level === 'bridge' ? '-bridge' : ''}`, sourceLayer: 'road', minZoom: road.minZoom,
    filters: [{ operator: 'in' as const, property: 'class', values: road.classes }, { operator: '!=' as const, property: 'brunnel', value: 'tunnel' },
      { operator: level === 'bridge' ? '==' as const : '!=' as const, property: 'brunnel', value: 'bridge' }],
    paint: { color: road.width >= 14 ? PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'majorRoadCasing' : 'majorRoadFill']
      : PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'roadCasing' : 'roadFill'], ...roadWidth(road.width, part === 'casing') },
  })))),
  ...(['casing', 'fill'] as const).map(part => ({ type: 'line' as const, id: `transportation-${part}`, sourceLayer: 'transportation', minZoom: 5, maxZoom: 8,
    filters: [{ operator: 'in' as const, property: 'class', values: MAJOR_ROAD_CLASSES }],
    paint: { color: PLAYGROUND_STYLE_TOKENS[part === 'casing' ? 'majorRoadCasing' : 'majorRoadFill'], ...roadWidth(20, part === 'casing') } })),
  { type: 'line', id: 'tunnel', sourceLayer: 'road', minZoom: 10, filters: [{ operator: '==', property: 'brunnel', value: 'tunnel' }],
    paint: { color: '#D8C9A2', ...roadWidth(10), dashArray: [2, 1] } },
  { type: 'line', id: 'ferry', sourceLayer: 'road', minZoom: 9, filters: [{ operator: '==', property: 'class', value: 'ferry' }],
    paint: { color: '#7AACC4', ...roadWidth(2), dashArray: [2, 3] } },
  { type: 'line', id: 'rail-border', sourceLayer: 'road', minZoom: 9,
    filters: [{ operator: 'in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail'] }],
    paint: { color: '#A6ADB5', ...roadWidth(4) } },
  { type: 'line', id: 'rail-dash', sourceLayer: 'road', minZoom: 9,
    filters: [{ operator: 'in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail'] }],
    paint: { color: '#FFFFFF', ...roadWidth(2), dashArray: [4, 6] } },
  { type: 'line', id: 'boundary-country', sourceLayer: 'boundary',
    filters: [{ operator: '==', property: 'admin_level', value: 2 }, { operator: '!in', property: 'ogc_fid', values: [5000, 6000] }],
    paint: { color: '#C6959C', widthBase: .5, widthStops: [[3, 19000], [8, 1100], [14, 12], [20, 12]], dashArray: [6, 2] } },
  { type: 'line', id: 'boundary-china', sourceLayer: 'boundary',
    filters: [{ operator: 'in', property: 'ogc_fid', values: [500, 501] }],
    paint: { color: '#CC8992', widthBase: .5, widthStops: [[3, 25000], [8, 1800], [14, 16], [20, 16]] } },
  { type: 'line', id: 'province-boundary', sourceLayer: 'province_border', minZoom: 3,
    filters: [{ operator: 'in', property: 'level', values: ['1', 1] }],
    paint: { color: '#A7A0AE', widthBase: .5, widthStops: [[3, 10000], [8, 800], [14, 8], [20, 8]], dashArray: [2, 2, 6, 2] } },
  { type: 'fill-extrusion', id: 'building-3d', sourceLayer: 'building', minZoom: 15.74,
    filters: [{ operator: '!=', property: 'type', value: 'building:part' }],
    paint: { color: PLAYGROUND_STYLE_TOKENS.building, heightProperty: 'height', colorProperty: 'kind', categoryColors: BUILDING_CATEGORY_COLORS } },
  { type: 'symbol', id: 'place-label', sourceLayer: 'place', minZoom: 0,
    layout: { textFields: ['name', 'name_en'], textSize: 17, priority: 0 }, paint: { color: '#52606A', haloWidth: 1.5 } },
  { type: 'symbol', id: 'poi-label', sourceLayer: 'poi_label', minZoom: 8,
    layout: { textFields: ['short_name', 'name'], textSize: 13, priority: 100, minZoomProperty: 'level',
      priorityByClass: { rail_metro: -70, airport: -80, hospital: -55, school: -20 } }, paint: { color: '#65716F', haloWidth: 1.2 } },
  { type: 'symbol', id: 'road-label', sourceLayer: 'road', minZoom: 13,
    filters: [{ operator: '!in', property: 'class', values: ['rail', 'light_rail', 'major_rail', 'minor_rail', 'service_rail', 'ferry'] }],
    layout: { textFields: ['name', 'name_en'], textSize: 12, priority: 50, placement: 'line' }, paint: { color: '#817660', haloWidth: 1.2 } },
];

export const PLAYGROUND_STYLE = Object.freeze({ backgroundColor: PLAYGROUND_STYLE_TOKENS.canvas, layers: PLAYGROUND_LAYERS });
