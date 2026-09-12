import type {
  CanonicalTileKey,
  MapError,
  MapErrorCode,
} from '../types.js';

export type TileRequestErrorKind =
  | 'source'
  | 'http'
  | 'network'
  | 'timeout';

interface TileRequestErrorOptions {
  kind: TileRequestErrorKind;
  code: Extract<
    MapErrorCode,
    'SOURCE_ERROR' | 'HTTP_ERROR' | 'NETWORK_ERROR'
  >;
  message: string;
  recoverable: boolean;
  tileKey: CanonicalTileKey;
  url?: string;
  attempt?: number;
  status?: number;
  cause?: unknown;
}

/** Tile Source 和 Fetch 阶段的结构化错误；用户取消不会包装为此类型。 */
export class TileRequestError extends Error implements MapError {
  readonly phase = 'request';
  readonly kind: TileRequestErrorKind;
  readonly code: TileRequestErrorOptions['code'];
  readonly recoverable: boolean;
  readonly tileKey: CanonicalTileKey;
  readonly url?: string;
  readonly attempt?: number;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(options: TileRequestErrorOptions) {
    super(options.message);
    this.name = 'TileRequestError';
    this.kind = options.kind;
    this.code = options.code;
    this.recoverable = options.recoverable;
    this.tileKey = options.tileKey;
    if (options.url !== undefined) {
      this.url = options.url;
    }
    if (options.attempt !== undefined) {
      this.attempt = options.attempt;
    }
    if (options.status !== undefined) {
      this.status = options.status;
    }
    this.cause = options.cause;
  }
}

/** 返回 AbortSignal 的原始取消原因。 */
export function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('请求已取消。', 'AbortError');
}
