import { Color, type ArrayNode, type Node } from 'three/webgpu';
import { buffer, element, uint, varying } from 'three/tsl';
import type { MapTheme } from '../types.js';

const CAPACITY = 256;
const defaultValues = new Float32Array(CAPACITY * 4).fill(1);
// BufferNode 在新材质编译时保持当前缓冲引用；每次 render 绑定所属地图的调色板。
export const paletteColors = buffer(defaultValues, 'vec4' as const, CAPACITY).onRenderUpdate(frame => frame.scene?.userData.mapPalette?.values ?? defaultValues);
// Three 的 element 运行时接受 BufferNode；类型声明以 ArrayNode 表达数组访问。
const colors = paletteColors as unknown as ArrayNode<'vec4'>;
const parameters = buffer(defaultValues, 'vec4' as const, CAPACITY).onRenderUpdate(frame => frame.scene?.userData.mapPalette?.parameters ?? defaultValues) as unknown as ArrayNode<'vec4'>;
/** 顶点按图层和基础色索引查表；样式更新复用几何与网络资源。 */
export function paletteColor(source: Node<'vec3'>, enabled: boolean): Node<'vec3'> {
  return enabled ? varying(element(colors, uint(source.x)).xyz).setInterpolation('flat') : source;
}
export const paletteStyle = (source: Node<'vec3'>): Node<'vec4'> => element(parameters, uint(source.x));
export const paletteOpacity = (source: Node<'vec3'>) => varying(element(colors, uint(source.x)).w).setInterpolation('flat');
/** Worker 的样式归属表与颜色数组共享顶点/实例顺序。 */
export interface ColorBindings { colorIds?: Uint16Array; colorKeys?: string[] }
export const bindingBytes = (data: ColorBindings) => (data.colorIds?.byteLength ?? 0) + (data.colorKeys?.reduce((sum, key) => sum + key.length * 2, 0) ?? 0);
export class MapPalette {
  readonly values = new Float32Array(CAPACITY * 4);
  readonly parameters = new Float32Array(CAPACITY * 4).fill(1);
  private readonly sources: { color: string; key: string }[] = [];
  private readonly indices = new Map<string, number>();
  haloColor: string | number | undefined;
  private mapping: Readonly<Record<string, string | number>> = {};
  private elements: NonNullable<MapTheme['elements']> = {};
  private resolved = new Map<string | number, string | number>();
  resolve(value: string | number): string | number {
    if (!this.resolved.has(value)) this.resolved.set(value, this.mapping[`#${new Color(value).getHexString()}`] ?? value);
    return this.resolved.get(value)!;
  }
  set(theme: MapTheme): void {
    this.resolved.clear(); this.haloColor = theme.backgroundColor;
    this.elements = theme.elements ?? {};
    this.mapping = Object.fromEntries(Object.entries(theme.colors ?? {}).map(([source, target]) => [`#${new Color(source).getHexString()}`, target]));
    this.sources.forEach((source, index) => this.update(index, source));
  }
  private update(index: number, source: { color: string; key: string }): void {
    const style = { ...this.elements[source.key.split('/')[0]!], ...this.elements[source.key] };
    const color = new Color(style.color ?? this.resolve(source.color));
    this.values.set([color.r, color.g, color.b, style.visible === false ? 0 : Math.max(0, Math.min(1, style.opacity ?? 1))], index * 4);
    this.parameters.set([Math.max(.1, Math.min(8, style.widthScale ?? 1)), Math.max(0, Math.min(5, style.heightScale ?? 1)), 1, 1], index * 4);
  }
  /** 上传前将已有颜色数组转换为索引，保持缓冲容量与字节预算。 */
  encode(data: Float32Array, bindings: ColorBindings = {}): void {
    const color = new Color(); let r = NaN, g = NaN, b = NaN, previousKey = '', index = 0;
    for (let i = 0; i < data.length; i += 3) {
      const elementKey = bindings.colorKeys?.[bindings.colorIds?.[i / 3] ?? 0] ?? '';
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || elementKey !== previousKey) {
        r = data[i]!; g = data[i + 1]!; b = data[i + 2]!;
        previousKey = elementKey;
        const source = `#${color.setRGB(r, g, b).getHexString()}`, key = `${elementKey}:${source}`;
        let known = this.indices.get(key);
        if (known === undefined) {
          known = this.sources.length;
          if (known >= CAPACITY) throw new RangeError('地图调色板支持最多 256 种图层颜色。');
          const entry = { color: source, key: elementKey };
          this.indices.set(key, known); this.sources.push(entry); this.update(known, entry);
        }
        index = known;
      }
      data[i] = index; data[i + 1] = data[i + 2] = 0;
    }
  }
}
