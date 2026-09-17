import { describe, expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { ELEMENT_OPTIONS, StyleConfiguration } from './styleConfiguration.js';
import { PLAYGROUND_LAYERS } from './mapStyle.js';
import { THEMES } from './themes.js';

describe('Inspector 配置模型', () => {
  it('每个地图图层具有独立编辑入口，主题配置独立保留与重置', () => {
    for (const layer of PLAYGROUND_LAYERS.filter(layer => layer.type !== 'symbol')) expect(Object.values(ELEMENT_OPTIONS)).toContain(layer.id);
    const config = new StyleConfiguration(); config.setElement('water-fill', { color: '#ff0000', opacity: .5 });
    expect(config.getElement('ocean-fill').color).not.toBe('#ff0000');
    config.theme = 'dark'; expect(config.getElement('water-fill').color).not.toBe('#ff0000');
    config.theme = 'default'; expect(config.getElement('water-fill').opacity).toBe(.5);
    config.resetTheme(); expect(config.getElement('water-fill').opacity).toBe(1);
  });
  it('兴趣点默认图标采用数据分类，分类颜色与图标可分别配置', () => {
    const config = new StyleConfiguration(); expect(config.getLabel('poi-label').icon).toBe('auto'); expect(config.getLabel('hospital').icon).toBe('hospital');
    config.setLabel('hospital', { color: '#ff0000', iconColor: '#0000ff', iconSize: 20 });
    expect(config.labels({}).categories?.hospital).toMatchObject({ color: '#ff0000', iconColor: '#0000ff', iconSize: 20 });
    config.resetLabel('hospital'); expect(config.labels({}).categories?.hospital).toBeUndefined();
  });
  it('晴彩水面与绿地采用高饱和色，正文保持深色对比', () => {
    for (const source of ['#A9D7E8', '#DCEBD7']) {
      const hsl = new Color(THEMES.vivid.colors![source]!).getHSL({ h: 0, s: 0, l: 0 }); expect(hsl.s).toBeGreaterThan(.65);
    }
    const text = new Color(THEMES.vivid.colors!['#52606A']!); expect(text.r + text.g + text.b).toBeLessThan(.4);
  });
});
