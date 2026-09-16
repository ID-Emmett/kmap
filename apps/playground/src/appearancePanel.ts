import type { LabelAppearance, LabelStyle, Map3D } from '@kmap/map3d';
import { THEMES, type ThemeId } from './themes.js';

/** 外观控制只调用 SDK 样式接口，配置修改即时作用于已加载内容。 */
export function createAppearancePanel(map: Map3D): () => void {
  const section = document.createElement('section'); section.className = 'appearance';
  section.innerHTML = `<h2>地图外观</h2>
    <label>全局主题<select id="map-theme" aria-label="全局主题"><option value="default">晴昼 · 默认</option><option value="dark">深海 · 深色</option><option value="vivid">霓彩 · 绚丽</option></select></label>
    <label>文字大小 <output id="label-scale-value">100%</output><input id="label-scale" aria-label="文字大小" type="range" min="75" max="150" step="5" value="100"></label>
    <label>文字密度<select id="label-density" aria-label="文字密度"><option value="128">简洁</option><option value="256" selected>标准</option><option value="384">丰富</option></select></label>
    <label class="inline"><input id="label-icons" aria-label="分类图标" type="checkbox" checked>分类图标</label>
    <details><summary>分类文字样式</summary>
    <label>文字类型<select id="label-kind" aria-label="文字类型"><option value="place-label">地名</option><option value="road-label">道路</option><option value="poi-label">兴趣点</option><option value="hospital">医疗</option><option value="school">教育</option><option value="rail_metro">交通</option><option value="park">公园</option><option value="museum">文化</option><option value="shop">购物</option><option value="restaurant">餐饮</option></select></label>
    <label>文字颜色<input id="label-color" aria-label="文字颜色" type="color" value="#52606a"></label>
    <label>描边宽度<input id="label-halo" aria-label="描边宽度" type="range" min="0" max="3" step="0.25" value="1.25"></label>
    <button id="reset-label-style">重置文字样式</button></details>`;
  document.querySelector('.panel-body')!.prepend(section);
  let theme: ThemeId = 'default';
  const layers: Record<string, LabelStyle> = {}, categories: Record<string, LabelStyle> = {};
  const input = (id: string) => section.querySelector<HTMLInputElement>(`#${id}`)!;
  const select = (id: string) => section.querySelector<HTMLSelectElement>(`#${id}`)!;
  const apply = () => {
    const haloColor = theme === 'default' ? '#FFFFFF' : theme === 'dark' ? '#132030' : '#201A37';
    const appearance: LabelAppearance = { sizeScale: Number(input('label-scale').value) / 100, maxLabels: Number(select('label-density').value), icons: input('label-icons').checked,
      layers: Object.fromEntries(['place-label', 'road-label', 'poi-label'].map(id => [id, { haloColor, ...layers[id] }])), categories };
    map.setLabelStyle(appearance); input('label-scale-value').value = `${input('label-scale').value}%`;
  };
  section.addEventListener('input', event => {
    const id = (event.target as HTMLElement).id;
    if (id === 'map-theme') {
      theme = select(id).value as ThemeId; map.setTheme(THEMES[theme]); document.documentElement.dataset.theme = theme;
    }
    const kind = select('label-kind').value, table = kind.endsWith('-label') ? layers : categories;
    if (id === 'label-color' || id === 'label-halo') table[kind] = { ...table[kind], ...(id === 'label-color' ? { color: input(id).value } : { haloWidth: Number(input(id).value) }) };
    if (id === 'label-kind') { input('label-color').value = String(table[kind]?.color ?? '#52606a'); input('label-halo').value = String(table[kind]?.haloWidth ?? 1.25); }
    apply();
  });
  section.querySelector('#reset-label-style')!.addEventListener('click', () => {
    for (const key of Object.keys(layers)) delete layers[key]; for (const key of Object.keys(categories)) delete categories[key];
    input('label-scale').value = '100'; select('label-density').value = '256'; input('label-icons').checked = true;
    input('label-color').value = '#52606a'; input('label-halo').value = '1.25'; apply();
  });
  return () => section.remove();
}
