/** 0.18/0.08 级滞回约为 13%/6% 比例变化，隔离临界缩放的细微抖动。 */
export function stableTileZoom(zoom: number, current = -1): number {
  return current < 0 || zoom < current - .18 || zoom >= current + 1.08 ? Math.floor(zoom) : current;
}
