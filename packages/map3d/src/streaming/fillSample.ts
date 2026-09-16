import type { FillData } from './fills.js';

/** 诊断按几何拓扑和样式范围采样来源颜色，结果独立于 GPU 栅格化。 */
export function sampleFill(data: FillData, x: number, y: number, zoom: number, background?: readonly number[]): [number, number, number] | undefined {
  const p = data.positions, index = data.indices;
  const color: [number, number, number] = [0, 0, 0]; let remaining = 1;
  for (let i = index.length - 3; i >= 0; i -= 3) {
    const a = index[i]! * 3, b = index[i + 1]! * 3, c = index[i + 2]! * 3;
    if (zoom < data.styles[a]! || zoom >= data.styles[a + 1]!) continue;
    const opacity = Math.min(1, Math.max(0, data.styles[a + 2]!)); if (!opacity) continue;
    if (Math.abs((p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!) - (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!)) < 1e-16) continue;
    const s1 = (p[b]! - p[a]!) * (y - p[a + 2]!) - (p[b + 2]! - p[a + 2]!) * (x - p[a]!);
    const s2 = (p[c]! - p[b]!) * (y - p[b + 2]!) - (p[c + 2]! - p[b + 2]!) * (x - p[b]!);
    const s3 = (p[a]! - p[c]!) * (y - p[c + 2]!) - (p[a + 2]! - p[c + 2]!) * (x - p[c]!);
    if ((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) continue;
    for (let channel = 0; channel < 3; channel++) color[channel]! += data.colors[a + channel]! * opacity * remaining;
    remaining *= 1 - opacity; if (!remaining) return color;
  }
  if (remaining === 1) return;
  for (let channel = 0; channel < 3; channel++) color[channel] = background
    ? color[channel]! + background[channel]! * remaining : color[channel]! / (1 - remaining);
  return color;
}
