import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeVectorTile } from '../../../packages/map3d/src/streaming/paint.js';
import { buildLabels } from '../../../packages/map3d/src/labels/candidates.js';
import { PLAYGROUND_LAYERS } from '../src/mapStyle.js';
import { THEMES } from '../src/themes.js';
import { StyleConfiguration } from '../src/styleConfiguration.js';

describe('地名层级与默认配色', () => {
  it('真实 KYE 数据依次显示国家、省会及普通城市', () => {
    const tile = decodeVectorTile(readFileSync('../../packages/map3d/test/fixtures/kye-v8Maptile-z5-26-12.mvt'));
    const labels = buildLabels(tile, PLAYGROUND_LAYERS);
    const at = (zoom: number) => labels.filter(l => !l.line && zoom >= l.minZoom && zoom < l.maxZoom);
    expect(at(4.9).map(l => l.text)).toEqual(['中华人民共和国']);
    expect(at(5.5).some(l => l.text === '北京')).toBe(true);
    expect(at(5.5).every(l => ['country-label', 'capital-label'].includes(l.layerId!))).toBe(true);
    expect(at(7).some(l => l.text === '宜昌')).toBe(true);
    expect(labels.find(l => l.text === '北京')!.priority).toBeLessThan(labels.find(l => l.text === '宜昌')!.priority);
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
    expect(rail.paint.widthStops?.find(([zoom]) => zoom === 10)?.[1]).toBeLessThanOrEqual(40);
  });
});
