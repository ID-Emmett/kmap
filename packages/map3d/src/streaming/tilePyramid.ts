import type { CanonicalTileKey } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import {
  canonicalTileKeyToString,
  createCanonicalTileKey,
  createRenderTileKey,
  renderTileKeyToString,
} from '../spatial/tileKey.js';

export interface TilePyramidOptions {
  sourceId: string;
  minZoom: number;
  maxZoom: number;
}

/** 维护 canonical Tile 的父子、wrap 和 overzoom 关系。 */
export class TilePyramid {
  readonly sourceId: string;
  readonly minZoom: number;
  readonly maxZoom: number;

  constructor(options: TilePyramidOptions) {
    if (options.sourceId.length === 0) {
      throw new RangeError('sourceId 不能为空。');
    }
    if (!Number.isSafeInteger(options.minZoom) || options.minZoom < 0) {
      throw new RangeError('minZoom 必须是非负安全整数。');
    }
    if (!Number.isSafeInteger(options.maxZoom) || options.maxZoom < options.minZoom) {
      throw new RangeError('maxZoom 必须是不小于 minZoom 的安全整数。');
    }
    this.sourceId = options.sourceId;
    this.minZoom = options.minZoom;
    this.maxZoom = options.maxZoom;
  }

  parent(key: CanonicalTileKey): CanonicalTileKey | undefined {
    this.assertKey(key);
    if (key.z <= this.minZoom) {
      return undefined;
    }
    return createCanonicalTileKey(
      this.sourceId,
      key.z - 1,
      Math.floor(key.x / 2),
      Math.floor(key.y / 2),
    );
  }

  children(key: CanonicalTileKey): readonly CanonicalTileKey[] {
    this.assertKey(key);
    if (key.z >= this.maxZoom) {
      return Object.freeze([]);
    }
    const zoom = key.z + 1;
    const result: CanonicalTileKey[] = [];
    for (let yOffset = 0; yOffset < 2; yOffset += 1) {
      for (let xOffset = 0; xOffset < 2; xOffset += 1) {
        const child = createCanonicalTileKey(
          this.sourceId,
          zoom,
          key.x * 2 + xOffset,
          key.y * 2 + yOffset,
        );
        if (child !== undefined) {
          result.push(child);
        }
      }
    }
    return Object.freeze(result);
  }

  parentRenderKey(key: RenderTileKey): RenderTileKey | undefined {
    this.assertKey(key.canonical);
    if (key.canonical.z <= this.minZoom) {
      return undefined;
    }
    const globalX = key.canonical.x + key.wrap * 2 ** key.canonical.z;
    return createRenderTileKey(
      this.sourceId,
      key.canonical.z - 1,
      Math.floor(globalX / 2),
      Math.floor(key.canonical.y / 2),
    );
  }

  childrenRenderKeys(key: RenderTileKey): readonly RenderTileKey[] {
    this.assertKey(key.canonical);
    if (key.canonical.z >= this.maxZoom) {
      return Object.freeze([]);
    }
    const globalX = key.canonical.x + key.wrap * 2 ** key.canonical.z;
    const result: RenderTileKey[] = [];
    for (let yOffset = 0; yOffset < 2; yOffset += 1) {
      for (let xOffset = 0; xOffset < 2; xOffset += 1) {
        const child = createRenderTileKey(
          this.sourceId,
          key.canonical.z + 1,
          globalX * 2 + xOffset,
          key.canonical.y * 2 + yOffset,
        );
        if (child !== undefined) {
          result.push(child);
        }
      }
    }
    return Object.freeze(result);
  }

  ancestorAtZoom(key: CanonicalTileKey, zoom: number): CanonicalTileKey | undefined {
    this.assertKey(key);
    if (!Number.isSafeInteger(zoom) || zoom < this.minZoom || zoom > key.z) {
      return undefined;
    }
    const distance = key.z - zoom;
    return createCanonicalTileKey(
      this.sourceId,
      zoom,
      Math.floor(key.x / 2 ** distance),
      Math.floor(key.y / 2 ** distance),
    );
  }

  ancestors(key: CanonicalTileKey): readonly CanonicalTileKey[] {
    this.assertKey(key);
    const result: CanonicalTileKey[] = [];
    let current = this.parent(key);
    while (current !== undefined) {
      result.push(current);
      current = this.parent(current);
    }
    return Object.freeze(result);
  }

  isAncestor(ancestor: CanonicalTileKey, descendant: CanonicalTileKey): boolean {
    this.assertKey(ancestor);
    this.assertKey(descendant);
    if (ancestor.z >= descendant.z) {
      return false;
    }
    const distance = descendant.z - ancestor.z;
    return (
      Math.floor(descendant.x / 2 ** distance) === ancestor.x &&
      Math.floor(descendant.y / 2 ** distance) === ancestor.y
    );
  }

  keyOf(key: CanonicalTileKey): string {
    this.assertKey(key);
    return canonicalTileKeyToString(key);
  }

  renderKeyOf(key: RenderTileKey): string {
    this.assertKey(key.canonical);
    return renderTileKeyToString(key);
  }

  private assertKey(key: CanonicalTileKey): void {
    if (
      key.sourceId !== this.sourceId ||
      !Number.isSafeInteger(key.z) ||
      key.z < this.minZoom ||
      key.z > this.maxZoom
    ) {
      throw new RangeError('TileKey 不属于当前 TilePyramid。');
    }
  }
}
