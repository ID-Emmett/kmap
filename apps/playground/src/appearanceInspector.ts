import type { Map3D } from '@kmap/map3d';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import type { Tab } from 'three/addons/inspector/ui/Tab.js';
import { StyleConfiguration, ELEMENT_OPTIONS, LABEL_OPTIONS, hexColor } from './styleConfiguration.js';
import { syncInspectorValue, type InspectorValue } from './inspectorSync.js';

interface Editor extends InspectorValue { domElement: HTMLElement }
/** 样式编辑使用 Inspector 原生 Parameters；编辑器按事件同步，空闲帧无轮询。 */
export function createAppearanceInspector(map: Map3D, inspector: Inspector): () => void {
  const configuration = new StyleConfiguration();
  const global = { theme: configuration.theme, visible: true, sizeScale: 0.8, maxLabels: 128, icons: true };
  const selection = { element: 'water-fill', label: 'poi-label' };
  const element = configuration.getElement(selection.element), label = configuration.getLabel(selection.label);
  const environment = { backgroundColor: '#f5f5f2', landColor: '#f5f5f2', fogColor: '#f5f5f2' };
  const refreshers: (() => void)[] = [];
  const bind = (control: unknown, name: string, value: () => unknown) => {
    const editor = control as Editor;
    editor.domElement.querySelectorAll('input,select,button').forEach((node, index) => node.setAttribute('aria-label', index ? `${name}数值` : name));
    const number = editor.domElement.querySelector<HTMLInputElement>('input[type="number"]');
    const range = editor.domElement.querySelector<HTMLInputElement>('input[type="range"]');
    // 数字输入即时同步原生滑杆，getValue 与画面采用相同的限幅值。
    if (number && range) number.addEventListener('input', () => {
      if (!Number.isFinite(number.valueAsNumber)) return;
      range.value = String(number.valueAsNumber); editor.dispatchChange();
    });
    refreshers.push(() => syncInspectorValue(editor, value()));
  };
  const refresh = () => {
    Object.assign(element, configuration.getElement(selection.element)); element.color = hexColor(element.color);
    Object.assign(label, configuration.getLabel(selection.label));
    label.color = hexColor(label.color); label.haloColor = hexColor(label.haloColor); label.iconColor = hexColor(label.iconColor);
    const theme = configuration.getTheme(); environment.backgroundColor = hexColor(theme.backgroundColor);
    environment.landColor = hexColor(theme.landColor ?? theme.backgroundColor); environment.fogColor = hexColor(theme.fogColor ?? theme.backgroundColor);
    refreshers.forEach(update => update());
  };
  const apply = () => { map.setTheme(configuration.getTheme()); map.setLabelStyle(configuration.labels(global)); document.documentElement.dataset.theme = global.theme; };
  const root = inspector.createParameters('地图样式');
  bind(root.add(global, 'theme', { '晴昼 · 默认': 'default', '深海 · 深色': 'dark', '晴彩 · 鲜艳': 'vivid' }).name('全局主题').onChange(() => {
    configuration.theme = global.theme; refresh(); apply();
  }), '全局主题', () => global.theme);
  for (const [key, title] of [['backgroundColor', '天空背景'], ['landColor', '陆地底色'], ['fogColor', '远景雾色']] as const)
    bind(root.addColor(environment, key).name(title).onChange(() => { configuration.setEnvironment(environment); apply(); }), title, () => environment[key]);
  const elements = root.addFolder('地图元素');
  bind(elements.add(selection, 'element', ELEMENT_OPTIONS).name('元素').onChange(refresh), '地图元素', () => selection.element);
  const saveElement = () => { configuration.setElement(selection.element, element); apply(); };
  bind(elements.addColor(element, 'color').name('颜色').onChange(saveElement), '元素颜色', () => element.color);
  bind(elements.add(element, 'visible').name('显示').onChange(saveElement), '元素显示', () => element.visible);
  bind(elements.add(element, 'opacity', 0, 1, .05).name('透明度').onChange(saveElement), '元素透明度', () => element.opacity);
  bind(elements.add(element, 'widthScale', .1, 4, .1).name('线宽倍率').onChange(saveElement), '线宽倍率', () => element.widthScale);
  bind(elements.add(element, 'heightScale', 0, 3, .1).name('建筑高度倍率').onChange(saveElement), '建筑高度倍率', () => element.heightScale);
  elements.add({ reset() { configuration.resetElement(selection.element); refresh(); apply(); } }, 'reset').name('重置此元素');
  const text = root.addFolder('文字与图标');
  bind(root.add(global, 'visible').name('显示全部文字').onChange(apply), '显示全部文字', () => global.visible);
  bind(text.add(global, 'sizeScale', .75, 1.5, .05).name('全局字号倍率').onChange(apply), '文字大小', () => global.sizeScale);
  bind(text.add(global, 'maxLabels', { 简洁: 128, 标准: 256, 丰富: 384 }).name('文字密度').onChange(apply), '文字密度', () => global.maxLabels);
  bind(text.add(global, 'icons').name('分类图标').onChange(apply), '分类图标', () => global.icons);
  bind(text.add(selection, 'label', LABEL_OPTIONS).name('文字类型').onChange(refresh), '文字类型', () => selection.label);
  const saveLabel = () => { configuration.setLabel(selection.label, label); apply(); };
  bind(text.add(label, 'visible').name('显示').onChange(saveLabel), '文字显示', () => label.visible);
  for (const [key, title] of [['color', '文字颜色'], ['haloColor', '描边颜色'], ['iconColor', '图标颜色']] as const)
    bind(text.addColor(label, key).name(title).onChange(saveLabel), title, () => label[key]);
  for (const [key, title, min, max, step] of [['textSize', '字号', 8, 32, 1], ['haloWidth', '描边宽度', 0, 3, .25], ['iconSize', '图标大小', 8, 28, 1], ['iconGap', '图文间距', 0, 16, 1]] as const)
    bind(text.add(label, key, min, max, step).name(title).onChange(saveLabel), title, () => label[key]);
  bind(text.add(label, 'icon', { 自动: 'auto', 无: 'none', 地铁: 'metro', 机场: 'airport', 医疗: 'hospital', 教育: 'school', 公园: 'park', 文化: 'museum', 餐饮: 'food', 购物: 'shop', 酒店: 'hotel' }).name('图标').onChange(saveLabel), '图标类型', () => label.icon);
  text.add({ reset() { configuration.resetLabel(selection.label); refresh(); apply(); } }, 'reset').name('重置此文字类型');
  root.add({ reset() { configuration.resetTheme(); global.visible = true; global.sizeScale = 1; global.maxLabels = 256; global.icons = true; refresh(); apply(); } }, 'reset').name('重置当前主题');
  refresh(); apply(); text.close();
  const runtime = inspector as Inspector & { parameters: Tab & { builtinButton: HTMLButtonElement | null } };
  // Parameters 的内置按钮携带目标 tab，按 Inspector 自身的打开事件初始化面板。
  runtime.parameters.builtinButton?.click();
  return () => { root.paramList.domElement.remove(); };
}
