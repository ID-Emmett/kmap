import {
  ancestorCanonicalTileKey,
  canonicalTileKeyToString,
  createCanonicalTileKey,
  createRenderTileKey,
  normalizeCanonicalTileKey,
  renderTileKeyToString,
  type CanonicalTileKey,
  type RenderTileKey,
} from '../tileAddress.js';

export interface TilePyramidOptions {
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly minZoom: number;
  readonly maxZoom: number;
}

/** 维护 NTE canonical Tile 的四叉树、相邻和 world wrap 关系。 */
export class TilePyramid {
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly minZoom: number;
  readonly maxZoom: number;

  constructor(options: TilePyramidOptions) {
    if (options.sourceId.length === 0 || options.sourceRevision.length === 0) {
      throw new RangeError('sourceId 和 sourceRevision 不能为空。');
    }
    if (!Number.isSafeInteger(options.minZoom) || options.minZoom < 0) {
      throw new RangeError('minZoom 必须是非负安全整数。');
    }
    if (!Number.isSafeInteger(options.maxZoom) || options.maxZoom < options.minZoom) {
      throw new RangeError('maxZoom 必须是不小于 minZoom 的安全整数。');
    }
    this.sourceId = options.sourceId;
    this.sourceRevision = options.sourceRevision;
    this.minZoom = options.minZoom;
    this.maxZoom = options.maxZoom;
  }

  parent(key: CanonicalTileKey): CanonicalTileKey | undefined {
    const normalized = this.assertKey(key);
    if (normalized.z <= this.minZoom) return undefined;
    return createCanonicalTileKey(
      this.sourceId,
      this.sourceRevision,
      normalized.z - 1,
      Math.floor(normalized.x / 2),
      Math.floor(normalized.y / 2),
    );
  }

  children(key: CanonicalTileKey): readonly CanonicalTileKey[] {
    const normalized = this.assertKey(key);
    if (normalized.z >= this.maxZoom) return Object.freeze([]);
    const zoom = normalized.z + 1;
    const children: CanonicalTileKey[] = [];
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const child = createCanonicalTileKey(this.sourceId, this.sourceRevision, zoom, normalized.x * 2 + x, normalized.y * 2 + y);
        if (child !== undefined) children.push(child);
      }
    }
    return Object.freeze(children);
  }

  parentRenderKey(key: RenderTileKey): RenderTileKey | undefined {
    const render = this.assertRenderKey(key);
    if (render.canonical.z <= this.minZoom) return undefined;
    const globalX = render.canonical.x + render.wrapIndex * 2 ** render.canonical.z;
    return createRenderTileKey(this.sourceId, this.sourceRevision, render.canonical.z - 1, Math.floor(globalX / 2), Math.floor(render.canonical.y / 2), render.mapOriginId);
  }

  childrenRenderKeys(key: RenderTileKey): readonly RenderTileKey[] {
    const render = this.assertRenderKey(key);
    if (render.canonical.z >= this.maxZoom) return Object.freeze([]);
    const globalX = render.canonical.x + render.wrapIndex * 2 ** render.canonical.z;
    const result: RenderTileKey[] = [];
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const child = createRenderTileKey(this.sourceId, this.sourceRevision, render.canonical.z + 1, globalX * 2 + x, render.canonical.y * 2 + y, render.mapOriginId);
        if (child !== undefined) result.push(child);
      }
    }
    return Object.freeze(result);
  }

  ancestorAtZoom(key: CanonicalTileKey, zoom: number): CanonicalTileKey | undefined {
    const normalized = this.assertKey(key);
    if (!Number.isSafeInteger(zoom) || zoom < this.minZoom || zoom > normalized.z) return undefined;
    return ancestorCanonicalTileKey(normalized, zoom);
  }

  ancestors(key: CanonicalTileKey): readonly CanonicalTileKey[] {
    const result: CanonicalTileKey[] = [];
    let current = this.parent(key);
    while (current !== undefined) {
      result.push(current);
      current = this.parent(current);
    }
    return Object.freeze(result);
  }

  neighbors(key: CanonicalTileKey): readonly CanonicalTileKey[] {
    const normalized = this.assertKey(key);
    const result: CanonicalTileKey[] = [];
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) continue;
        const neighbor = createCanonicalTileKey(this.sourceId, this.sourceRevision, normalized.z, normalized.x + xOffset, normalized.y + yOffset);
        if (neighbor !== undefined) result.push(neighbor);
      }
    }
    return Object.freeze(result);
  }

  isAncestor(ancestor: CanonicalTileKey, descendant: CanonicalTileKey): boolean {
    const parent = this.assertKey(ancestor);
    const child = this.assertKey(descendant);
    if (parent.z >= child.z) return false;
    const distance = child.z - parent.z;
    return Math.floor(child.x / 2 ** distance) === parent.x && Math.floor(child.y / 2 ** distance) === parent.y;
  }

  keyOf(key: CanonicalTileKey): string {
    const normalized = this.assertKey(key);
    return canonicalTileKeyToString(normalized);
  }

  renderKeyOf(key: RenderTileKey): string {
    return renderTileKeyToString(this.assertRenderKey(key));
  }

  private assertKey(key: CanonicalTileKey): CanonicalTileKey {
    const normalized = normalizeCanonicalTileKey(key);
    if (normalized.sourceId !== this.sourceId || normalized.sourceRevision !== this.sourceRevision || normalized.z < this.minZoom || normalized.z > this.maxZoom) {
      throw new RangeError('CanonicalTileKey 不属于当前 TilePyramid。');
    }
    return normalized;
  }

  private assertRenderKey(key: RenderTileKey): RenderTileKey {
    this.assertKey(key.canonical);
    if (!Number.isSafeInteger(key.wrapIndex) || key.mapOriginId.length === 0) throw new RangeError('RenderTileKey 参数无效。');
    return key;
  }
}
