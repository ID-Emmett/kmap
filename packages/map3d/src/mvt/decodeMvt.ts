import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import type { LayerPropertyValue } from '../types.js';
import type {
  DecodedGeometryType,
  DecodedMvtFeature,
  DecodedMvtLayer,
  DecodedMvtTile,
} from './types.js';
import { MvtDecodeError } from './types.js';

/** 将已由浏览器解压的 MVT protobuf bytes 解码为渲染无关数据。 */
export function decodeMvt(
  data: ArrayBuffer | Uint8Array,
): DecodedMvtTile {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    throw new MvtDecodeError('malformed', 'MVT 数据不能为空。');
  }

  try {
    const vectorTile = new VectorTile(new PbfReader(bytes));
    const layers: Record<string, DecodedMvtLayer> = {};

    for (const [name, layer] of Object.entries(vectorTile.layers)) {
      if (layer.version !== 2) {
        throw new MvtDecodeError(
          'unsupported-version',
          `source-layer ${name} 使用不支持的 MVT version ${layer.version}。`,
          { layerName: name },
        );
      }

      if (!Number.isSafeInteger(layer.extent) || layer.extent <= 0) {
        throw new MvtDecodeError(
          'malformed',
          `source-layer ${name} 的 extent 无效。`,
          { layerName: name },
        );
      }

      const features: DecodedMvtFeature[] = [];

      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const type = decodeGeometryType(feature.type, name, index);
        const properties = decodeProperties(feature.properties, name, index);
        const geometry = feature.loadGeometry().map((path) =>
          Object.freeze(
            path.map((point) => Object.freeze({ x: point.x, y: point.y })),
          ),
        );

        features.push(
          Object.freeze({
            index,
            ...(feature.id === undefined ? {} : { id: feature.id }),
            type,
            properties,
            geometry: Object.freeze(geometry),
          }),
        );
      }

      layers[name] = Object.freeze({
        name,
        version: 2,
        extent: layer.extent,
        features: Object.freeze(features),
      });
    }

    return Object.freeze({ layers: Object.freeze(layers) });
  } catch (cause) {
    if (cause instanceof MvtDecodeError) {
      throw cause;
    }

    throw new MvtDecodeError('malformed', 'MVT protobuf 数据损坏或截断。', {
      cause,
    });
  }
}

function decodeGeometryType(
  type: 0 | 1 | 2 | 3,
  layerName: string,
  featureIndex: number,
): DecodedGeometryType {
  switch (type) {
    case 1:
      return 'point';
    case 2:
      return 'line';
    case 3:
      return 'polygon';
    default:
      throw new MvtDecodeError(
        'unsupported-geometry',
        `source-layer ${layerName} feature ${featureIndex} 使用未知 geometry type。`,
        { layerName, featureIndex },
      );
  }
}

function decodeProperties(
  properties: Record<string, number | string | boolean>,
  layerName: string,
  featureIndex: number,
): Readonly<Record<string, LayerPropertyValue>> {
  const decoded: Record<string, LayerPropertyValue> = {};

  for (const [name, value] of Object.entries(properties)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new MvtDecodeError(
        'malformed',
        `source-layer ${layerName} feature ${featureIndex} 包含不支持的属性值。`,
        { layerName, featureIndex },
      );
    }

    decoded[name] = value;
  }

  return Object.freeze(decoded);
}
