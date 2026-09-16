import type { MapTheme } from '@kmap/map3d';
import { BUILDING_CATEGORY_COLORS, PLAYGROUND_LAYERS, PLAYGROUND_STYLE_TOKENS as light } from './mapStyle.js';

export type ThemeId = 'default' | 'dark' | 'vivid';
const dark = ['#132030', '#12394F', '#23637E', '#1C2A3A', '#25463F', '#405368', '#263F53', '#718899', '#685C46', '#D8B779', '#A688B8'];
const vivid = ['#201A37', '#123B72', '#29BDD5', '#302745', '#286958', '#6B4E8B', '#6A4379', '#C19BE9', '#853F77', '#FFBA63', '#F98BC9'];
const accents: Record<string, [string, string]> = {
  '#D8C9A2': ['#9C8968', '#F0AA88'], '#7AACC4': ['#5AACC3', '#63E8E0'], '#A6ADB5': ['#788AA5', '#B58DEF'],
  '#C6959C': ['#B28BBA', '#F17BBB'], '#CC8992': ['#D7A2B7', '#FF80AE'], '#A7A0AE': ['#817CA1', '#B984E8'],
  '#52606A': ['#D4DFEC', '#F0DFFB'], '#65716F': ['#9EB4C5', '#D2BCE6'], '#817660': ['#C5BCA9', '#EAD1BC'],
  '#3878B8': ['#77B8EC', '#55C8FF'], '#B65160': ['#F38D9B', '#FF729B'], '#947139': ['#D7B980', '#FFCE75'],
  '#43805C': ['#7EC6A1', '#70E8B5'], '#8C609B': ['#C49DD8', '#D798FF'], '#B97540': ['#E9B386', '#FFA06C'],
  '#A06483': ['#CF9CBF', '#FE8BCB'], '#7763A8': ['#AB9DE3', '#B79AFF'],
};
function createTheme(id: ThemeId): MapTheme {
  if (id === 'default') return { backgroundColor: light.canvas };
  const palette = id === 'dark' ? dark : vivid, index = id === 'dark' ? 0 : 1;
  const colors: Record<string, string> = Object.fromEntries(Object.values(light).map((color, i) => [color, palette[i]!]));
  for (const [source, targets] of Object.entries(accents)) colors[source] = targets[index];
  const buildings = id === 'dark' ? ['#405469', '#475269', '#4C5368', '#3D6260', '#4B5D78'] : ['#8463AB', '#AF6793', '#607FBB', '#459F91', '#B68677'];
  Object.values(BUILDING_CATEGORY_COLORS).forEach((color, i) => { colors[color] = buildings[i % buildings.length]!; });
  return { backgroundColor: palette[0]!, colors };
}
export const THEMES: Record<ThemeId, MapTheme> = { default: createTheme('default'), dark: createTheme('dark'), vivid: createTheme('vivid') };
/** 测试与面板共用完整基础色集合。 */
export const MAP_COLORS = PLAYGROUND_LAYERS.flatMap(layer => [layer.paint.color, ...(layer.type === 'fill-extrusion' ? Object.values(layer.paint.categoryColors ?? {}) : []),
  ...(layer.type === 'symbol' ? Object.values(layer.paint.colorByClass ?? {}) : [])]).filter((color): color is string | number => color !== undefined);
