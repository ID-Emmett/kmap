import type { LayerPropertyValue, MapError } from '../types.js';

export type DecodedGeometryType = 'point' | 'line' | 'polygon';

/** 已脱离第三方 Point 原型的 MVT extent 坐标。 */
export interface DecodedMvtPoint {
  x: number;
  y: number;
}

/** 单个 MVT feature 的纯数据结果。 */
export interface DecodedMvtFeature {
  index: number;
  id?: number;
  type: DecodedGeometryType;
  properties: Readonly<Record<string, LayerPropertyValue>>;
  geometry: readonly (readonly DecodedMvtPoint[])[];
}

/** 单个 source-layer 的纯数据结果。 */
export interface DecodedMvtLayer {
  name: string;
  version: 2;
  extent: number;
  features: readonly DecodedMvtFeature[];
}

/** 一个 MVT Tile 的解码结果。 */
export interface DecodedMvtTile {
  layers: Readonly<Record<string, DecodedMvtLayer>>;
}

export type MvtDecodeErrorKind =
  | 'malformed'
  | 'unsupported-version'
  | 'unsupported-geometry';

/** MVT 协议和数据损坏错误。 */
export class MvtDecodeError extends Error implements MapError {
  readonly code = 'DECODE_ERROR';
  readonly phase = 'decode';
  readonly recoverable = false;
  readonly kind: MvtDecodeErrorKind;
  readonly layerName?: string;
  readonly featureIndex?: number;
  override readonly cause?: unknown;

  constructor(
    kind: MvtDecodeErrorKind,
    message: string,
    options: {
      layerName?: string;
      featureIndex?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'MvtDecodeError';
    this.kind = kind;
    if (options.layerName !== undefined) {
      this.layerName = options.layerName;
    }
    if (options.featureIndex !== undefined) {
      this.featureIndex = options.featureIndex;
    }
    this.cause = options.cause;
  }
}
