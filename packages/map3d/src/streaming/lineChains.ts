interface Point { x: number; y: number }
/** 相同样式的端点图只在度为二的节点合并，路口保持真实拓扑。 */
export function joinLineChains(rings: Point[][]): Point[][] {
  const nodes = new Map<string, number[]>(), used = new Uint8Array(rings.length);
  const key = (p: Point) => `${p.x}:${p.y}`;
  const add = (p: Point, index: number) => { const k = key(p), edges = nodes.get(k) ?? []; edges.push(index); nodes.set(k, edges); };
  rings.forEach((ring, i) => { if (ring.length > 1) { add(ring[0]!, i); add(ring.at(-1)!, i); } });
  const result: Point[][] = [];
  const walk = (index: number, start: Point): Point[] => {
    const points: Point[] = []; let next: number | undefined = index, at = start;
    while (next !== undefined && !used[next]) {
      used[next] = 1; const ring = rings[next]!;
      const forward = key(at) === key(ring[0]!);
      const ordered = forward ? ring : [...ring].reverse(); points.push(...(points.length ? ordered.slice(1) : ordered));
      at = points.at(-1)!; const edges = nodes.get(key(at))!;
      next = edges.length === 2 ? edges.find(edge => !used[edge]) : undefined;
    }
    return points;
  };
  rings.forEach((ring, i) => {
    if (used[i] || ring.length < 2) return;
    const a = ring[0]!, b = ring.at(-1)!;
    if (nodes.get(key(a))!.length !== 2) result.push(walk(i, a));
    else if (nodes.get(key(b))!.length !== 2) result.push(walk(i, b));
  });
  rings.forEach((ring, i) => { if (!used[i] && ring.length > 1) result.push(walk(i, ring[0]!)); });
  return result;
}
