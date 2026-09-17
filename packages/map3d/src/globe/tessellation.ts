import type { FillData } from '../streaming/fills.js';

/** 每条地理边最长 2.8125°；仅低层级几何在 Worker 中细分。 */
export function tessellateFills(data: FillData, zoom: number): FillData {
  if (zoom >= 6 || !data.indices.length) return data;
  const positions = Array.from(data.positions), colors = Array.from(data.colors), styles = Array.from(data.styles), indices: number[] = [];
  const colorIds = data.colorIds ? Array.from(data.colorIds) : undefined;
  const limit = (2 ** zoom / 128) ** 2;
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`; const known = midpoints.get(key); if (known !== undefined) return known;
    const index = positions.length / 3;
    for (let i = 0; i < 3; i++) { positions.push((positions[a * 3 + i]! + positions[b * 3 + i]!) / 2); colors.push(colors[a * 3 + i]!); styles.push(styles[a * 3 + i]!); }
    if (colorIds) colorIds.push(colorIds[a]!);
    midpoints.set(key, index); return index;
  };
  const distance = (a: number, b: number) => (positions[a * 3]! - positions[b * 3]!) ** 2 + (positions[a * 3 + 2]! - positions[b * 3 + 2]!) ** 2;
  const stack = Array.from(data.indices);
  while (stack.length) {
    const c = stack.pop()!, b = stack.pop()!, a = stack.pop()!;
    const ab = distance(a, b), bc = distance(b, c), ca = distance(c, a);
    if (Math.max(ab, bc, ca) <= limit) { indices.push(a, b, c); continue; }
    if (ab >= bc && ab >= ca) { const m = midpoint(a, b); stack.push(a, m, c, m, b, c); }
    else if (bc >= ca) { const m = midpoint(b, c); stack.push(a, b, m, a, m, c); }
    else { const m = midpoint(c, a); stack.push(a, b, m, m, b, c); }
  }
  return { ...(colorIds ? { colorIds: new Uint16Array(colorIds), colorKeys: data.colorKeys! } : {}), positions: new Float32Array(positions), colors: new Float32Array(colors), styles: new Float32Array(styles), indices: new Uint32Array(indices) };
}
