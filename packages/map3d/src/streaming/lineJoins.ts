interface Point { x: number; y: number }
/** 共享折点的挤出方向采用受限 miter，避免相邻线段的接缝和尖刺。 */
export function lineJoin(previous: Point | undefined, point: Point, next: Point | undefined): [number, number] {
  const before = previous ?? point, after = next ?? point;
  let ax = point.x - before.x, ay = point.y - before.y, bx = after.x - point.x, by = after.y - point.y;
  const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
  if (!al && !bl) return [0, 1];
  if (!al) return [-by / bl, bx / bl];
  if (!bl) return [-ay / al, ax / al];
  ax /= al; ay /= al; bx /= bl; by /= bl;
  const denominator = 1 + ax * bx + ay * by;
  if (denominator < .01) return [-by, bx];
  const x = -(ay + by) / denominator, y = (ax + bx) / denominator;
  const scale = Math.min(1, 2 / Math.hypot(x, y));
  return [x * scale, y * scale];
}
