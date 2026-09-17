import { describe, expect, it } from 'vitest';
import { MAP_COLORS, THEMES } from '../src/themes.js';
import { PLAYGROUND_STYLE_TOKENS } from '../src/mapStyle.js';

describe('三套完整地图主题', () => {
  it('默认主题保留初始背景', () => { expect(THEMES.default.backgroundColor).toBe(PLAYGROUND_STYLE_TOKENS.canvas); });
  it.each(['dark', 'vivid'] as const)('%s 覆盖每一种地图面、道路、边界、建筑和分类文字基础色', id => {
    for (const color of MAP_COLORS) expect(THEMES[id].colors?.[color]).toMatch(/^#[\da-f]{6}$/i);
  });
});
