import type {
  CanonicalTileKey,
  VectorTileSourceOptions,
} from '../types.js';
import { canonicalTileKeyToString } from '../spatial/tileKey.js';
import { WEB_MERCATOR_MAX_LATITUDE } from '../spatial/mercator.js';
import {
  requireFiniteNumber,
  requireTileZoom,
} from '../spatial/validation.js';
import { TileRequestError } from './errors.js';
import type { VectorTileSource } from './types.js';

const REQUIRED_TEMPLATE_TOKENS = ['{z}', '{x}', '{y}'] as const;

/** 校验并复制公共 MVT 数据源配置。 */
export function normalizeVectorTileSourceOptions(
  options: VectorTileSourceOptions,
): VectorTileSource {
  const id = options.id.trim();

  if (id.length === 0) {
    throw new RangeError('Vector Tile source id 不能为空。');
  }

  if (options.tiles.length === 0) {
    throw new RangeError('Vector Tile source 至少需要一个 URL 模板。');
  }

  const tiles = options.tiles.map((template, index) => {
    if (template.length === 0) {
      throw new RangeError(`tiles[${index}] 不能为空。`);
    }

    for (const token of REQUIRED_TEMPLATE_TOKENS) {
      if (!template.includes(token)) {
        throw new RangeError(`tiles[${index}] 缺少 ${token} 占位符。`);
      }
    }

    return template;
  });
  const minZoom = requireTileZoom(options.minZoom, 'minZoom');
  const maxZoom = requireTileZoom(options.maxZoom, 'maxZoom');

  if (minZoom > maxZoom) {
    throw new RangeError('minZoom 不能大于 maxZoom。');
  }

  const bounds = options.bounds === undefined
    ? undefined
    : normalizeBounds(options.bounds);

  return Object.freeze({
    id,
    tiles: Object.freeze(tiles),
    minZoom,
    maxZoom,
    ...(bounds === undefined ? {} : { bounds }),
  });
}

/** 使用稳定 FNV-1a 32-bit hash 计算 canonical key。 */
export function hashCanonicalTileKey(key: CanonicalTileKey): number {
  const value = canonicalTileKeyToString(key);
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** 返回指定尝试次数使用的节点和展开后的 XYZ URL。 */
export function getTileRequestUrl(
  source: VectorTileSource,
  key: CanonicalTileKey,
  attemptIndex: number,
): { templateIndex: number; url: string } {
  assertKeyMatchesSource(source, key);

  if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 0) {
    throw new RangeError('attemptIndex 必须是非负安全整数。');
  }

  const templateIndex =
    (hashCanonicalTileKey(key) + attemptIndex) % source.tiles.length;
  const template = source.tiles[templateIndex];

  if (template === undefined) {
    throw new RangeError('Tile URL 模板索引越界。');
  }

  return {
    templateIndex,
    url: template
      .replaceAll('{z}', String(key.z))
      .replaceAll('{x}', String(key.x))
      .replaceAll('{y}', String(key.y)),
  };
}

/** 确保请求 key 属于数据源真实层级和 canonical 范围。 */
export function assertKeyMatchesSource(
  source: VectorTileSource,
  key: CanonicalTileKey,
): void {
  let stableKey: string;

  try {
    stableKey = canonicalTileKeyToString(key);
  } catch (cause) {
    throw new TileRequestError({
      kind: 'source',
      code: 'SOURCE_ERROR',
      message: '请求 TileKey 不是有效 canonical key。',
      recoverable: false,
      tileKey: key,
      cause,
    });
  }

  if (key.sourceId !== source.id) {
    throw new TileRequestError({
      kind: 'source',
      code: 'SOURCE_ERROR',
      message: `TileKey ${stableKey} 不属于 source ${source.id}。`,
      recoverable: false,
      tileKey: key,
    });
  }

  if (key.z < source.minZoom || key.z > source.maxZoom) {
    throw new TileRequestError({
      kind: 'source',
      code: 'SOURCE_ERROR',
      message: `TileKey ${stableKey} 超出 source zoom ${source.minZoom}-${source.maxZoom}。`,
      recoverable: false,
      tileKey: key,
    });
  }
}

function normalizeBounds(
  bounds: NonNullable<VectorTileSourceOptions['bounds']>,
): NonNullable<VectorTileSourceOptions['bounds']> {
  const west = requireFiniteNumber(bounds[0], 'bounds.west');
  const south = requireFiniteNumber(bounds[1], 'bounds.south');
  const east = requireFiniteNumber(bounds[2], 'bounds.east');
  const north = requireFiniteNumber(bounds[3], 'bounds.north');

  if (south > north) {
    throw new RangeError('bounds.south 不能大于 bounds.north。');
  }

  if (
    south < -WEB_MERCATOR_MAX_LATITUDE ||
    north > WEB_MERCATOR_MAX_LATITUDE
  ) {
    throw new RangeError('bounds 纬度必须位于 Web Mercator 有效范围。');
  }

  return Object.freeze([west, south, east, north]);
}
