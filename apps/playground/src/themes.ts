import type { MapTheme } from '@kmap/map3d';
import { BUILDING_CATEGORY_COLORS, PLAYGROUND_LAYERS, PLAYGROUND_STYLE_TOKENS as light } from './mapStyle.js';

export type ThemeId = 'default' | 'dark' | 'vivid';
const dark = ['#132030', '#12394F', '#23637E', '#1C2A3A', '#25463F', '#405368', '#263F53', '#718899', '#685C46', '#D8B779', '#A688B8'];
const vivid = ['#FFF8E7', '#27B9EF', '#008FD4', '#F6E9B8', '#62D98A', '#F6B76B', '#D9BDB0', '#FFFFFF', '#EF6C24', '#FFBF24', '#CA43B7'];
const accents: Record<string, [string, string]> = {
  '#D8C9A2': ['#9C8968', '#B77A00'], '#7AACC4': ['#5AACC3', '#007CBE'], '#A6ADB5': ['#788AA5', '#7854C6'],
  '#C6959C': ['#B28BBA', '#B83384'], '#CC8992': ['#D7A2B7', '#E1376C'], '#A7A0AE': ['#817CA1', '#9A32C4'],
  '#52606A': ['#D4DFEC', '#243C63'], '#65716F': ['#9EB4C5', '#455D70'], '#817660': ['#C5BCA9', '#66563D'],
  '#3878B8': ['#77B8EC', '#006CD7'], '#B65160': ['#F38D9B', '#E22C5D'], '#947139': ['#D7B980', '#A96900'],
  '#43805C': ['#7EC6A1', '#087C44'], '#8C609B': ['#C49DD8', '#8734C4'], '#B97540': ['#E9B386', '#CF5400'],
  '#A06483': ['#CF9CBF', '#C52A8F'], '#7763A8': ['#AB9DE3', '#6244C7'],
};
function createTheme(id: ThemeId): MapTheme {
  if (id === 'default') return { backgroundColor: '#dbdeff', landColor: '#e6f4f3', fogColor: '#dbdeff' };
  const palette = id === 'dark' ? dark : vivid, index = id === 'dark' ? 0 : 1;
  const colors: Record<string, string> = Object.fromEntries(Object.values(light).map((color, i) => [color, palette[i]!]));
  for (const [source, targets] of Object.entries(accents)) colors[source] = targets[index];
  const buildings = id === 'dark' ? ['#405469', '#475269', '#4C5368', '#3D6260', '#4B5D78'] : ['#FFBE55', '#EF88A8', '#74B4F2', '#54CE9D', '#B88CEC'];
  Object.values(BUILDING_CATEGORY_COLORS).forEach((color, i) => { colors[color] = buildings[i % buildings.length]!; });
  return { backgroundColor: palette[0]!, colors };
}
export const THEMES: Record<ThemeId, MapTheme> = { default: createTheme('default'), dark: createTheme('dark'), vivid: createTheme('vivid') };
/** 测试与面板共用完整基础色集合。 */
export const MAP_COLORS = PLAYGROUND_LAYERS.flatMap(layer => [layer.paint.color, ...(layer.type === 'fill-extrusion' ? Object.values(layer.paint.categoryColors ?? {}) : []),
  ...(layer.type === 'symbol' ? Object.values(layer.paint.colorByClass ?? {}) : [])]).filter((color): color is string | number => color !== undefined);
