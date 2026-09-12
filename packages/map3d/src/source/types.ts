import type {
  CanonicalTileKey,
  VectorTileSourceOptions,
} from '../types.js';

/** 经过校验并复制的内部 MVT 数据源配置。 */
export interface VectorTileSource
  extends Readonly<Omit<VectorTileSourceOptions, 'tiles' | 'bounds'>> {
  tiles: readonly string[];
  bounds?: readonly [
    west: number,
    south: number,
    east: number,
    north: number,
  ];
}

/** 可注入测试替身的 Fetch 最小接口。 */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** 单次 Tile 请求的可配置行为。 */
export interface TileFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryJitterRatio?: number;
  random?: () => number;
  fetch?: FetchLike;
  onProgress?: (loadedBytes: number, totalBytes?: number) => void;
}

interface TileFetchBaseResult {
  key: CanonicalTileKey;
  url: string;
  attempt: number;
}

/** HTTP 200 返回的已由浏览器处理 Content-Encoding 的数据。 */
export interface TileFetchDataResult extends TileFetchBaseResult {
  status: 'data';
  data: ArrayBuffer;
}

/** HTTP 204 返回的正常空 Tile。 */
export interface TileFetchEmptyResult extends TileFetchBaseResult {
  status: 'empty';
}

export type TileFetchResult = TileFetchDataResult | TileFetchEmptyResult;
