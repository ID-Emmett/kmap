/** NovaTileEngine 使用的安全 XYZ 层级上限。 */
export const MAX_TILE_ZOOM = 52;

/** NTE 网络、Worker、缓存共享的 canonical Tile 标识。 */
export interface CanonicalTileKey {
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** NTE 渲染实例标识；同一 canonical Tile 可以拥有多个实例。 */
export interface RenderTileKey {
  readonly canonical: CanonicalTileKey;
  readonly wrapIndex: number;
  readonly mapOriginId: string;
}

/** 将 world X 归一化为 canonical X，并返回 world 副本索引。 */
export function normalizeTileX(
  x: number,
  zoom: number,
): { readonly x: number; readonly wrapIndex: number } {
  const z = requireZoom(zoom);
  requireSafeInteger(x, 'x');
  const scale = 2 ** z;
  const wrapIndex = Math.floor(x / scale);
  return Object.freeze({ x: x - wrapIndex * scale, wrapIndex });
}

/** 创建经过 XYZ 边界校验的 canonical Tile key。 */
export function createCanonicalTileKey(
  sourceId: string,
  sourceRevision: string,
  zoom: number,
  x: number,
  y: number,
): CanonicalTileKey | undefined;
export function createCanonicalTileKey(
  key: Omit<CanonicalTileKey, 'x' | 'y'> & { x: number; y: number },
): CanonicalTileKey | undefined;
export function createCanonicalTileKey(
  sourceOrKey: string | (Omit<CanonicalTileKey, 'x' | 'y'> & { x: number; y: number }),
  sourceRevision?: string,
  zoom?: number,
  x?: number,
  y?: number,
): CanonicalTileKey | undefined {
  const input =
    typeof sourceOrKey === 'string'
      ? {
          sourceId: sourceOrKey,
          sourceRevision: sourceRevision as string,
          z: zoom as number,
          x: x as number,
          y: y as number,
        }
      : sourceOrKey;

  const sourceId = requireNonEmpty(input.sourceId, 'sourceId');
  const revision = requireNonEmpty(input.sourceRevision, 'sourceRevision');
  const z = requireZoom(input.z);
  requireSafeInteger(input.y, 'y');
  const scale = 2 ** z;
  if (input.y < 0 || input.y >= scale) {
    return undefined;
  }
  const normalized = normalizeTileX(input.x, z);
  return Object.freeze({
    sourceId,
    sourceRevision: revision,
    z,
    x: normalized.x,
    y: input.y,
  });
}

/** 创建带 world wrap 和 MapOrigin 的渲染 Tile key。 */
export function createRenderTileKey(
  canonical: CanonicalTileKey,
  wrapIndex: number,
  mapOriginId: string,
): RenderTileKey;
export function createRenderTileKey(
  sourceId: string,
  sourceRevision: string,
  zoom: number,
  x: number,
  y: number,
  mapOriginId: string,
): RenderTileKey | undefined;
export function createRenderTileKey(
  canonicalOrSource: CanonicalTileKey | string,
  wrapOrRevision: number | string,
  mapOriginOrZoom: string | number,
  x?: number,
  y?: number,
  mapOriginId?: string,
): RenderTileKey | undefined {
  if (typeof canonicalOrSource !== 'string') {
    const canonical = normalizeCanonicalTileKey(canonicalOrSource);
    const wrapIndex = requireSafeInteger(wrapOrRevision as number, 'wrapIndex');
    return Object.freeze({
      canonical,
      wrapIndex,
      mapOriginId: requireNonEmpty(mapOriginOrZoom as string, 'mapOriginId'),
    });
  }

  const key = createCanonicalTileKey(
    canonicalOrSource,
    wrapOrRevision as string,
    mapOriginOrZoom as number,
    x as number,
    y as number,
  );
  if (key === undefined) {
    return undefined;
  }
  const normalized = normalizeTileX(x as number, mapOriginOrZoom as number);
  return Object.freeze({
    canonical: key,
    wrapIndex: normalized.wrapIndex,
    mapOriginId: requireNonEmpty(mapOriginId as string, 'mapOriginId'),
  });
}

/** 验证并冻结 canonical key，避免异步边界观察到可变身份。 */
export function normalizeCanonicalTileKey(key: CanonicalTileKey): CanonicalTileKey {
  const normalized = createCanonicalTileKey(key);
  if (normalized === undefined || normalized.x !== key.x || normalized.y !== key.y) {
    throw new RangeError('CanonicalTileKey 必须是已归一化且位于 XYZ 范围内的 key。');
  }
  return normalized;
}

/** 返回可用于缓存和去重的稳定 canonical 字符串。 */
export function canonicalTileKeyToString(key: CanonicalTileKey): string {
  const normalized = normalizeCanonicalTileKey(key);
  return [
    normalized.sourceId,
    normalized.sourceRevision,
    normalized.z,
    normalized.x,
    normalized.y,
  ]
    .map(encodeURIComponent)
    .join('/');
}

/** 返回可用于渲染实例索引的稳定 render 字符串。 */
export function renderTileKeyToString(key: RenderTileKey): string {
  const normalized = normalizeCanonicalTileKey(key.canonical);
  requireSafeInteger(key.wrapIndex, 'wrapIndex');
  const mapOriginId = requireNonEmpty(key.mapOriginId, 'mapOriginId');
  return `${canonicalTileKeyToString(normalized)}@${key.wrapIndex}#${encodeURIComponent(mapOriginId)}`;
}

/** 计算指定 canonical Tile 在目标层级的祖先。 */
export function ancestorCanonicalTileKey(
  key: CanonicalTileKey,
  targetZoom: number,
): CanonicalTileKey | undefined {
  const normalized = normalizeCanonicalTileKey(key);
  const zoom = requireZoom(targetZoom);
  if (zoom > normalized.z) {
    return undefined;
  }
  const distance = normalized.z - zoom;
  return createCanonicalTileKey(
    normalized.sourceId,
    normalized.sourceRevision,
    zoom,
    Math.floor(normalized.x / 2 ** distance),
    Math.floor(normalized.y / 2 ** distance),
  );
}

function requireZoom(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TILE_ZOOM) {
    throw new RangeError(`zoom 必须是 0 到 ${MAX_TILE_ZOOM} 之间的安全整数。`);
  }
  return value;
}

function requireSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} 必须是安全整数。`);
  }
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${name} 不能为空。`);
  }
  return value;
}
