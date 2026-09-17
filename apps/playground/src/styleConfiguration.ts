import { Color } from 'three/webgpu';
import type { LabelAppearance, LabelStyle, MapElementStyle, MapTheme } from '@kmap/map3d';
import { PLAYGROUND_LAYERS, BUILDING_CATEGORY_COLORS } from './mapStyle.js';
import { THEMES, type ThemeId } from './themes.js';

const names: Record<string, string> = { 'ocean-base': '海洋底面', 'ocean-fill': '海洋', 'water-fill': '水面', 'waterway-line': '水系线',
  'landuse-neutral': '用地', 'landuse-vegetation': '绿地', 'building-3d': '建筑', 'boundary-country': '国界', 'boundary-china': '中国边界',
  'province-boundary': '省界', tunnel: '隧道', ferry: '渡轮', 'rail-border': '铁路底线', 'rail-dash': '铁路虚线' };
const roads: Record<string, string> = { 'local-road': '支路', 'street-road': '街道', 'tertiary-road': '三级路', 'link-road': '匝道', road: '次干道',
  'major-road': '主干道', 'trunk-road': '快速路', 'motorway-road': '高速公路', transportation: '概览道路' };
function layerName(id: string): string {
  if (names[id]) return names[id];
  const root = id.replace(/-(casing|fill)(-bridge)?$/, '');
  return `${roads[root] ?? root}${id.includes('-bridge') ? '桥梁' : ''}${id.includes('-casing') ? '描边' : '填色'}`;
}
export const ELEMENT_OPTIONS = Object.fromEntries([
  ...PLAYGROUND_LAYERS.filter(layer => layer.type !== 'symbol').map(layer => [layerName(layer.id), layer.id]),
  ...Object.keys(BUILDING_CATEGORY_COLORS).map(kind => [`建筑分类 ${kind}`, `building-3d/${kind}`]),
]);
export const LABEL_OPTIONS = { 地名: 'place-label', 道路: 'road-label', 兴趣点: 'poi-label', 地铁: 'rail_metro', 机场: 'airport', 医疗: 'hospital',
  学校: 'school', 学院: 'college', 大学: 'university', 公园: 'park', 文化: 'museum', 餐饮: 'restaurant', 购物: 'shop', 商场: 'mall', 酒店: 'hotel' };
export const hexColor = (color: string | number) => `#${new Color(color).getHexString()}`;

/** 每套主题保存独立的元素与文字配置，所有查询返回可编辑副本。 */
export class StyleConfiguration {
  theme: ThemeId = 'default';
  private states: Partial<Record<ThemeId, { elements: Record<string, MapElementStyle>; labels: Record<string, LabelStyle>; environment: Partial<MapTheme> }>> = {};
  private get state() { return this.states[this.theme] ??= { elements: {}, labels: {}, environment: {} }; }
  getTheme(): MapTheme { return { ...THEMES[this.theme], ...this.state.environment, elements: { ...this.state.elements } }; }
  setEnvironment(value: Partial<MapTheme>): void { Object.assign(this.state.environment, value); }
  getElement(id: string): Required<MapElementStyle> {
    const [layerId, kind] = id.split('/'), layer = PLAYGROUND_LAYERS.find(item => item.id === layerId)!;
    const base = layer.type === 'fill-extrusion' && kind ? layer.paint.categoryColors?.[kind] ?? layer.paint.color : layer.paint.color ?? '#52606A';
    return { color: THEMES[this.theme].colors?.[base] ?? base, visible: true, opacity: 1, widthScale: 1, heightScale: 1,
      ...this.state.elements[layerId!], ...this.state.elements[id] };
  }
  setElement(id: string, value: MapElementStyle): void { this.state.elements[id] = { ...value }; }
  resetElement(id: string): void { delete this.state.elements[id]; }
  getLabel(id: string): Required<LabelStyle> {
    const layer = PLAYGROUND_LAYERS.find(layer => layer.id === (id.endsWith('-label') ? id : 'poi-label'))!;
    if (layer.type !== 'symbol') throw new Error('文字配置要求 symbol 图层。');
    const base = layer.paint.colorByClass?.[id] ?? layer.paint.color ?? '#52606A';
    const color = THEMES[this.theme].colors?.[base] ?? base;
    return { color, haloColor: this.theme === 'dark' ? '#132030' : '#ffffff', haloWidth: layer.paint.haloWidth ?? 1,
      textSize: layer.layout.textSize ?? 13, visible: true, icon: layer.layout.iconByClass?.[id] ?? (id.endsWith('-label') ? 'auto' : 'none'), iconColor: color,
      iconSize: 13, iconGap: 4, ...this.state.labels[layer.id], ...this.state.labels[id] };
  }
  setLabel(id: string, value: LabelStyle): void { this.state.labels[id] = { ...value }; }
  resetLabel(id: string): void { delete this.state.labels[id]; }
  labels(global: Pick<LabelAppearance, 'sizeScale' | 'maxLabels' | 'icons'>): LabelAppearance {
    const layers: Record<string, LabelStyle> = {}, categories: Record<string, LabelStyle> = {};
    for (const id of Object.values(LABEL_OPTIONS)) {
      const value = this.state.labels[id];
      if (id.endsWith('-label')) layers[id] = { haloColor: this.getLabel(id).haloColor, ...value };
      else if (value) categories[id] = value;
    }
    return { ...global, layers, categories };
  }
  resetTheme(): void { delete this.states[this.theme]; }
}
