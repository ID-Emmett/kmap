import { Color, Vector4, type Node } from 'three/webgpu';
import { uint, uniformArray, varying } from 'three/tsl';
import type { MapTheme } from '../types.js';

const CAPACITY = 128;
const fallback = Array.from({ length: CAPACITY }, () => new Vector4(1, 1, 1, 1));
const defaultValues = new Float32Array(CAPACITY * 4).fill(1);
const colors = uniformArray(fallback, 'vec4' as const).onRenderUpdate(frame => frame?.scene?.userData.mapPalette?.values ?? defaultValues);
/** 顶点按颜色索引查表；主题只更新一个 2 KiB uniform，不重建几何或网络资源。 */
export function paletteColor(source: Node<'vec3'>, enabled: boolean): Node<'vec3'> {
  return enabled ? varying(colors.element(uint(source.x)).xyz).setInterpolation('flat') : source;
}
export class MapPalette {
  readonly values = new Float32Array(CAPACITY * 4);
  private readonly sources: string[] = [];
  private readonly indices = new Map<string, number>();
  haloColor: string | number | undefined;
  private mapping: Readonly<Record<string, string | number>> = {};
  private resolved = new Map<string | number, string | number>();
  resolve(value: string | number): string | number {
    if (!this.resolved.has(value)) this.resolved.set(value, this.mapping[`#${new Color(value).getHexString()}`] ?? value);
    return this.resolved.get(value)!;
  }
  set(theme: MapTheme): void {
    this.resolved.clear(); this.haloColor = theme.backgroundColor;
    this.mapping = Object.fromEntries(Object.entries(theme.colors ?? {}).map(([source, target]) => [`#${new Color(source).getHexString()}`, target]));
    this.sources.forEach((source, index) => this.update(index, source));
  }
  private update(index: number, source: string): void {
    const color = new Color(this.resolve(source)); this.values.set([color.r, color.g, color.b, 1], index * 4);
  }
  /** 上传前将已有颜色数组转换为索引，保持缓冲容量与字节预算。 */
  encode(data: Float32Array): void {
    const color = new Color(); let r = NaN, g = NaN, b = NaN, index = 0;
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) {
        r = data[i]!; g = data[i + 1]!; b = data[i + 2]!;
        const key = `#${color.setRGB(r, g, b).getHexString()}`;
        let known = this.indices.get(key);
        if (known === undefined) {
          known = this.sources.length;
          if (known >= CAPACITY) throw new RangeError('地图调色板支持最多 128 种基础颜色。');
          this.indices.set(key, known); this.sources.push(key); this.update(known, key);
        }
        index = known;
      }
      data[i] = index; data[i + 1] = data[i + 2] = 0;
    }
  }
}
