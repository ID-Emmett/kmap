import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeVectorTile } from '../../../packages/map3d/src/streaming/paint.js';
import { buildLabels } from '../../../packages/map3d/src/labels/candidates.js';
import { PLAYGROUND_LAYERS } from '../src/mapStyle.js';
import { lineWidth } from '../../../packages/map3d/src/streaming/lineStyle.js';
import { THEMES } from '../src/themes.js';
import { StyleConfiguration } from '../src/styleConfiguration.js';

describe('地名层级与默认配色', () => {
  it('真实 KYE 数据依次显示国家、省名、带红圈的省会及普通城市', () => {
    const tile = decodeVectorTile(readFileSync('../../packages/map3d/test/fixtures/kye-v8Maptile-z5-26-12.mvt'));
    const labels = buildLabels(tile, PLAYGROUND_LAYERS);
    const at = (zoom: number) => labels.filter(l => !l.line && zoom >= l.minZoom && zoom < l.maxZoom);
    expect(at(2).map(l => l.text)).toEqual(['中华人民共和国']);
    expect(at(3).some(l => l.text === '河北')).toBe(true);
    expect(at(3).every(l => l.layerId === 'province-label')).toBe(true);
    expect(at(4).some(l => l.layerId === 'province-label')).toBe(false);
    expect(at(4).find(l => l.text === '北京')).toMatchObject({ layerId: 'capital-label', icon: 'capital', iconColor: '#d3424b' });
    expect(at(5).every(l => l.layerId === 'capital-label')).toBe(true);
    expect(at(6).some(l => l.text === '宜昌')).toBe(true);
    expect(labels.find(l => l.text === '北京' && l.layerId === 'capital-label')!.priority).toBeLessThan(labels.find(l => l.text === '宜昌')!.priority);
  });
  it('z4 到 z7 按水系、高速、干道和详细道路逐级增加内容', () => {
    const visible = (zoom: number) => PLAYGROUND_LAYERS.filter(layer => zoom >= (layer.minZoom ?? 0) && zoom < (layer.maxZoom ?? 25));
    expect(visible(4).some(layer => layer.id === 'waterway-line')).toBe(true);
    expect(visible(4).some(layer => layer.id.startsWith('transportation-'))).toBe(false);
    expect(visible(5).filter(layer => layer.id.startsWith('transportation-')).map(layer => layer.id))
      .toEqual(['transportation-motorway-casing', 'transportation-motorway-fill']);
    expect(visible(6).filter(layer => layer.id.startsWith('transportation-')).map(layer => layer.id))
      .toEqual(['transportation-motorway-casing', 'transportation-motorway-fill', 'transportation-trunk-casing', 'transportation-trunk-fill']);
    expect(visible(7).some(layer => layer.id === 'motorway-road-fill')).toBe(true);
    expect(visible(7).some(layer => layer.id === 'trunk-road-fill')).toBe(true);
  });
  it('背景、陆地、雾独立配置，文字总开关保留单项样式', () => {
    expect(THEMES.default).toMatchObject({ backgroundColor: '#dbdeff', landColor: '#e6f4f3', fogColor: '#dbdeff' });
    const config = new StyleConfiguration(); config.setLabel('capital-label', { color: '#123456' });
    expect(config.labels({ visible: false })).toMatchObject({ visible: false, layers: { 'capital-label': { color: '#123456' } } });
    expect(config.labels({ visible: true }).layers?.['capital-label']?.color).toBe('#123456');
  });
  it('z10 铁路线宽与透明度控制概览密度', () => {
    const rail = PLAYGROUND_LAYERS.find(l => l.id === 'rail-border')!;
    if (rail.type !== 'line') throw new Error('铁路应使用线图层。');
    expect(rail.paint.opacity).toBeLessThan(.5);
    expect(rail.paint.widthUnit).toBe('pixels'); expect(lineWidth(rail.paint, 10)).toBeLessThanOrEqual(1);
  });
});
